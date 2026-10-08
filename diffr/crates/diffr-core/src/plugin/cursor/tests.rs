use super::*;
use crate::hash::DftHashMap;
use crate::protocol::{FileRef, FileStatus};

/// A test side's root. Its id stays clear of the regions' ids and differs
/// between sides, which never share region ids.
pub(crate) fn test_root(regions: Vec<Region>) -> Region {
    let id = 1000 + regions.iter().map(|region| region.id).min().unwrap_or(0);
    Region::root(id, regions)
}

/// Set each leaf's `pair` from the fixture's alignment ids.
pub(crate) fn name_pairs(sides: &mut Pairing<Source>) {
    fn name(regions: &mut [Region], other: &DftHashMap<u32, u32>) {
        for region in regions {
            match &mut region.node {
                Node::Leaf {
                    alignment_id, pair, ..
                } => *pair = other.get(alignment_id).copied(),
                Node::Fold { children, .. } => name(children, other),
            }
        }
    }
    let Pairing::Both { lhs, rhs } = sides else {
        return;
    };
    let ids = |source: &Source| {
        let mut ids = DftHashMap::default();
        walk(top(source), &mut |region| {
            if let Some(alignment) = region.alignment_id() {
                ids.insert(alignment, region.id);
            }
        });
        ids
    };
    let (lhs_ids, rhs_ids) = (ids(lhs), ids(rhs));
    name(std::slice::from_mut(&mut lhs.root), &rhs_ids);
    name(std::slice::from_mut(&mut rhs.root), &lhs_ids);
}

fn data(view: RegionView) -> RegionView {
    view
}

fn entry(sides: Pairing<FileRef>) -> FileChange {
    FileChange {
        file: sides,
        status: FileStatus::Modified,
        tags: vec![],
    }
}

fn file_ref() -> FileRef {
    FileRef {
        path: "a.rs".into(),
        oid: String::new(),
        mode: "100644".into(),
    }
}

/// The new region on the first side that has one.
fn first(ids: &RegionIds) -> u32 {
    match *ids {
        RegionIds::Both(lhs, _) | RegionIds::LeftOnly(lhs) => lhs,
        RegionIds::RightOnly(rhs) => rhs,
    }
}

/// A cursor over `sides`, with a manifest entry naming the same sides.
fn cursor(mut sides: Pairing<Source>) -> Cursor {
    name_pairs(&mut sides);
    let file = match &sides {
        Pairing::Both { .. } => Pairing::Both {
            lhs: file_ref(),
            rhs: file_ref(),
        },
        Pairing::LeftOnly { .. } => Pairing::LeftOnly { lhs: file_ref() },
        Pairing::RightOnly { .. } => Pairing::RightOnly { rhs: file_ref() },
    };
    Cursor::new(entry(file), sides).expect("a region")
}

fn leaf(id: u32, alignment: u32, start: u32, end: u32) -> Region {
    Region {
        id,
        fold_state_id: alignment,
        range: SourceRange {
            start: SourcePos {
                line: start,
                column: 0,
            },
            end: SourcePos {
                line: end,
                column: 0,
            },
        },
        tags: vec![],
        visibility: Visibility::default(),
        node: Node::Leaf {
            alignment_id: alignment,
            pair: None,
            changed: vec![],
        },
    }
}
fn source(regions: Vec<Region>) -> Source {
    Source {
        text: "a\nb\nc\nd\n".into(),
        syntax: Vec::new(),
        root: test_root(regions),
    }
}
fn file_state() -> Cursor {
    let fold = Region {
        node: Node::Fold {
            children: vec![leaf(2, 1, 0, 4)],
            indent: SourcePos { line: 0, column: 0 },
            syntax: None,
        },
        ..leaf(1, 10, 0, 4)
    };
    cursor(Pairing::Both {
        lhs: source(vec![fold]),
        rhs: source(vec![leaf(3, 1, 0, 4)]),
    })
}

