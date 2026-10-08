//! Collapse the middle of long removed stretches.
use diffr_plugin_sdk::prelude::*;
use serde::Deserialize;

/// The tag this plugin's queries set on function bodies.
const FUNCTION: &str = "removed-runs:function";

/// Removed stretches with no counterpart and at least `min_lines` lines
/// (never fewer than three) keep their first and last line open and
/// collapse the rest with a line count, so the reader still sees red at both
/// ends. Only stretches in unpaired code qualify: the nearest enclosing
/// function fold (or, outside any function, the nearest enclosing fold)
/// must itself be one-sided, so a rewritten function shows its red and green
/// lines in place. Stretches at the top level qualify. Leaves that already
/// start collapsed, or sit under a fold that does, are left alone.
pub struct RemovedRuns {
    options: Options,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Options {
    min_lines: usize,
}

impl Guest for RemovedRuns {
    type Plugin = Self;
}

impl GuestPlugin for RemovedRuns {
    fn new(options: String) -> Result<Self, String> {
        let options: Options =
            serde_json::from_str(&options).map_err(|e| format!("invalid options: {e}"))?;
        Ok(Self { options })
    }

    async fn visit(&self, cursor: &Cursor, phase: Visit) -> Result<bool, String> {
        if phase == Visit::Post {
            return Ok(true);
        }
        let RegionView {
            side: Side::Lhs,
            data,
            ..
        } = cursor.get(cursor.id())?
        else {
            return Ok(true);
        };
        if data.visibility.collapsed {
            return Ok(false);
        }
        if matches!(data.kind, Kind::Fold) {
            return Ok(true);
        }
        let len = (data.range.end.line - data.range.start.line) as usize;
        if len < self.options.min_lines.max(3) || !cursor.is_one_sided(data.id)? {
            return Ok(false);
        }
        // The nearest function takes precedence over the nearest enclosing
        // fold. The root, the whole file, encloses everything and is no owner.
        let mut ancestors = cursor.ancestors(data.id)?;
        ancestors.retain(|region| region.parent.is_some());
        let enclosing = ancestors
            .iter()
            .find(|region| region.tags.iter().any(|tag| tag == FUNCTION))
            .or_else(|| ancestors.first());
        if let Some(enclosing) = enclosing {
            if !cursor.is_one_sided(enclosing.id)? {
                return Ok(false);
            }
        }
        let (RegionIds::Both((middle, _)) | RegionIds::LeftOnly(middle)) =
            cursor.cut(data.id, 1)?
        else {
            return Err(format!("cutting region {} left no lhs piece", data.id));
        };
        cursor.cut(middle, len as u32 - 2)?;
        cursor.set_collapsed(middle, true)?;
        cursor.set_label(middle, Some(&format!("{} lines removed", len - 2)))?;
        Ok(false)
    }
}

export_shape!(RemovedRuns);
