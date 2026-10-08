use super::*;
use crate::protocol::{SourcePos, SourceRange, Visibility};

const FUNCTION: &str = "deleted-bodies:function";

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

fn leaf(id: u32, alignment: u32, start: u32, end: u32) -> Region {
    Region {
        id,
        fold_state_id: id,
        range: range(start, end),
        tags: vec![],
        visibility: Visibility::default(),
        node: Node::Leaf {
            alignment_id: alignment,
            pair: None,
            changed: vec![],
        },
    }
}

fn function(id: u32, start: u32, end: u32, children: Vec<Region>) -> Region {
    Region {
        id,
        fold_state_id: id,
        range: range(start, end),
        tags: vec![FUNCTION.to_owned()],
        visibility: Visibility::default(),
        node: Node::Fold {
            indent: range(start, end).start,
            syntax: None,
            children,
        },
    }
}

fn modified() -> FileChange {
    FileChange {
        file: Pairing::Both {
            lhs: FileRef {
                path: "a.py".to_owned(),
                oid: String::new(),
                mode: String::new(),
            },
            rhs: FileRef {
                path: "a.py".to_owned(),
                oid: String::new(),
                mode: String::new(),
            },
        },
        status: FileStatus::Modified,
        tags: vec![],
    }
}

#[test]
fn deleted_bodies_skip_folds_with_paired_content() {
    // The fold is unmatched (no rhs region shares its fold state), but
    // the body lines align.
    let rewritten = function(1, 0, 20, vec![leaf(2, 0, 0, 20)]);
    let removed = function(3, 20, 40, vec![leaf(4, 1, 20, 40)]);
    let source = |regions| Source {
        syntax: Vec::new(),
        text: String::new(),
        root: test_root(regions),
    };
    let mut sides = Pairing::Both {
        lhs: source(vec![rewritten, removed]),
        rhs: source(vec![leaf(5, 0, 0, 20)]),
    };
    run(
        "deleted-bodies",
        json!({"min_lines": 3}),
        &modified(),
        &mut sides,
    );
    let lhs = lhs(&sides).root.children();
    assert!(!lhs[0].visibility.collapsed, "a rewrite stays open");
    assert!(lhs[1].visibility.collapsed);
    assert_eq!(lhs[1].visibility.label, "20 lines removed");
}

#[test]
fn a_matched_function_whose_lines_all_went_away_is_a_removal() {
    // Function 1 moved below function 3 on the rhs. The rhs fold has its
    // own id (5) and shares the fold state. None of the moved body's
    // lines align, and a fold state is not what makes a body survive:
    // newness comes from the lines, so on this side the body is gone.
    let moved = function(1, 0, 20, vec![leaf(2, 0, 0, 20)]);
    let kept = function(3, 20, 40, vec![leaf(4, 1, 20, 40)]);
    let mut kept_rhs = function(7, 0, 20, vec![leaf(8, 1, 0, 20)]);
    kept_rhs.fold_state_id = 3;
    let mut moved_rhs = function(5, 20, 40, vec![leaf(6, 2, 20, 40)]);
    moved_rhs.fold_state_id = 1;
    let source = |regions| Source {
        syntax: Vec::new(),
        text: String::new(),
        root: test_root(regions),
    };
    let mut sides = Pairing::Both {
        lhs: source(vec![moved, kept]),
        rhs: source(vec![kept_rhs, moved_rhs]),
    };
    run(
        "deleted-bodies",
        json!({"min_lines": 3}),
        &modified(),
        &mut sides,
    );
    let lhs = lhs(&sides).root.children();
    assert!(lhs[0].visibility.collapsed);
    assert_eq!(lhs[0].visibility.label, "20 lines removed");
    assert!(
        !lhs[1].visibility.collapsed,
        "the function whose lines still align stays open"
    );
}

/// Every docstring region on one side: its first line, fold state,
/// collapsed state and label.
fn docstrings(source: &Source) -> Vec<(u32, u32, bool, String)> {
    let mut out = Vec::new();
    walk(source.root.children(), &mut |region| {
        if has_tag(region, "deleted-bodies:docstring") {
            out.push((
                region.range.start.line,
                region.fold_state_id,
                region.visibility.collapsed,
                region.visibility.label.clone(),
            ));
        }
    });
    out
}

/// The collapsed function body on one side: its fold state.
fn collapsed_body(source: &Source) -> u32 {
    let mut states = Vec::new();
    walk(source.root.children(), &mut |region| {
        if has_tag(region, FUNCTION) && region.visibility.collapsed {
            states.push(region.fold_state_id);
        }
    });
    assert_eq!(states.len(), 1, "{states:?}");
    states[0]
}

#[test]
fn a_deleted_body_links_its_docstring_which_collapses_with_it() {
    let before = "fn keep() {}\n\n/// Documented.\n/// Really.\nfn gone() -> u32 {\n    let a = 1;\n    let b = 2;\n    a + b\n}\n";
    let (file, mut sides) = project("a.rs", before, "fn keep() {}\n");
    run("deleted-bodies", json!({"min_lines": 3}), &file, &mut sides);
    let lhs = lhs(&sides);
    let state = collapsed_body(lhs);
    assert_eq!(docstrings(lhs), [(2, state, true, String::new())]);

    let before = "def keep():\n    pass\n\ndef gone(a):\n    \"\"\"Double a.\n\n    Returns an int.\n    \"\"\"\n    b = a\n    return b * 2\n";
    let (file, mut sides) = project("a.py", before, "def keep():\n    pass\n");
    run("deleted-bodies", json!({"min_lines": 3}), &file, &mut sides);
    let lhs = self::lhs(&sides);
    let state = collapsed_body(lhs);
    assert_eq!(docstrings(lhs), [(4, state, true, String::new())]);
}

#[test]
fn deleted_bodies_collapse_when_large_and_one_sided() {
    let before = "def gone():\n    a()\n    b()\n    c()\n\ndef kept():\n    a()\n    b()\n    c()\n\ndef tiny():\n    a()\n";
    let after = "def kept():\n    a()\n    b()\n    c()\n";
    let (file, mut sides) = project("m.py", before, after);
    run("deleted-bodies", json!({"min_lines": 3}), &file, &mut sides);
    let mut collapsed = Vec::new();
    walk(lhs(&sides).root.children(), &mut |region| {
        if is_fold(region) && region.visibility.collapsed {
            collapsed.push((region.range.start.line, region.visibility.label.clone()));
        }
    });
    assert_eq!(collapsed, vec![(1, "3 lines removed".to_owned())]);
}
