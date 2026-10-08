//! One file's live trees as a plugin sees them: the `cursor` resource. The
//! host walks the trees, positioning the cursor on each node before calling
//! the plugin; the plugin reads and edits through it, and edits apply
//! immediately.
use crate::pairing::Pairing;
use crate::protocol::{FileChange, Node, Region, Source, SourcePos, SourceRange, Span, Visibility};
use std::collections::BTreeSet;

/// The before (`lhs`) or after (`rhs`) side of a comparison.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Lhs,
    Rhs,
}

/// One region as a plugin sees it: shallow, with its parent and its
/// children's ids rather than nested subtrees.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegionView {
    pub side: Side,
    pub id: u32,
    /// The fold that holds this region; none for a top-level region.
    pub parent: Option<u32>,
    pub fold_state_id: u32,
    pub range: SourceRange,
    pub tags: Vec<String>,
    pub visibility: Visibility,
    pub kind: Kind,
    pub children: Vec<u32>,
}

/// A leaf tiles the file; a fold's range is the hull of its children.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    Leaf {
        alignment_id: u32,
        changed: Vec<Span>,
    },
    Fold,
}

/// Visible collapsed rows and open-line runs within a node.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RowSummary {
    pub collapsed: u32,
    pub leading: u32,
    pub trailing: u32,
    pub longest_gap: u32,
}

/// The regions a cut or join created, per side.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RegionIds {
    Both(u32, u32),
    LeftOnly(u32),
    RightOnly(u32),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Grouping {
    Link,
    Join,
}

/// Why an edit or a lookup was refused. Nothing changes on a refusal.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MoveError {
    NoRegion(u32),
    CutFold(u32),
    CutOutside { id: u32, offset: u32, len: u32 },
    UnevenSides(u32),
    TooFewRegions(Grouping),
    Repeated { grouping: Grouping, ids: Vec<u32> },
    OneSided(Vec<u32>),
    NotSiblings(Vec<u32>),
    NoNextSibling(u32),
}

/// A file's trees, the next unused IDs, and where the current walk stands.
pub struct Cursor {
    pub file: FileChange,
    pub sides: Pairing<Source>,
    /// The region the cursor is on: the one the current callback visits.
    pub id: u32,
    /// IDs from here up were made during the current walk, which skips them.
    limit: u32,
    next_region_id: u32,
    next_alignment_id: u32,
}

impl Cursor {
    /// A cursor on the file's first region. A file with no regions, such as
    /// an empty one, has nothing to stand on: its sides come back as given.
    #[allow(clippy::result_large_err)] // The sides are handed back, not an error.
    pub fn new(file: FileChange, sides: Pairing<Source>) -> Result<Self, Pairing<Source>> {
        let Some(first) = sides.sides().first().map(|source| source.root.id) else {
            return Err(sides);
        };
        let mut next_region_id = 1;
        let mut next_alignment_id = 0;
        for source in sides.sides() {
            walk(top(source), &mut |region| {
                next_region_id = next_region_id.max(region.id + 1);
                if let Some(alignment) = region.alignment_id() {
                    next_alignment_id = next_alignment_id.max(alignment + 1);
                }
            });
        }
        Ok(Self {
            file,
            sides,
            id: first,
            limit: next_region_id,
            next_region_id,
            next_alignment_id,
        })
    }

    /// Start a walk over the nodes that exist now, from the first region.
    pub fn rewind(&mut self) {
        self.id = self.top_level()[0];
        self.limit = self.next_region_id;
    }

    /// The top-level regions, lhs before rhs.
    fn top_level(&self) -> Vec<u32> {
        self.sides
            .sides()
            .iter()
            .map(|source| source.root.id)
            .collect()
    }

    /// The next child of `parent` (none: the next top-level region) after
    /// `after`, skipping nodes this walk created.
    pub fn next_child(
        &self,
        parent: Option<u32>,
        after: Option<u32>,
    ) -> Result<Option<u32>, MoveError> {
        let children = match parent {
            Some(parent) => self.get(parent)?.children,
            None => self.top_level(),
        };
        let start = match after {
            None => 0,
            Some(mut previous) => loop {
                if let Some(index) = children.iter().position(|&id| id == previous) {
                    break index + 1;
                }
                // The node was wrapped during this walk: continue after its wrapper.
                match self.get(previous)?.parent {
                    Some(parent) => previous = parent,
                    None => return Err(MoveError::NoRegion(previous)),
                }
            },
        };
        Ok(children.into_iter().skip(start).find(|&id| id < self.limit))
    }