#[test]
fn source_is_original_text_and_distinguishes_absent_from_empty() {
    for side in [Side::Lhs, Side::Rhs] {
        for text in ["a", "a\n", "π\r\nlast"] {
            let source = Source {
                text: text.into(),
                syntax: Vec::new(),
                root: test_root(vec![leaf(1, 1, 0, 1)]),
            };
            let sides = match side {
                Side::Lhs => Pairing::LeftOnly { lhs: source },
                Side::Rhs => Pairing::RightOnly { rhs: source },
            };
            let mut state = cursor(sides);
            let c = &mut state;
            let other = match side {
                Side::Lhs => Side::Rhs,
                Side::Rhs => Side::Lhs,
            };
            assert_eq!(c.source(other), None);
            assert_eq!(c.source(side), Some(text.into()));
        }
    }
    let mut state = file_state();
    let c = &mut state;
    let original = c.source(Side::Lhs);
    let pieces = c.cut(2, 1).unwrap();
    c.join(&[2, first(&pieces)]).unwrap();
    assert_eq!(c.source(Side::Lhs), original);
}

#[test]
fn returned_ids_preserve_the_side_for_one_sided_edits() {
    for lhs in [true, false] {
        let side = source(vec![leaf(7, 7, 0, 4)]);
        let sides = if lhs {
            Pairing::LeftOnly { lhs: side }
        } else {
            Pairing::RightOnly { rhs: side }
        };
        let mut state = cursor(sides);
        let c = &mut state;
        let ids = c.cut(7, 2).unwrap();
        assert_eq!(matches!(ids, RegionIds::LeftOnly(_)), lhs);
        let new = first(&ids);
        let folds = c.join(&[7, new]).unwrap();
        assert_eq!(matches!(folds, RegionIds::LeftOnly(_)), lhs);
        assert_eq!(c.get(first(&folds)).unwrap().children, vec![7, new]);
    }
}

#[test]
fn relationships_follow_edits_without_confusing_linking_with_alignment() {
    let mut state = file_state();
    let c = &mut state;
    assert_eq!(c.paired_leaf(2).unwrap(), Some(3));
    assert_eq!(c.paired_leaf(1).unwrap(), None);
    assert!(!c.is_one_sided(1).unwrap());
    assert_eq!(c.linked_regions(2).unwrap(), vec![2, 3]);
    c.link(&[1, 2]).unwrap();
    assert_eq!(c.linked_regions(1).unwrap(), vec![1, 2, 3]);
    assert_eq!(c.paired_leaf(1).unwrap(), None);
    let RegionIds::Both(left, right) = c.cut(2, 2).unwrap() else {
        panic!("both sides were cut");
    };
    assert_eq!(c.paired_leaf(left).unwrap(), Some(right));
    assert_eq!(c.linked_regions(left).unwrap(), vec![left, right]);
    assert_eq!(c.paired_leaf(999), Err(MoveError::NoRegion(999)));
    assert_eq!(c.linked_regions(999), Err(MoveError::NoRegion(999)));
    assert_eq!(c.is_one_sided(999), Err(MoveError::NoRegion(999)));

    let mut state = cursor(Pairing::RightOnly {
        rhs: source(vec![leaf(1, 1, 0, 4)]),
    });
    let c = &mut state;
    assert_eq!(c.paired_leaf(1).unwrap(), None);
    assert!(c.is_one_sided(1).unwrap());
    assert_eq!(c.linked_regions(1).unwrap(), vec![1]);
}

#[test]
fn collapse_and_link_preserve_other_regions_labels() {
    let mut state = file_state();
    let c = &mut state;
    c.set_label(2, Some("left label".into())).unwrap();
    c.set_label(3, Some("right label".into())).unwrap();
    c.set_collapsed(1, true).unwrap();
    c.set_label(1, Some("body".into())).unwrap();
    c.link(&[2, 1]).unwrap();
    assert_eq!(data(c.get(2).unwrap()).visibility.label, "left label");
    assert_eq!(data(c.get(3).unwrap()).visibility.label, "right label");
    c.set_collapsed(1, false).unwrap();
    c.set_collapsed(1, true).unwrap();
    c.set_label(1, Some("new body".into())).unwrap();
    for id in [1, 2, 3] {
        assert!(data(c.get(id).unwrap()).visibility.collapsed);
    }
    assert_eq!(data(c.get(1).unwrap()).visibility.label, "new body");
    assert_eq!(data(c.get(2).unwrap()).visibility.label, "left label");
    assert_eq!(data(c.get(3).unwrap()).visibility.label, "right label");
}
