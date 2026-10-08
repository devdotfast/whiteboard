//! Keep changes and the context around them; fold every other stretch into one row.
//!
//! One walk does it. Entering an unchanged fold folds it to an outline. Entering a leaf
//! cuts it where kept lines start and stop. Leaving a fold folds each run
//! of hidden children into one row. The host's root fold makes the top
//! level one more fold.
use diffr_plugin_sdk::prelude::*;
use serde::Deserialize;
use std::collections::BTreeSet;
use std::ops::Range;

/// A hidden stretch shorter than this stays open: its row would save no line.
const MIN_GAP: u32 = 2;

pub struct Context {
    options: Options,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Options {
    lines: u32,
}

impl Guest for Context {
    type Plugin = Self;
}

impl GuestPlugin for Context {
    fn new(options: String) -> Result<Self, String> {
        let options: Options =
            serde_json::from_str(&options).map_err(|e| format!("invalid options: {e}"))?;
        Ok(Self { options })
    }

    async fn visit(&self, cursor: &Cursor, phase: Visit) -> Result<bool, String> {
        let id = cursor.id();
        let data = cursor.get(id)?.data;
        if data.visibility.collapsed {
            return Ok(false);
        }
        match (phase, data.kind) {
            // Only changed folds open. An unchanged fold is an outline: near a
            // change it stays on screen, otherwise it joins its neighbours' row.
            (Visit::Pre, Kind::Fold) if item(cursor, id)? => {
                outline(cursor, id)?;
                Ok(false)
            }
            (Visit::Pre, Kind::Leaf(_)) => {
                self.trim(cursor, id)?;
                Ok(false)
            }
            (Visit::Post, Kind::Fold) => {
                self.merge_runs(cursor, id)?;
                Ok(true)
            }
            _ => Ok(true),
        }
    }
}

impl Context {
    /// Cut a leaf where kept lines start and stop, so each piece is wholly
    /// kept or wholly hidden.
    fn trim(&self, cursor: &Cursor, id: u32) -> Result<(), String> {
        let range = cursor.get(id)?.data.range;
        let kept = self.kept(cursor, id)?;
        // From the end, so `id` stays the first piece.
        for line in (range.start.line + 1..range.end.line).rev() {
            if kept.contains(&line) != kept.contains(&(line - 1)) {
                cursor.cut(id, line - range.start.line)?;
            }
        }
        Ok(())
    }

    /// Fold each run of hidden children into one collapsed row.
    fn merge_runs(&self, cursor: &Cursor, parent: u32) -> Result<(), String> {
        let mut runs = vec![Vec::new()];
        for child in cursor.get(parent)?.children {
            if self.hidden(cursor, child)? {
                runs.last_mut().expect("one run at least").push(child);
            } else {
                runs.push(Vec::new());
            }
        }
        for run in runs {
            self.fold_run(cursor, &run)?;
        }
        Ok(())
    }

    /// Collapse a run of hidden siblings into one row, joined with its peers
    /// on the other side when they are hidden too. A run shorter than
    /// `MIN_GAP` stays, and so does a lone region that already shows a
    /// summary.
    fn fold_run(&self, cursor: &Cursor, run: &[u32]) -> Result<(), String> {
        let (Some(&first), Some(&last)) = (run.first(), run.last()) else {
            return Ok(());
        };
        let start = cursor.get(first)?.data;
        let lines = cursor.get(last)?.data.range.end.line - start.range.start.line;
        if lines < MIN_GAP {
            return Ok(());
        }
        let row = match run {
            [only] if start.visibility.collapsed || cursor.display(*only)?.collapsed > 0 => {
                return Ok(());
            }
            [only] => *only,
            _ => self.join(cursor, run)?,
        };
        collapse(cursor, row, |region| {
            let range = cursor.get(region)?.data.range;
            Ok(format!(
                "{} unchanged lines",
                range.end.line - range.start.line
            ))
        })
    }

    /// Join hidden siblings into one region, with their peers on the other
    /// side when all of those are hidden too. Returns this side's region.
    fn join(&self, cursor: &Cursor, run: &[u32]) -> Result<u32, String> {
        let peers = match cursor.matching_siblings(run)? {
            Some(peers) => peers,
            None => Vec::new(),
        };
        let mut peers_hidden = true;
        for &peer in &peers {
            peers_hidden &= self.hidden(cursor, peer)?;
        }
        let ids = match peers_hidden {
            true => [run, &peers].concat(),
            false => run.to_vec(),
        };
        Ok(match cursor.join(&ids)? {
            RegionIds::Both((lhs, _)) | RegionIds::LeftOnly(lhs) => lhs,
            RegionIds::RightOnly(rhs) => rhs,
        })
    }