    /// One region and its immediate children.
    pub fn get(&self, id: u32) -> Result<RegionView, MoveError> {
        fn find(
            regions: &[Region],
            parent: Option<u32>,
            id: u32,
            side: Side,
        ) -> Option<RegionView> {
            for region in regions {
                if region.id == id {
                    let children = match &region.node {
                        Node::Leaf { .. } => vec![],
                        Node::Fold { children, .. } => {
                            children.iter().map(|child| child.id).collect()
                        }
                    };
                    return Some(view(region, parent, side, children));
                }
                if let Node::Fold { children, .. } = &region.node {
                    if let Some(node) = find(children, Some(region.id), id, side) {
                        return Some(node);
                    }
                }
            }
            None
        }
        for (side, source) in [(Side::Lhs, self.sides.lhs()), (Side::Rhs, self.sides.rhs())] {
            if let Some(node) = source.and_then(|source| find(top(source), None, id, side)) {
                return Ok(node);
            }
        }
        Err(MoveError::NoRegion(id))
    }

    /// Original text covered by this region's whole-line range.
    pub fn text(&self, id: u32) -> Result<String, MoveError> {
        for source in self.sides.sides() {
            if let Some(region) = find(top(source), id) {
                let range = region.range.lines();
                return Ok(source
                    .text
                    .split_inclusive('\n')
                    .skip(range.start as usize)
                    .take(range.len())
                    .collect());
            }
        }
        Err(MoveError::NoRegion(id))
    }

    /// Summary of visible collapsed rows and open-line runs beneath a node.
    pub fn display(&self, id: u32) -> Result<RowSummary, MoveError> {
        fn summarize(region: &Region) -> RowSummary {
            if region.visibility.collapsed {
                return RowSummary {
                    collapsed: 1,
                    leading: 0,
                    trailing: 0,
                    longest_gap: 0,
                };
            }
            match &region.node {
                Node::Leaf { .. } => {
                    let n = region.range.lines().len() as u32;
                    RowSummary {
                        collapsed: 0,
                        leading: n,
                        trailing: n,
                        longest_gap: n,
                    }
                }
                Node::Fold { children, .. } => {
                    let mut rows = RowSummary {
                        collapsed: 0,
                        leading: 0,
                        trailing: 0,
                        longest_gap: 0,
                    };
                    for child in children {
                        let next = summarize(child);
                        rows.longest_gap = rows
                            .longest_gap
                            .max(next.longest_gap)
                            .max(rows.trailing + next.leading);
                        if rows.collapsed == 0 {
                            rows.leading += next.leading;
                        }
                        rows.trailing = if next.collapsed == 0 {
                            rows.trailing + next.trailing
                        } else {
                            next.trailing
                        };
                        rows.collapsed += next.collapsed;
                    }
                    rows
                }
            }
        }
        Ok(summarize(region_of(&self.sides, id)?))
    }

