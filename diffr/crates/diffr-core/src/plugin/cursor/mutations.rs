use super::*;
use crate::protocol::Span;
use crate::protocol::{FileRef, FileStatus};

fn range(start: u32, end: u32) -> SourceRange {
    SourceRange {
        start: SourcePos {
            line: start,
            column: 0,
        },
        end: SourcePos {
            line: end,
            column: 0,
        },
    }
}

/// A leaf whose `fold_state_id` is its `id`.
fn leaf(id: u32, alignment: u32, start: u32, end: u32, changed: &[u32]) -> Region {
    Region {
        id,
        fold_state_id: id,
        range: range(start, end),
        tags: vec![],
        visibility: Visibility::default(),
        node: Node::Leaf {
            alignment_id: alignment,
            changed: changed
                .iter()
                .map(|&line| Span {
                    line,
                    start_column: 0,
                    end_column: 1,
                })
                .collect(),
        },
    }
}

/// A fold whose `fold_state_id` is its `id`.
fn fold(id: u32, collapsed: bool, children: Vec<Region>) -> Region {
    Region {
        id,
        fold_state_id: id,
        range: SourceRange {
            start: children[0].range.start,
            end: children[children.len() - 1].range.end,
        },
        tags: vec![],
        visibility: Visibility {
            collapsed,
            label: String::new(),
        },
        node: Node::Fold {
            indent: children[0].range.start,
            syntax: None,
            children,
        },
    }
}

/// The region sharing another's fold state: the second of a pair.
fn in_state(mut region: Region, state: u32) -> Region {
    region.fold_state_id = state;
    region
}

/// A side whose root is `root`. Roots 100 and 101 sit clear of the
/// regions' ids, so new regions are numbered from 102.
fn source(root: u32, regions: Vec<Region>) -> Source {
    Source {
        text: String::new(),
        syntax: Vec::new(),
        root: Region {
            fold_state_id: 100,
            ..Region::root(root, regions)
        },
    }
}

fn entry() -> FileChange {
    let file = FileRef {
        path: "a.rs".into(),
        oid: String::new(),
        mode: "100644".into(),
    };
    FileChange {
        file: Pairing::Both {
            lhs: file.clone(),
            rhs: file,
        },
        status: FileStatus::Modified,
        tags: vec![],
    }
}

fn both(lhs: Vec<Region>, rhs: Vec<Region>) -> Cursor {
    Cursor::new(
        entry(),
        Pairing::Both {
            lhs: source(100, lhs),
            rhs: source(101, rhs),
        },
    )
    .expect("a region")
}

type Shape = (u32, Option<u32>, u32, u32, u32, bool, String);

/// `(id, alignment_id, fold_state_id, start, end, collapsed, label)` in
/// preorder.
fn shape(regions: &[Region]) -> Vec<Shape> {
    let mut out = Vec::new();
    walk(regions, &mut |region| {
        out.push((
            region.id,
            region.alignment_id(),
            region.fold_state_id,
            region.range.start.line,
            region.range.end.line,
            region.visibility.collapsed,
            region.visibility.label.clone(),
        ))
    });
    out
}

fn sides_of(file: &Cursor) -> (&Source, &Source) {
    let Pairing::Both { lhs, rhs } = &file.sides else {
        panic!("both sides");
    };
    (lhs, rhs)
}

#[test]
fn a_rejected_edit_leaves_the_file_unchanged() {
    let mut file = both(
        vec![fold(1, false, vec![leaf(2, 0, 0, 4, &[])])],
        vec![leaf(3, 0, 0, 4, &[])],
    );
    file.set_label(2, Some("earlier edit".into())).unwrap();
    let original = file.sides.clone();
    assert_eq!(file.cut(0, 1).err(), Some(MoveError::NoRegion(0)));
    assert_eq!(file.cut(1, 1).err(), Some(MoveError::CutFold(1)));
    assert_eq!(
        file.cut(2, 4).err(),
        Some(MoveError::CutOutside {
            id: 2,
            offset: 4,
            len: 4,
        })
    );
    assert_eq!(file.cut(999, 1).err(), Some(MoveError::NoRegion(999)));
    assert_eq!(file.join(&[2, 999]).err(), Some(MoveError::NoRegion(999)));
    assert_eq!(file.link(&[1, 999]).err(), Some(MoveError::NoRegion(999)));
    assert_eq!(
        file.set_collapsed(999, true).err(),
        Some(MoveError::NoRegion(999))
    );
    assert_eq!(file.sides, original);
}