    /// Whether a region hides in its neighbours' row: a leaf with no kept
    /// line, or an item no change lies within `lines` of, on either side. A
    /// clause of a changed branch statement stays open with its siblings.
    fn hidden(&self, cursor: &Cursor, id: u32) -> Result<bool, String> {
        let data = cursor.get(id)?.data;
        if matches!(data.kind, Kind::Leaf(_)) {
            return Ok(self.kept(cursor, id)?.is_empty());
        }
        if !item(cursor, id)? {
            return Ok(false);
        }
        let branches = match tagged(&data, "context:clause") {
            true => nearest(cursor, id, "context:branches")?,
            false => None,
        };
        let open_clause = match branches {
            Some(branches) => changed(cursor, branches.id)?,
            None => false,
        };
        if open_clause {
            return Ok(false);
        }
        let mut near = Vec::new();
        for region in cursor.linked_regions(id)? {
            near.extend(self.near(cursor, region)?);
        }
        for leaf in near {
            if changed(cursor, leaf)? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// The lines of a leaf that stay visible, its own and those its paired
    /// leaf keeps on the other side.
    fn kept(&self, cursor: &Cursor, id: u32) -> Result<BTreeSet<u32>, String> {
        let start = cursor.get(id)?.data.range.start.line;
        let mut kept = self.kept_on_side(cursor, id)?;
        if let Some(peer) = cursor.paired_leaf(id)? {
            let peer_start = cursor.get(peer)?.data.range.start.line;
            let shift = |line: u32| line - peer_start + start;
            kept.extend(self.kept_on_side(cursor, peer)?.into_iter().map(shift));
        }
        Ok(kept)
    }

    /// Kept lines of a leaf from its own side: all of it when it or its
    /// parent always shows; else the lines within `lines` of a change, and
    /// the edges of the changed syntax around it.
    fn kept_on_side(&self, cursor: &Cursor, id: u32) -> Result<BTreeSet<u32>, String> {
        let data = cursor.get(id)?.data;
        let lines = data.range.start.line..data.range.end.line;
        let parent_kept = match data.parent {
            Some(parent) => keep_region(cursor, parent)?,
            None => false,
        };
        if keep_region(cursor, id)? || parent_kept {
            return Ok(lines.collect());
        }
        let radius = self.options.lines;
        // A range widened by `lines`, then clipped to this leaf.
        let near = |range: Range<u32>| {
            range.start.saturating_sub(radius).max(lines.start)
                ..range.end.saturating_add(radius).min(lines.end)
        };
        let mut kept = BTreeSet::new();
        for leaf in self.near(cursor, id)? {
            let leaf = cursor.get(leaf)?.data;
            let Kind::Leaf(spans) = leaf.kind else {
                return Err(format!("leaves() returned the non-leaf {}", leaf.id));
            };
            if cursor.paired_leaf(leaf.id)?.is_none() {
                kept.extend(near(leaf.range.start.line..leaf.range.end.line));
                continue;
            }
            for span in spans.changed {
                kept.extend(near(span.line..span.line + 1));
            }
        }
        let edges = edges(cursor, id)?;
        kept.extend(edges.into_iter().filter(|line| lines.contains(line)));
        Ok(kept)
    }

    /// The leaves within `lines` of a region, on its side.
    fn near(&self, cursor: &Cursor, id: u32) -> Result<Vec<u32>, String> {
        let RegionView { side, data, .. } = cursor.get(id)?;
        let start = data.range.start.line.saturating_sub(self.options.lines);
        let end = data.range.end.line.saturating_add(self.options.lines);
        Ok(cursor.leaves(side, start, end))
    }
}

/// Whether a fold stays shut as one item. It is unchanged and does not
/// always show. It is not the body of a changed scope: that body opens with
/// its scope, so a changed signature shows the start of the body. It also
/// reaches the other side, so its twin folds with it and rows stay aligned.
fn item(cursor: &Cursor, id: u32) -> Result<bool, String> {
    let RegionView { side, data, .. } = cursor.get(id)?;
    let Some(parent) = data.parent else {
        return Ok(false);
    };
    if keep_region(cursor, id)? || changed(cursor, id)? {
        return Ok(false);
    }
    if tagged(&data, "context:body")
        && tagged(&cursor.get(parent)?.data, "context:scope")
        && changed(cursor, parent)?
    {
        return Ok(false);
    }
    for region in cursor.linked_regions(id)? {
        if cursor.get(region)?.side != side {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Whether a region always shows: a `context:keep` region, or a
/// `context:relevant` region or header of a changed scope.
fn keep_region(cursor: &Cursor, id: u32) -> Result<bool, String> {
    let data = cursor.get(id)?.data;
    if tagged(&data, "context:keep") {
        return Ok(true);
    }
    let Some(scope) = nearest(cursor, id, "context:scope")? else {
        return Ok(false);
    };
    if !changed(cursor, scope.id)? {
        return Ok(false);
    }
    if tagged(&data, "context:relevant") {
        return Ok(true);
    }
    match bodies(cursor, scope.id)?.first() {
        Some(body) => Ok(data.range.end.line <= body.range.start.line),
        None => Ok(false),
    }
}

/// The lines that frame a change: the first and last line of each changed
/// scope around a region, and the line before and after each clause body
/// of each changed branch statement around it.
fn edges(cursor: &Cursor, id: u32) -> Result<Vec<u32>, String> {
    let mut edges = Vec::new();
    for ancestor in cursor.ancestors(id)? {
        let scope = tagged(&ancestor, "context:scope");
        let branches = tagged(&ancestor, "context:branches");
        if !(scope || branches) || !changed(cursor, ancestor.id)? {
            continue;
        }
        if scope {
            edges.push(ancestor.range.start.line);
        }
        if scope && !tagged(&ancestor, "context:open-ended") {
            edges.push(ancestor.range.end.line - 1);
        }
        if branches {
            for body in bodies(cursor, ancestor.id)? {
                edges.extend([body.range.start.line.saturating_sub(1), body.range.end.line]);
            }
        }
    }
    Ok(edges)
}

/// How an unchanged fold looks: an outline. A scope keeps its signature and
/// closer and folds its body; any other fold folds whole. Every fold inside
/// is folded the same way, so opening one shows the next level. A fold
/// holding a region another plugin collapsed stays open, so that summary
/// shows, and so does a fold too short to save a line.
fn outline(cursor: &Cursor, id: u32) -> Result<(), String> {
    let data = cursor.get(id)?.data;
    let summarized = data.visibility.collapsed || cursor.display(id)?.collapsed > 0;
    let body = match tagged(&data, "context:scope") {
        true => scope_body(cursor, id)?,
        false => None,
    };
    let range = cursor.get(body.unwrap_or(id))?.data.range;
    let short = range.end.line - range.start.line < MIN_GAP;
    match body {
        _ if summarized || short => {}
        Some(body) => collapse(cursor, body, |region| {
            let range = cursor.get(region)?.data.range;
            Ok(format!("{} lines", range.end.line - range.start.line))
        })?,
        None => collapse(cursor, id, |region| {
            let text = cursor.text(region)?;
            let head = text.lines().next().unwrap_or_default().trim();
            Ok(format!("{head} … {} lines", text.lines().count()))
        })?,
    }
    for child in cursor.get(id)?.children {
        if matches!(cursor.get(child)?.data.kind, Kind::Fold) {
            outline(cursor, child)?;
        }
    }
    Ok(())
}

/// A scope's body for its outline: its first `context:body` child, else its
/// last fold child.
fn scope_body(cursor: &Cursor, scope: u32) -> Result<Option<u32>, String> {
    let mut last_fold = None;
    for child in cursor.get(scope)?.children {
        let data = cursor.get(child)?.data;
        if tagged(&data, "context:body") {
            return Ok(Some(child));
        }
        if matches!(data.kind, Kind::Fold) {
            last_fold = Some(child);
        }
    }
    Ok(last_fold)
}

/// A region's `context:body` children.
fn bodies(cursor: &Cursor, id: u32) -> Result<Vec<Region>, String> {
    let mut bodies = Vec::new();
    for child in cursor.get(id)?.children {
        let data = cursor.get(child)?.data;
        if tagged(&data, "context:body") {
            bodies.push(data);
        }
    }
    Ok(bodies)
}

/// The nearest ancestor with a tag.
fn nearest(cursor: &Cursor, id: u32, tag: &str) -> Result<Option<Region>, String> {
    let ancestors = cursor.ancestors(id)?;
    Ok(ancestors.into_iter().find(|ancestor| tagged(ancestor, tag)))
}

/// Changed bytes or unpaired leaves anywhere in this region's fold state,
/// on either side.
fn changed(cursor: &Cursor, id: u32) -> Result<bool, String> {
    for region in cursor.linked_regions(id)? {
        if cursor.has_changes(region)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn tagged(region: &Region, tag: &str) -> bool {
    region.tags.iter().any(|t| t == tag)
}

/// Collapse a region's shared state and label each linked region.
fn collapse(
    cursor: &Cursor,
    id: u32,
    label: impl Fn(u32) -> Result<String, String>,
) -> Result<(), String> {
    cursor.set_collapsed(id, true)?;
    for region in cursor.linked_regions(id)? {
        cursor.set_label(region, Some(&label(region)?))?;
    }
    Ok(())
}

export_shape!(Context);