    /// Resolve an ordered sibling sequence across sides. None means conflicting
    /// alignment; an empty sequence means all members are one-sided.
    pub fn matching_siblings(&self, ids: &[u32]) -> Result<Option<Vec<u32>>, MoveError> {
        check_regions(ids, Grouping::Join)?;
        let own = self
            .sides
            .sides()
            .into_iter()
            .find(|s| find(top(s), ids[0]).is_some())
            .ok_or(MoveError::NoRegion(ids[0]))?;
        let nodes = ids
            .iter()
            .map(|id| find(top(own), *id).ok_or(MoveError::NoRegion(*id)))
            .collect::<Result<Vec<_>, _>>()?;
        let path = path_of(top(own), ids[0]).expect("the region was found above");
        let siblings = if path.len() == 1 {
            top(own)
        } else {
            let Node::Fold { children, .. } = &at(top(own), &path[..path.len() - 1]).node else {
                unreachable!("a region's parent is a fold")
            };
            children
        };
        let siblings: Vec<_> = siblings.iter().map(|region| region.id).collect();
        let start = siblings.iter().position(|id| *id == ids[0]).unwrap();
        if siblings.get(start..start + ids.len()) != Some(ids) {
            return Err(MoveError::NotSiblings(ids.to_vec()));
        }
        let other = if self.sides.lhs().is_some_and(|s| std::ptr::eq(s, own)) {
            self.sides.rhs()
        } else {
            self.sides.lhs()
        };
        let Some(other) = other else {
            return Ok(Some(Vec::new()));
        };
        fn matches(a: &Region, b: &Region) -> bool {
            match (&a.node, &b.node) {
                (
                    Node::Leaf {
                        alignment_id: a, ..
                    },
                    Node::Leaf {
                        alignment_id: b, ..
                    },
                ) => a == b,
                (Node::Fold { .. }, Node::Fold { .. }) => a.fold_state_id == b.fold_state_id,
                _ => false,
            }
        }
        fn search(regions: &[Region], nodes: &[&Region]) -> Option<Vec<u32>> {
            for window in regions.windows(nodes.len()) {
                if nodes.iter().zip(window).all(|(a, b)| matches(a, b)) {
                    return Some(window.iter().map(|r| r.id).collect());
                }
            }
            for region in regions {
                if let Node::Fold { children, .. } = &region.node {
                    if let Some(ids) = search(children, nodes) {
                        return Some(ids);
                    }
                }
            }
            None
        }
        let mut paired = false;
        walk(top(other), &mut |r| {
            paired |= nodes.iter().any(|n| matches(n, r));
        });
        Ok(if paired {
            search(top(other), &nodes)
        } else {
            Some(Vec::new())
        })
    }

    /// Leaves intersecting a half-open source line range, in document order.
    pub fn leaves(&self, side: Side, start: u32, end: u32) -> Vec<u32> {
        let mut ids = Vec::new();
        if start >= end {
            return ids;
        }
        if let Some(source) = side_of(&self.sides, side) {
            walk(top(source), &mut |region| {
                let lines = region.range.lines();
                if matches!(region.node, Node::Leaf { .. })
                    && lines.start < end
                    && start < lines.end
                {
                    ids.push(region.id);
                }
            });
        }
        ids
    }

    /// Whether this region contains changed bytes or an unpaired leaf on its own side.
    pub fn has_changes(&self, id: u32) -> Result<bool, MoveError> {
        let mut changes = false;
        walk(
            std::slice::from_ref(region_of(&self.sides, id)?),
            &mut |region| {
                if let Node::Leaf { pair, changed, .. } = &region.node {
                    changes |= !changed.is_empty() || pair.is_none();
                }
            },
        );
        Ok(changes)
    }

    /// Opposite-side leaf with the same alignment; folds and unmatched leaves return None.
    pub fn paired_leaf(&self, id: u32) -> Result<Option<u32>, MoveError> {
        Ok(match region_of(&self.sides, id)?.node {
            Node::Leaf { pair, .. } => pair,
            Node::Fold { .. } => None,
        })
    }

    /// All regions sharing this region's collapse state, including itself.
    pub fn linked_regions(&self, id: u32) -> Result<Vec<u32>, MoveError> {
        let state = region_of(&self.sides, id)?.fold_state_id;
        let mut ids = Vec::new();
        for tree in trees_ref(&self.sides) {
            walk(tree, &mut |region| {
                if region.fold_state_id == state {
                    ids.push(region.id);
                }
            });
        }
        Ok(ids)
    }

    /// No leaf in this subtree has an opposite-side match.
    pub fn is_one_sided(&self, id: u32) -> Result<bool, MoveError> {
        let mut paired = false;
        walk(
            std::slice::from_ref(region_of(&self.sides, id)?),
            &mut |region| {
                paired |= matches!(region.node, Node::Leaf { pair: Some(_), .. });
            },
        );
        Ok(!paired)
    }

    /// Original file text. An absent side is None; an empty side is Some("").
    pub fn source(&self, side: Side) -> Option<String> {
        side_of(&self.sides, side).map(|source| source.text.clone())
    }