#[test]
fn cutting_a_paired_leaf_cuts_both_sides_with_fresh_ids_and_a_shared_alignment() {
    // Leaves 2 (lhs) and 3 (rhs) are paired: alignment 1, fold state 2.
    // Cutting either side cuts both the same way.
    for target in [2, 3] {
        let mut sides = both(
            vec![leaf(1, 0, 0, 2, &[]), leaf(2, 1, 2, 8, &[3, 6])],
            vec![
                in_state(leaf(3, 1, 0, 6, &[1, 4]), 2),
                leaf(4, 2, 6, 7, &[]),
            ],
        );
        sides.cut(target, 2).unwrap();
        sides.cut(102, 2).unwrap();
        let (lhs, rhs) = sides_of(&sides);
        let open = String::new;
        assert_eq!(
            shape(lhs.root.children()),
            [
                (1, Some(0), 1, 0, 2, false, open()),
                (2, Some(1), 2, 2, 4, false, open()),
                (102, Some(3), 102, 4, 6, false, open()),
                (104, Some(4), 104, 6, 8, false, open()),
            ],
            "target {target}"
        );
        assert_eq!(
            shape(rhs.root.children()),
            [
                (3, Some(1), 2, 0, 2, false, open()),
                (103, Some(3), 102, 2, 4, false, open()),
                (105, Some(4), 104, 4, 6, false, open()),
                (4, Some(2), 4, 6, 7, false, open()),
            ],
            "target {target}"
        );
        let Node::Leaf { changed, .. } = &lhs.root.children()[3].node else {
            panic!("a leaf");
        };
        assert_eq!(
            changed.iter().map(|span| span.line).collect::<Vec<_>>(),
            [6]
        );
    }
}

#[test]
fn set_collapsed_reaches_every_region_in_the_fold_state_and_labels_reach_one() {
    // Folds 2 (lhs) and 4 (rhs) are matched.
    let mut sides = both(
        vec![
            leaf(1, 0, 0, 2, &[]),
            fold(2, false, vec![leaf(3, 1, 2, 5, &[])]),
        ],
        vec![in_state(fold(4, false, vec![leaf(5, 2, 0, 4, &[])]), 2)],
    );
    sides.link(&[2, 1]).unwrap();
    sides.set_collapsed(4, true).unwrap();
    sides.set_label(2, Some("summary".to_owned())).unwrap();
    let (lhs, rhs) = sides_of(&sides);
    assert_eq!(
        shape(lhs.root.children()),
        [
            (1, Some(0), 2, 0, 2, true, String::new()),
            (2, None, 2, 2, 5, true, "summary".to_owned()),
            (3, Some(1), 3, 2, 5, false, String::new()),
        ]
    );
    assert_eq!(
        shape(rhs.root.children())[0],
        (4, None, 2, 0, 4, true, String::new())
    );
    sides.set_collapsed(1, false).unwrap();
    sides.set_label(2, None).unwrap();
    let (lhs, rhs) = sides_of(&sides);
    assert!(lhs
        .root
        .children()
        .iter()
        .all(|region| region.visibility == Visibility::default()));
    assert!(!rhs.root.children()[0].visibility.collapsed);
}

#[test]
fn a_link_takes_the_first_regions_fold_state_and_collapsed_state() {
    // Folds 1 (lhs) and 5 (rhs) are a matched pair, as are 3 (lhs) and
    // 8 (rhs).
    let tree = || {
        both(
            vec![
                fold(1, false, vec![leaf(2, 0, 0, 3, &[])]),
                fold(3, true, vec![leaf(4, 1, 3, 6, &[])]),
            ],
            vec![
                in_state(fold(8, true, vec![leaf(7, 2, 0, 3, &[])]), 3),
                in_state(fold(5, false, vec![leaf(6, 3, 3, 6, &[])]), 1),
            ],
        )
    };
    let mut sides = tree();
    sides.link(&[7, 5]).unwrap();
    let (lhs, rhs) = sides_of(&sides);
    assert_eq!(
        lhs.root.children()[0].fold_state_id,
        7,
        "the pair stays together"
    );
    assert_eq!(rhs.root.children()[1].fold_state_id, 7);
    assert_eq!(rhs.root.children()[0].fold_state_id, 3);

    let mut sides = tree();
    sides.link(&[8, 1]).unwrap();
    let (lhs, rhs) = sides_of(&sides);
    for region in [
        &lhs.root.children()[0],
        &lhs.root.children()[1],
        &rhs.root.children()[1],
    ] {
        assert_eq!(
            (region.fold_state_id, region.visibility.collapsed),
            (3, true)
        );
    }
}

