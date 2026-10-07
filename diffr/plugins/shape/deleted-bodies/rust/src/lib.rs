//! Collapse function bodies that were deleted.
use diffr_plugin_sdk::prelude::*;
use serde::Deserialize;

/// The plugin's name, and the tag its queries set on function bodies.
const FUNCTION: &str = "deleted-bodies:function";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Options {
    min_lines: usize,
}

/// Deleted function bodies of at least `min_lines` start collapsed with a
/// line count, linked to their docstrings, which collapse with them. A body
/// counts as deleted only when nothing under it is paired: a fold whose lines
/// still align with the after side is a rewrite, not a removal.
pub struct DeletedBodies {
    options: Options,
}

impl Guest for DeletedBodies {
    type Plugin = Self;
}

impl GuestPlugin for DeletedBodies {
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
            data: region,
            ..
        } = cursor.get(cursor.id())?
        else {
            return Ok(false);
        };
        let count = (region.range.end.line - region.range.start.line) as usize;
        if matches!(region.kind, Kind::Fold)
            && region.tags.iter().any(|tag| tag == FUNCTION)
            && count >= self.options.min_lines
            && cursor.is_one_sided(region.id)?
        {
            cursor.set_collapsed(region.id, true)?;
            cursor.set_label(region.id, Some(&format!("{count} lines removed")))?;
        }
        Ok(true)
    }
}

export_shape!(DeletedBodies);