    /// Siblings on this node's side, in source order, including the node itself.
    pub fn siblings(&self, id: u32) -> Result<Vec<u32>, MoveError> {
        let view = self.get(id)?;
        let children = match view.parent {
            Some(parent) => self.get(parent)?.children,
            None => self.top_level(),
        };
        let mut siblings = Vec::new();
        for child in children {
            if self.get(child)?.side == view.side {
                siblings.push(child);
            }
        }
        Ok(siblings)
    }

    /// Enclosing folds, nearest first.
    pub fn ancestors(&self, id: u32) -> Result<Vec<RegionView>, MoveError> {
        let mut ancestors = Vec::new();
        let mut view = self.get(id)?;
        while let Some(parent) = view.parent {
            view = self.get(parent)?;
            ancestors.push(view.clone());
        }
        Ok(ancestors)
    }

    /// Split a leaf and its paired leaf at a relative line offset. Returns the new tails.
    pub fn cut(&mut self, id: u32, offset: u32) -> Result<RegionIds, MoveError> {
        let Cursor {
            sides,
            next_region_id,
            next_alignment_id,
            ..
        } = self;
        let Some((side, path)) = trees(sides)
            .into_iter()
            .enumerate()
            .find_map(|(side, tree)| Some((side, path_of(tree, id)?)))
        else {
            return Err(MoveError::NoRegion(id));
        };
        let (alignment, len) = {
            let leaf = at(trees(sides).swap_remove(side), &path);
            let Some(alignment) = leaf.alignment_id() else {
                return Err(MoveError::CutFold(id));
            };
            (alignment, leaf.range.lines().len() as u32)
        };
        if !(0 < offset && offset < len) {
            return Err(MoveError::CutOutside { id, offset, len });
        }
        // Validate both sides before allocating IDs or changing either tree.
        let paths = trees_ref(sides)
            .into_iter()
            .enumerate()
            .map(|(tree_side, tree)| {
                let path = if tree_side == side {
                    Some(path.clone())
                } else {
                    path_where(tree, &|region| region.alignment_id() == Some(alignment))
                };
                if let Some(path) = &path {
                    if at(tree, path).range.lines().len() as u32 != len {
                        return Err(MoveError::UnevenSides(id));
                    }
                }
                Ok(path)
            })
            .collect::<Result<Vec<_>, MoveError>>()?;
        let piece_alignment = *next_alignment_id;
        *next_alignment_id += 1;
        // Both tails' ids first, so each can name the other as its pair.
        let piece_ids: Vec<Option<u32>> = paths
            .iter()
            .map(|path| {
                path.as_ref().map(|_| {
                    let id = *next_region_id;
                    *next_region_id += 1;
                    id
                })
            })
            .collect();
        let piece_state = piece_ids.iter().flatten().next().copied();
        let has_lhs = sides.lhs().is_some();
        let (mut lhs, mut rhs) = (None, None);
        for (tree_side, (tree, path)) in trees(sides).into_iter().zip(paths).enumerate() {
            let (Some(path), Some(piece_id), Some(piece_state)) =
                (path, piece_ids[tree_side], piece_state)
            else {
                continue;
            };
            let partner =
                piece_ids
                    .iter()
                    .enumerate()
                    .find_map(|(other, id)| if other == tree_side { None } else { *id });
            let (index, parent) = path.split_last().expect("a path is never empty");
            let list = siblings(tree, parent);
            if tree_side == 0 && has_lhs {
                lhs = Some(piece_id);
            } else {
                rhs = Some(piece_id);
            }
            let leaf = list.remove(*index);
            let pieces = split(
                leaf,
                offset,
                piece_id,
                piece_alignment,
                piece_state,
                partner,
            );
            list.splice(*index..*index, pieces);
        }
        Ok(region_ids(lhs, rhs))
    }

