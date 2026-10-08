use super::*;
use crate::protocol::{SourcePos, SourceRange, Span, Visibility};

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

fn removed_leaf(id: u32, alignment: u32, start: u32, end: u32, changed: &[u32]) -> Region {
    Region {
        id,
        fold_state_id: id,
        range: range(start, end),
        tags: vec![],
        visibility: Visibility::default(),
        node: Node::Leaf {
            alignment_id: alignment,
            pair: None,
            changed: changed
                .iter()
                .map(|&line| Span {
                    line,
                    start_column: 0,
                    end_column: 4,
                })
                .collect(),
        },
    }
}

fn function_fold(id: u32, start: u32, end: u32, children: Vec<Region>) -> Region {
    Region {
        id,
        fold_state_id: id,
        range: range(start, end),
        tags: vec!["removed-runs:function".to_owned()],
        visibility: Visibility::default(),
        node: Node::Fold {
            indent: range(start, end).start,
            syntax: None,
            children,
        },
    }
}

fn source(regions: Vec<Region>) -> Source {
    Source {
        syntax: Vec::new(),
        text: String::new(),
        root: test_root(regions),
    }
}

fn deleted() -> FileChange {
    FileChange {
        file: Pairing::LeftOnly {
            lhs: FileRef {
                path: "x".to_owned(),
                oid: String::new(),
                mode: String::new(),
            },
        },
        status: FileStatus::Deleted,
        tags: vec![],
    }
}

/// `(id, alignment_id, start, end, collapsed, label, changed lines)`.
type Shape = (u32, u32, u32, u32, bool, String, Vec<u32>);

fn shape(regions: &[Region]) -> Vec<Shape> {
    regions
        .iter()
        .map(|region| {
            let Node::Leaf {
                alignment_id,
                changed,
                ..
            } = &region.node
            else {
                panic!("leaf expected");
            };
            let lines = region.range.lines();
            (
                region.id,
                *alignment_id,
                lines.start,
                lines.end,
                region.visibility.collapsed,
                region.visibility.label.clone(),
                changed.iter().map(|span| span.line).collect(),
            )
        })
        .collect()
}

#[test]
fn removed_runs_keep_the_first_and_last_line_open() {
    let mut sides = Pairing::LeftOnly {
        lhs: source(vec![removed_leaf(
            1,
            0,
            10,
            17,
            &[10, 11, 12, 13, 14, 15, 16],
        )]),
    };
    run(
        "removed-runs",
        json!({"min_lines": 5}),
        &deleted(),
        &mut sides,
    );
    assert_eq!(
        shape(lhs(&sides).root.children()),
        vec![
            (1, 0, 10, 11, false, String::new(), vec![10]),
            // New pieces are numbered after the test root, 1001.
            (
                1002,
                1,
                11,
                16,
                true,
                "5 lines removed".to_owned(),
                vec![11, 12, 13, 14, 15]
            ),
            (1003, 2, 16, 17, false, String::new(), vec![16]),
        ]
    );
}

#[test]
fn removed_runs_respect_the_threshold() {
    let mut sides = Pairing::LeftOnly {
        lhs: source(vec![removed_leaf(1, 0, 0, 4, &[0, 1, 2, 3])]),
    };
    run(
        "removed-runs",
        json!({"min_lines": 5}),
        &deleted(),
        &mut sides,
    );
    assert_eq!(lhs(&sides).root.children().len(), 1);
    // A tiny threshold still needs three lines.
    let mut sides = Pairing::LeftOnly {
        lhs: source(vec![removed_leaf(1, 0, 0, 2, &[0, 1])]),
    };
    run(
        "removed-runs",
        json!({"min_lines": 1}),
        &deleted(),
        &mut sides,
    );
    assert_eq!(lhs(&sides).root.children().len(), 1);
}

#[test]
fn removed_runs_skip_paired_leaves_and_collapsed_ancestors() {
    let paired = removed_leaf(7, 7, 0, 8, &[]);
    let mut paired_rhs = removed_leaf(10, 7, 0, 8, &[]);
    paired_rhs.fold_state_id = 7;
    let mut sides = Pairing::Both {
        lhs: source(vec![
            paired,
            Region {
                id: 1,
                fold_state_id: 1,
                range: range(8, 20),
                tags: vec![],
                visibility: Visibility {
                    collapsed: true,
                    label: "12 lines removed".to_owned(),
                },
                node: Node::Fold {
                    children: vec![removed_leaf(2, 2, 8, 20, &[])],
                    indent: range(8, 20).start,
                    syntax: None,
                },
            },
            removed_leaf(3, 3, 20, 30, &[]),
        ]),
        rhs: source(vec![paired_rhs]),
    };
    run(
        "removed-runs",
        json!({"min_lines": 5}),
        &deleted(),
        &mut sides,
    );
    let lhs = lhs(&sides).root.children();
    assert_eq!(lhs.len(), 5, "paired leaf, collapsed fold, three pieces");
    assert_eq!(lhs[0].id, 7);
    let Node::Fold { children, .. } = &lhs[1].node else {
        panic!("fold expected");
    };
    assert_eq!(
        children.len(),
        1,
        "leaf under a collapsed fold is untouched"
    );
    assert_eq!(
        shape(&lhs[2..]),
        vec![
            (3, 3, 20, 21, false, String::new(), vec![]),
            // New pieces are numbered after the test roots, 1002 and 1010.
            (1011, 8, 21, 29, true, "8 lines removed".to_owned(), vec![]),
            (1012, 9, 29, 30, false, String::new(), vec![]),
        ]
    );
}

#[test]
fn removed_runs_stay_open_under_a_paired_function() {
    // The lhs function fold has no counterpart, but its second leaf
    // does: a rewrite, so its removed stretch stays in place.
    let rewritten = function_fold(
        1,
        0,
        20,
        vec![
            removed_leaf(2, 2, 0, 10, &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
            removed_leaf(3, 3, 10, 20, &[]),
        ],
    );
    // Wholly removed: nothing under it is on the rhs.
    let removed = function_fold(
        4,
        20,
        40,
        vec![removed_leaf(
            5,
            5,
            20,
            40,
            &[20, 21, 22, 23, 24, 25, 26, 27],
        )],
    );
    let mut sides = Pairing::Both {
        lhs: source(vec![rewritten, removed]),
        rhs: source(vec![removed_leaf(6, 3, 0, 10, &[])]),
    };
    run(
        "removed-runs",
        json!({"min_lines": 5}),
        &deleted(),
        &mut sides,
    );
    let lhs = lhs(&sides).root.children();
    let Node::Fold { children, .. } = &lhs[0].node else {
        panic!("fold expected");
    };
    assert_eq!(children.len(), 2, "nothing split under the paired function");
    assert!(children.iter().all(|child| !child.visibility.collapsed));
    let Node::Fold { children, .. } = &lhs[1].node else {
        panic!("fold expected");
    };
    assert_eq!(
        shape(children),
        vec![
            (5, 5, 20, 21, false, String::new(), vec![20]),
            // New pieces are numbered after the test roots, 1001 and 1006.
            (
                1007,
                6,
                21,
                39,
                true,
                "18 lines removed".to_owned(),
                (21..28).collect()
            ),
            (1008, 7, 39, 40, false, String::new(), vec![]),
        ]
    );
}