#[test]
fn a_join_listing_both_sides_runs_wraps_each_with_one_fold_state() {
    // Folds 1 and 3 on the lhs are matched with 5 and 6 on the rhs; the
    // one-line leaves 2 (lhs) and 7 (rhs) between them are paired.
    let mut sides = both(
        vec![
            fold(1, true, vec![leaf(10, 0, 0, 3, &[])]),
            leaf(2, 1, 3, 4, &[]),
            fold(3, true, vec![leaf(11, 2, 4, 7, &[])]),
        ],
        vec![
            leaf(4, 3, 0, 1, &[]),
            in_state(fold(5, true, vec![leaf(12, 4, 1, 4, &[])]), 1),
            in_state(leaf(7, 1, 4, 5, &[]), 2),
            in_state(fold(6, true, vec![leaf(13, 5, 5, 8, &[])]), 3),
        ],
    );
    sides.join(&[1, 2, 3, 5, 7, 6]).unwrap();
    let (lhs, rhs) = sides_of(&sides);
    assert_eq!(lhs.root.children().len(), 1);
    assert_eq!(
        shape(lhs.root.children())[0],
        (102, None, 102, 0, 7, false, String::new())
    );
    assert_eq!(rhs.root.children().len(), 2);
    assert_eq!(
        shape(&rhs.root.children()[1..])[0],
        (103, None, 102, 1, 8, false, String::new())
    );
}

#[test]
fn a_joined_fold_takes_its_parents_indent() {
    let mut body = fold(1, false, vec![leaf(2, 0, 0, 1, &[]), leaf(3, 1, 1, 2, &[])]);
    let Node::Fold { indent, .. } = &mut body.node else {
        unreachable!("a fold");
    };
    indent.column = 4;
    let mut sides = both(vec![body, leaf(4, 2, 2, 3, &[])], Vec::new());
    sides.join(&[2, 3]).unwrap();
    let (lhs, _) = sides_of(&sides);
    let Node::Fold { children, .. } = &lhs.root.children()[0].node else {
        unreachable!("a fold");
    };
    let Node::Fold { indent, .. } = children[0].node else {
        unreachable!("the joined fold");
    };
    assert_eq!(indent.column, 4);
}

#[test]
fn moves_that_cannot_be_carried_out_are_errors() {
    let tree = || {
        both(
            vec![
                leaf(1, 0, 0, 1, &[]),
                fold(2, false, vec![leaf(3, 1, 1, 4, &[])]),
                leaf(4, 2, 4, 5, &[]),
            ],
            vec![
                in_state(leaf(5, 0, 0, 1, &[]), 1),
                in_state(leaf(6, 2, 1, 2, &[]), 4),
            ],
        )
    };
    let mut file = tree();
    assert_eq!(file.set_collapsed(9, true), Err(MoveError::NoRegion(9)));
    assert_eq!(
        file.cut(3, 3),
        Err(MoveError::CutOutside {
            id: 3,
            offset: 3,
            len: 3
        })
    );
    assert_eq!(
        file.cut(3, 0),
        Err(MoveError::CutOutside {
            id: 3,
            offset: 0,
            len: 3
        })
    );
    assert_eq!(file.cut(2, 1), Err(MoveError::CutFold(2)));
    assert_eq!(file.cut(0, 1), Err(MoveError::NoRegion(0)));
    assert_eq!(file.join(&[1, 4]), Err(MoveError::NotSiblings(vec![1, 4])));
    assert_eq!(file.join(&[1, 2, 99]), Err(MoveError::NoRegion(99)));
    assert_eq!(file.join(&[0, 1]), Err(MoveError::NoRegion(0)));
    assert_eq!(
        file.join(&[1, 2, 5]),
        Err(MoveError::OneSided(vec![1, 2, 5]))
    );
    assert_eq!(
        file.link(&[1]),
        Err(MoveError::TooFewRegions(Grouping::Link))
    );
    assert_eq!(
        file.link(&[1, 1]),
        Err(MoveError::Repeated {
            grouping: Grouping::Link,
            ids: vec![1, 1]
        })
    );
}