    /// Wrap consecutive siblings on each side in new open, unlabelled folds.
    pub fn join(&mut self, ids: &[u32]) -> Result<RegionIds, MoveError> {
        let Cursor {
            sides,
            next_region_id,
            ..
        } = self;
        check_regions(ids, Grouping::Join)?;
        for id in ids {
            region_of(sides, *id)?;
        }
        // Compute and validate every sibling range before draining either side.
        let mut groups = Vec::new();
        for tree in trees_ref(sides) {
            let mut paths: Vec<Vec<usize>> =
                ids.iter().filter_map(|id| path_of(tree, *id)).collect();
            if paths.is_empty() {
                groups.push(None);
                continue;
            }
            if paths.len() < 2 {
                return Err(MoveError::OneSided(ids.to_vec()));
            }
            // Child-index paths sort in document order.
            paths.sort();
            let parent = &paths[0][..paths[0].len() - 1];
            let first = paths[0][paths[0].len() - 1];
            let adjacent = paths.iter().enumerate().all(|(offset, path)| {
                path.len() == paths[0].len()
                    && &path[..path.len() - 1] == parent
                    && path[path.len() - 1] == first + offset
            });
            if !adjacent {
                return Err(MoveError::NotSiblings(ids.to_vec()));
            }
            groups.push(Some((parent.to_vec(), first, paths.len())));
        }
        let mut state = None;
        let has_lhs = sides.lhs().is_some();
        let (mut lhs, mut rhs) = (None, None);
        for (side, (tree, group)) in trees(sides).into_iter().zip(groups).enumerate() {
            let Some((parent, first, count)) = group else {
                continue;
            };
            // A joined fold sits in its parent's body.
            let Node::Fold { indent, .. } = at(tree, &parent).node else {
                unreachable!("a path descends through folds");
            };
            let list = siblings(tree, &parent);
            let children: Vec<Region> = list.drain(first..first + count).collect();
            let range = SourceRange {
                start: children[0].range.start,
                end: children[children.len() - 1].range.end,
            };
            let id = *next_region_id;
            *next_region_id += 1;
            if side == 0 && has_lhs {
                lhs = Some(id);
            } else {
                rhs = Some(id);
            }
            let fold_state_id = *state.get_or_insert(id);
            list.insert(
                first,
                Region {
                    id,
                    fold_state_id,
                    range,
                    tags: Vec::new(),
                    visibility: Visibility::default(),
                    node: Node::Fold {
                        children,
                        indent,
                        syntax: None,
                    },
                },
            );
        }
        Ok(region_ids(lhs, rhs))
    }

    /// Merge the fold states of `ids` into the first's; all collapse if any was.
    pub fn link(&mut self, ids: &[u32]) -> Result<(), MoveError> {
        let sides = &mut self.sides;
        check_regions(ids, Grouping::Link)?;
        let state = region_of(sides, ids[0])?.fold_state_id;
        let mut collapsed = false;
        for &id in ids {
            collapsed |= region_of(sides, id)?.visibility.collapsed;
        }
        let states = ids
            .iter()
            .map(|id| Ok(region_of(sides, *id)?.fold_state_id))
            .collect::<Result<BTreeSet<u32>, MoveError>>()?;
        for tree in trees(sides) {
            walk_mut(tree, &mut |region| {
                if states.contains(&region.fold_state_id) {
                    region.fold_state_id = state;
                    region.visibility.collapsed = collapsed;
                }
            });
        }
        Ok(())
    }

    /// Set the shared collapsed state.
    pub fn set_collapsed(&mut self, region: u32, collapsed: bool) -> Result<(), MoveError> {
        let state = region_of(&self.sides, region)?.fold_state_id;
        for tree in trees(&mut self.sides) {
            walk_mut(tree, &mut |region| {
                if region.fold_state_id == state {
                    region.visibility.collapsed = collapsed;
                }
            });
        }
        Ok(())
    }

    /// Set or clear a region's label.
    pub fn set_label(&mut self, region: u32, label: Option<String>) -> Result<(), MoveError> {
        region_mut(&mut self.sides, region)?.visibility.label = label.unwrap_or_default();
        Ok(())
    }
}

/// A region as a plugin sees it: shallow, with its parent and children.
fn view(region: &Region, parent: Option<u32>, side: Side, children: Vec<u32>) -> RegionView {
    RegionView {
        side,
        id: region.id,
        parent,
        fold_state_id: region.fold_state_id,
        range: region.range,
        tags: region.tags.clone(),
        visibility: region.visibility.clone(),
        kind: match &region.node {
            Node::Leaf {
                alignment_id,
                changed,
                ..
            } => Kind::Leaf {
                alignment_id: *alignment_id,
                changed: changed.clone(),
            },
            Node::Fold { .. } => Kind::Fold,
        },
        children,
    }
}

impl std::fmt::Display for Grouping {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Link => "a link",
            Self::Join => "a join",
        })
    }
}

impl std::fmt::Display for MoveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoRegion(id) => write!(f, "no region {id}"),
            Self::CutFold(id) => write!(f, "region {id} is a fold; only a leaf can be cut"),
            Self::CutOutside { id, offset, len } => write!(
                f,
                "line {offset} is not inside region {id}, which has {len} lines"
            ),
            Self::UnevenSides(id) => write!(f, "region {id} has a different length on each side"),
            Self::TooFewRegions(grouping) => write!(f, "{grouping} needs at least two regions"),
            Self::Repeated { grouping, ids } => {
                write!(f, "{grouping} lists a region twice: {ids:?}")
            }
            Self::OneSided(ids) => write!(f, "a side holds only one of the joined regions {ids:?}"),
            Self::NotSiblings(ids) => {
                write!(f, "the joined regions {ids:?} are not consecutive siblings")
            }
            Self::NoNextSibling(id) => write!(f, "region {id} has no next sibling"),
        }
    }
}

impl std::error::Error for MoveError {}

fn side_of(sides: &Pairing<Source>, side: Side) -> Option<&Source> {
    match side {
        Side::Lhs => sides.lhs(),
        Side::Rhs => sides.rhs(),
    }
}

fn walk(regions: &[Region], visit: &mut impl FnMut(&Region)) {
    for region in regions {
        visit(region);
        if let Node::Fold { children, .. } = &region.node {
            walk(children, visit);
        }
    }
}

fn walk_mut(regions: &mut [Region], visit: &mut impl FnMut(&mut Region)) {
    for region in regions {
        visit(region);
        if let Node::Fold { children, .. } = &mut region.node {
            walk_mut(children, visit);
        }
    }
}

/// Each side's tree, as a one-region list holding its root.
fn trees(sides: &mut Pairing<Source>) -> Vec<&mut [Region]> {
    match sides {
        Pairing::Both { lhs, rhs } => vec![
            std::slice::from_mut(&mut lhs.root),
            std::slice::from_mut(&mut rhs.root),
        ],
        Pairing::LeftOnly { lhs } => vec![std::slice::from_mut(&mut lhs.root)],
        Pairing::RightOnly { rhs } => vec![std::slice::from_mut(&mut rhs.root)],
    }
}

fn trees_ref(sides: &Pairing<Source>) -> Vec<&[Region]> {
    sides.sides().into_iter().map(top).collect()
}

/// A side's tree, as a one-region list holding its root.
fn top(source: &Source) -> &[Region] {
    std::slice::from_ref(&source.root)
}

/// Child indices from the root down to the first region `is` accepts.
fn path_where(regions: &[Region], is: &impl Fn(&Region) -> bool) -> Option<Vec<usize>> {
    for (index, region) in regions.iter().enumerate() {
        if is(region) {
            return Some(vec![index]);
        }
        if let Node::Fold { children, .. } = &region.node {
            if let Some(mut path) = path_where(children, is) {
                path.insert(0, index);
                return Some(path);
            }
        }
    }
    None
}

/// Child indices from the root down to the region with this `id`.
fn path_of(regions: &[Region], id: u32) -> Option<Vec<usize>> {
    path_where(regions, &|region| region.id == id)
}

/// The region at a path.
fn at<'a>(regions: &'a [Region], path: &[usize]) -> &'a Region {
    let (&index, rest) = path.split_first().expect("a path is never empty");
    match (rest.is_empty(), &regions[index].node) {
        (true, _) => &regions[index],
        (false, Node::Fold { children, .. }) => at(children, rest),
        (false, Node::Leaf { .. }) => unreachable!("a path descends through folds"),
    }
}

/// The children of the fold at `parent`: the sibling list a path's last
/// index points into. The root has no siblings, so `parent` is never empty.
fn siblings<'a>(regions: &'a mut [Region], parent: &[usize]) -> &'a mut Vec<Region> {
    let (&index, rest) = parent.split_first().expect("the root has no siblings");
    let Node::Fold { children, .. } = &mut regions[index].node else {
        unreachable!("a path descends through folds");
    };
    if rest.is_empty() {
        children
    } else {
        siblings(children, rest)
    }
}

/// The region with this `id`, on whichever side holds it.
fn region_of(sides: &Pairing<Source>, id: u32) -> Result<&Region, MoveError> {
    trees_ref(sides)
        .into_iter()
        .find_map(|tree| find(tree, id))
        .ok_or(MoveError::NoRegion(id))
}

fn region_mut(sides: &mut Pairing<Source>, id: u32) -> Result<&mut Region, MoveError> {
    trees(sides)
        .into_iter()
        .find_map(|tree| find_mut(tree, id))
        .ok_or(MoveError::NoRegion(id))
}

fn find(regions: &[Region], id: u32) -> Option<&Region> {
    regions.iter().find_map(|region| {
        if region.id == id {
            return Some(region);
        }
        match &region.node {
            Node::Fold { children, .. } => find(children, id),
            Node::Leaf { .. } => None,
        }
    })
}

fn find_mut(regions: &mut [Region], id: u32) -> Option<&mut Region> {
    for region in regions {
        if region.id == id {
            return Some(region);
        }
        if let Node::Fold { children, .. } = &mut region.node {
            if let Some(found) = find_mut(children, id) {
                return Some(found);
            }
        }
    }
    None
}

/// A leaf split at relative line `offset`. The first piece keeps the leaf's
/// identity and pair; the second takes `id`, `alignment_id`,
/// `fold_state_id` and `pair`, the other side's new tail.
fn split(
    leaf: Region,
    offset: u32,
    id: u32,
    alignment_id: u32,
    fold_state_id: u32,
    pair: Option<u32>,
) -> [Region; 2] {
    let Node::Leaf {
        changed,
        pair: head_pair,
        ..
    } = &leaf.node
    else {
        unreachable!("only leaves are cut");
    };
    let boundary = SourcePos {
        line: leaf.range.start.line + offset,
        column: 0,
    };
    let piece = |range: SourceRange, id: u32, alignment_id: u32, fold_state_id: u32, pair| {
        let lines = range.lines();
        Region {
            id,
            fold_state_id,
            range,
            tags: leaf.tags.clone(),
            visibility: leaf.visibility.clone(),
            node: Node::Leaf {
                alignment_id,
                pair,
                changed: changed
                    .iter()
                    .copied()
                    .filter(|span| lines.contains(&span.line))
                    .collect(),
            },
        }
    };
    let head = piece(
        SourceRange {
            start: leaf.range.start,
            end: boundary,
        },
        leaf.id,
        leaf.alignment_id().expect("a leaf"),
        leaf.fold_state_id,
        *head_pair,
    );
    let tail = piece(
        SourceRange {
            start: boundary,
            end: leaf.range.end,
        },
        id,
        alignment_id,
        fold_state_id,
        pair,
    );
    [head, tail]
}

/// Two or more distinct region ids.
fn check_regions(ids: &[u32], grouping: Grouping) -> Result<(), MoveError> {
    if ids.len() < 2 {
        return Err(MoveError::TooFewRegions(grouping));
    }
    if ids.iter().collect::<BTreeSet<_>>().len() != ids.len() {
        return Err(MoveError::Repeated {
            grouping,
            ids: ids.to_vec(),
        });
    }
    Ok(())
}

fn region_ids(lhs: Option<u32>, rhs: Option<u32>) -> RegionIds {
    match (lhs, rhs) {
        (Some(lhs), Some(rhs)) => RegionIds::Both(lhs, rhs),
        (Some(lhs), None) => RegionIds::LeftOnly(lhs),
        (None, Some(rhs)) => RegionIds::RightOnly(rhs),
        (None, None) => unreachable!("a successful cut/join creates at least one region"),
    }
}

#[cfg(test)]
mod mutations;

#[cfg(test)]
pub(crate) mod tests;
