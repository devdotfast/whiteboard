use super::*;
use crate::protocol::{SourcePos, SourceRange, Span, Visibility};
use std::collections::BTreeSet;

/// One rendered line per value, concatenated.
fn repeated(values: impl Iterator<Item = u32>, render: impl Fn(u32) -> String) -> String {
    let mut out = String::new();
    for value in values {
        out.push_str(&render(value));
    }
    out
}

fn shaped(path: &str, before: &str, after: &str, lines: u32) -> Pairing<Source> {
    let (file, mut sides) = project(path, before, after);
    run("context", json!({ "lines": lines }), &file, &mut sides);
    sides.clone()
}

/// Every region's lines and whether it starts collapsed, with its label,
/// in document order.
fn rows(regions: &[Region]) -> Vec<((u32, u32), bool, String, bool)> {
    let mut out = Vec::new();
    walk(regions, &mut |region| {
        out.push((
            (region.range.start.line, region.range.end.line),
            region.visibility.collapsed,
            region.visibility.label.clone(),
            is_fold(region),
        ))
    });
    out
}

#[test]
fn long_unchanged_runs_collapse_to_the_context_width() {
    let body = repeated(0..20, |i| format!("x{i} = {i}\n"));
    let before = format!("{body}changed = 1\n{body}");
    let after = format!("{body}changed = 2\n{body}");
    let sides = shaped("a.py", &before, &after, 3);
    assert_eq!(
        collapsed_rows(lhs(&sides).root.children()),
        [
            ((0, 17), "17 unchanged lines".to_owned()),
            ((24, 41), "17 unchanged lines".to_owned())
        ]
    );
    assert_eq!(
        open_leaf_lines(lhs(&sides).root.children()),
        (17..24).collect()
    );
    let sides = shaped("a.py", &before, &after, 1);
    assert_eq!(
        collapsed_rows(rhs(&sides).root.children()),
        [
            ((0, 19), "19 unchanged lines".to_owned()),
            ((22, 41), "19 unchanged lines".to_owned())
        ]
    );
    assert_eq!(
        open_leaf_lines(rhs(&sides).root.children()),
        (19..22).collect()
    );
}

#[test]
fn slivers_cut_from_a_stretch_by_a_fold_edge_get_their_own_row() {
    // The changed function's fold edge lands inside the stretch above the
    // change; the two lines left inside the fold save a line as a row.
    let head = repeated(0..8, |i| format!("x{i} = {i}\n"));
    let before = format!("{head}\ndef f():\n    a = 1\n    b = 1\n    c = 1\n    return 1\n");
    let after = format!("{head}\ndef f():\n    a = 1\n    b = 1\n    c = 1\n    return 2\n");
    let sides = shaped("a.py", &before, &after, 1);
    let collapsed: Vec<_> = rows(rhs(&sides).root.children())
        .into_iter()
        .filter(|(_, collapsed, ..)| *collapsed)
        .map(|(lines, ..)| lines)
        .collect();
    assert_eq!(collapsed, [(0, 9), (10, 12)]);
}

#[test]
fn the_enclosing_header_stays_open_above_a_deep_change() {
    // A change ten lines into a function whose signature runs to five
    // lines, under ten unchanged lines of its own. The whole signature, up
    // to the body fold, is shown even though it is far outside the padding.
    let head = repeated(0..10, |i| format!("const C{i}: u32 = {i};\n"));
    let body = repeated(0..10, |i| format!("    let a{i} = {i};\n"));
    let signature = "fn outer(\n    a: u32,\n    b: u32,\n    c: u32,\n) -> u32 {\n";
    let before = format!("{head}{signature}{body}    1\n}}\n");
    let after = format!("{head}{signature}{body}    2\n}}\n");
    let sides = shaped("a.rs", &before, &after, 1);
    let open = open_leaf_lines(rhs(&sides).root.children());
    assert_eq!(open, BTreeSet::from([10, 11, 12, 13, 14, 24, 25, 26]));
    // Without a context query the whole signature collapses with the
    // unchanged lines above it.
    let config = Config::default();
    let queries = config
        .plugins
        .shape
        .queries()
        .unwrap()
        .into_iter()
        .filter(|(plugin, _)| plugin != "context")
        .collect();
    let params = config.compile_queries(queries).unwrap();
    let (file, mut sides) =
        project_compiled("a.rs", &before, &after, &params, DiffOptions::default());
    run("context", json!({"lines": 1}), &file, &mut sides);
    assert_eq!(
        open_leaf_lines(rhs(&sides).root.children()),
        BTreeSet::from([24, 25, 26])
    );
}

#[test]
fn a_file_the_diff_does_not_parse_has_no_enclosing_header() {
    // A generated file is diffed by line without parsing, so its
    // context query never runs.
    let body = repeated(0..10, |i| format!("    let a{i} = {i};\n"));
    let before = format!("fn outer() -> u32 {{\n{body}    1\n}}\n");
    let after = format!("fn outer() -> u32 {{\n{body}    2\n}}\n");
    let (file, mut sides) = project_with(
        "a.rs",
        &before,
        &after,
        DiffOptions {
            by_line: Some(crate::summary::FallbackCause::Generated),
            ..DiffOptions::default()
        },
    );
    let mut scopes = 0;
    walk(rhs(&sides).root.children(), &mut |region| {
        scopes += usize::from(has_tag(region, "context:scope"));
    });
    assert_eq!(scopes, 0);
    run("context", json!({"lines": 1}), &file, &mut sides);
    assert_eq!(
        open_leaf_lines(rhs(&sides).root.children()),
        BTreeSet::from([10, 11, 12])
    );
}

#[test]
fn a_block_closer_separates_the_rows_inside_and_after_it() {
    // The inner block's closer sits inside a long unchanged stretch that
    // continues in the enclosing function. The `if` is a scope holding the
    // change, so its `}` stays: the part inside the block and the part
    // after it are two rows with a visible line between them.
    let body = repeated(1..=7, |n| format!("        u{n}();\n"));
    let tail = repeated(1..=5, |n| format!("    v{n}();\n"));
    let before = format!("fn f() {{\n    if a {{\n        x();\n{body}    }}\n{tail}}}\n");
    let after = format!("fn f() {{\n    if a {{\n        y();\n{body}    }}\n{tail}}}\n");
    let sides = shaped("a.rs", &before, &after, 1);
    for source in [lhs(&sides), rhs(&sides)] {
        let collapsed: Vec<_> = rows(source.root.children())
            .into_iter()
            .filter(|(_, collapsed, ..)| *collapsed)
            .map(|(lines, _, label, _)| (lines, label))
            .collect();
        assert_eq!(
            collapsed,
            [
                ((4, 10), "6 unchanged lines".to_owned()),
                ((11, 16), "5 unchanged lines".to_owned())
            ]
        );
        assert!(open_leaf_lines(source.root.children()).contains(&10));
        // The inner block ends before the line its `}` sits on, and the
        // function's scope runs to the brace that closes it: the scope keeps
        // the line it opens on and the line it closes on.
        let open = open_leaf_lines(source.root.children());
        assert!(open.contains(&0) && open.contains(&16), "{open:?}");
    }
}

#[test]
fn short_unchanged_nodes_and_one_sided_files_stay_open() {
    // One unchanged line is not worth a row.
    let sides = shaped("a.py", "x = 1\n", "x = 1\n", 3);
    assert_eq!(
        rows(lhs(&sides).root.children()),
        [((0, 1), false, String::new(), false)]
    );
    assert_eq!(
        lhs(&sides).root.children()[0].alignment_id(),
        rhs(&sides).root.children()[0].alignment_id()
    );
    let (file, sides) = project("a.py", "", "def f():\n    return 1\n");
    let Pairing::Both { rhs: after, .. } = sides.clone() else {
        panic!("both sides");
    };
    let mut sides = Pairing::RightOnly { rhs: after };
    run("context", json!({"lines": 3}), &file, &mut sides);
    assert!(rows(rhs(&sides).root.children())
        .iter()
        .all(|(_, collapsed, ..)| !collapsed));
}

#[test]
fn a_line_diff_fallback_has_unpaired_folds() {
    const BEFORE: &str = "fn f(a: u32) -> u32 {\n    let x = a + 1;\n    let y = x * 2;\n    let z = y * 2;\n    let w = z * 2;\n    x + y\n}\n\nfn keep() -> u32 {\n    let k = 1;\n    let m = 2;\n    k + m\n}\n";
    const AFTER: &str = "fn f(a: u32) -> u32 {\n    let x = a + 1;\n    let y = x * 2;\n    let z = y * 2;\n    let w = z * 2;\n    x + y + 1\n}\n\nfn keep() -> u32 {\n    let k = 1;\n    let m = 2;\n    k + m\n}\n";
    let (file, mut sides) = project_with(
        "a.rs",
        BEFORE,
        AFTER,
        DiffOptions {
            graph_limit: 1,
            ..DiffOptions::default()
        },
    );
    run("context", json!({"lines": 1}), &file, &mut sides);
    let open = open_leaf_lines(rhs(&sides).root.children());
    // The parse's folds stand, so the changed function's header does.
    assert!(open.contains(&0), "{open:?}");
    assert!(!open.contains(&2), "{open:?}");
    // Unmatched folds are handled independently on each side.
    let Pairing::Both { lhs: before, .. } = &sides else {
        panic!("both sides")
    };
    assert!(!open_leaf_lines(before.root.children()).contains(&10));
    assert!(!open.contains(&10));
}

#[test]
fn a_fold_whose_matched_partner_holds_changes_stays_open() {
    // Fold 1 on the lhs lies inside an unchanged stretch, but its
    // matched partner on the rhs (fold 5, sharing the fold state) moved
    // below and holds new lines. Collapsing fold 1 would hide it.
    let range = |start: u32, end: u32| SourceRange {
        start: SourcePos {
            line: start,
            column: 0,
        },
        end: SourcePos {
            line: end,
            column: 0,
        },
    };
    let leaf = |id: u32, alignment: u32, start: u32, end: u32, changed: bool| Region {
        id,
        fold_state_id: id,
        range: range(start, end),
        tags: vec![],
        visibility: Visibility::default(),
        node: Node::Leaf {
            alignment_id: alignment,
            pair: None,
            changed: (start..end)
                .filter(|_| changed)
                .map(|line| Span {
                    line,
                    start_column: 0,
                    end_column: 1,
                })
                .collect(),
        },
    };
    // The rhs leaf paired with the lhs leaf `lhs`, whose id is also its
    // alignment id.
    let paired = |id: u32, lhs: u32, start: u32, end: u32, changed: bool| Region {
        fold_state_id: lhs,
        ..leaf(id, lhs, start, end, changed)
    };
    let fold = |id: u32, state: u32, child: Region| Region {
        id,
        fold_state_id: state,
        range: child.range,
        tags: vec![],
        visibility: Visibility::default(),
        node: Node::Fold {
            indent: child.range.start,
            syntax: None,
            children: vec![child],
        },
    };
    let source = |lines: usize, regions| Source {
        syntax: Vec::new(),
        text: "x\n".repeat(lines),
        root: test_root(regions),
    };
    let mut sides = Pairing::Both {
        lhs: source(
            6,
            vec![
                fold(1, 1, leaf(2, 2, 0, 4, false)),
                leaf(7, 7, 4, 5, false),
                leaf(3, 3, 5, 6, true),
            ],
        ),
        rhs: source(
            10,
            vec![
                paired(8, 2, 0, 4, false),
                paired(9, 7, 4, 5, false),
                paired(10, 3, 5, 6, true),
                fold(5, 1, leaf(6, 6, 6, 10, true)),
            ],
        ),
    };
    name_pairs(&mut sides);
    let (file, _) = project("a.py", "", "");
    run("context", json!({"lines": 1}), &file, &mut sides);
    let collapsed = |source: &Source| {
        rows(source.root.children())
            .into_iter()
            .filter(|(_, collapsed, _, fold)| *collapsed && *fold)
            .count()
    };
    assert_eq!(collapsed(lhs(&sides)), 0);
    assert_eq!(collapsed(rhs(&sides)), 0);
}

/// context.
fn open_leaf_lines(regions: &[Region]) -> BTreeSet<u32> {
    fn visit(regions: &[Region], out: &mut BTreeSet<u32>) {
        for region in regions.iter().filter(|region| !region.visibility.collapsed) {
            match &region.node {
                Node::Leaf { .. } => out.extend(region.range.start.line..region.range.end.line),
                Node::Fold { children, .. } => visit(children, out),
            }
        }
    }
    let mut out = BTreeSet::new();
    visit(regions, &mut out);
    out
}

/// The text of every line of `source` that `open` holds.
fn open_text<'a>(source: &'a str, open: &BTreeSet<u32>) -> Vec<&'a str> {
    source
        .lines()
        .enumerate()
        .filter(|(line, _)| open.contains(&(*line as u32)))
        .map(|(_, text)| text)
        .collect()
}

#[test]
fn every_enclosing_scope_keeps_its_first_and_last_line() {
    let before = "class C:\n    def changed(self):\n        if False:\n            return\n        x = 1\n        x += 1\n        x += 1\n        x += 1\n        x += 1\n\n    def unrelated(self):\n        return 999\n";
    let after = before.replace("x = 1", "x = 2");
    let sides = shaped("a.py", before, &after, 0);
    let open = open_leaf_lines(rhs(&sides).root.children());
    // The class body holds the change, so its first line stays. Its last
    // line is the end of the unchanged method below, not a closing brace
    // Python does not have, and that method is hidden as a unit.
    assert!(open.contains(&0) && !open.contains(&11), "{open:?}");
    // The method that holds no change keeps nothing of its own; its body
    // collapses apart from the class's last line.
    assert!(!open.contains(&5) && !open.contains(&6), "{open:?}");
}

#[test]
fn generator_declarations_keep_their_signature_and_closing_brace() {
    let body = repeated(0..30, |i| format!("    yield value_{i};\n"));
    for extension in ["js", "jsx", "ts", "tsx"] {
        for prefix in ["export function*", "export async function*"] {
            let before = format!("{prefix} stream(\n    chunks,\n) {{\n{body}}}\n");
            let after = before.replace("yield value_20;", "yield changed_value;");
            let sides = shaped(&format!("stream.{extension}"), &before, &after, 0);
            for source in [lhs(&sides), rhs(&sides)] {
                let open = open_leaf_lines(source.root.children());
                assert!(
                    (0..3).all(|line| open.contains(&line)),
                    "missing generator signature: {extension}, {prefix}: {open:?}"
                );
                assert!(
                    open.contains(&33),
                    "missing closing brace: {extension}, {prefix}"
                );
                assert!(!open.contains(&10), "unrelated body stays collapsed");
            }
        }
    }
}

#[test]
fn a_signature_keeps_its_header_without_neighbouring_statements() {
    let before = include_str!("../../../examples/review/real/02-review-175/before.ts");
    let after = include_str!("../../../examples/review/real/02-review-175/after.ts");
    let sides = shaped("a.ts", before, after, 3);
    let open = open_text(after, &open_leaf_lines(rhs(&sides).root.children()));
    let shows = |text: &str| open.iter().any(|line| line.contains(text));
    assert!(shows("function parseReviewDiffFile("));
    assert!(!shows("return sections.filter("));
    assert!(!shows("const lines = section.split("));
    assert!(shows("let additions = 0;"), "changes keep ordinary context");
}

#[test]
fn an_unrelated_tail_return_is_not_context() {
    let before = include_str!("../../../examples/review/real/07-ripgrep-3487/before.rs");
    let after = include_str!("../../../examples/review/real/07-ripgrep-3487/after.rs");
    let shows = |lines: u32, text: &str| {
        let sides = shaped("a.rs", before, after, lines);
        let open = open_leaf_lines(rhs(&sides).root.children());
        open_text(after, &open)
            .iter()
            .any(|line| line.contains(text))
    };
    assert!(
        !shows(0, "Ok(if matched"),
        "the unrelated return is not context"
    );
    assert!(shows(3, "fn run("));
}

#[test]
fn a_changed_entry_keeps_its_enclosing_return_open_to_the_closer() {
    let entries = repeated(0..24, |i| format!("        '{i}': {i},\n"));
    let before = format!("def values():\n    return {{\n{entries}    }}\n");
    let after = before.replace("'12': 12", "'12': 999");
    let sides = shaped("a.py", &before, &after, 0);
    let open = open_leaf_lines(rhs(&sides).root.children());
    assert!(open.contains(&1), "the return opener is beyond the padding");
    assert!(
        open.contains(&26),
        "the dictionary's closer is beyond the padding"
    );
}

#[test]
fn a_scope_keeps_the_line_it_closes_on() {
    // A scope is the whole construct, so the line its `}` sits on is the
    // scope's own last line, whatever column the brace is in. The body fold
    // inside it ends above that line.
    let body = repeated(0..20, |i| format!("    let x{i} = {i};\n"));
    let tail = repeated(0..10, |i| format!("    let y{i} = {i};\n"));
    let before = format!("fn changed() {{\n{body}}}\n\nfn unrelated() {{\n{tail}}}\n");
    let after = before.replace("let x1 = 1;", "let x1 = 999;");
    let sides = shaped("a.rs", &before, &after, 0);
    for source in [lhs(&sides), rhs(&sides)] {
        let open = open_leaf_lines(source.root.children());
        assert!(open.contains(&0), "the header stays: {open:?}");
        assert!(open.contains(&2), "the change stays: {open:?}");
        assert!(
            !open.contains(&20),
            "the body's last line is not the scope's: {open:?}"
        );
        assert!(
            open.contains(&21),
            "the closing `}}` the scope ends on stays: {open:?}"
        );
        assert!(!open.contains(&10), "the unchanged body collapses");
        assert!(
            !open.contains(&23),
            "the untouched function below collapses: {open:?}"
        );
    }
}

#[test]
fn exported_tsx_functions_keep_complete_headers_above_distant_changes() {
    let body = repeated(0..30, |i| format!("    const value_{i} = {i};\n"));
    let before = format!("export function ReviewHome({{\n    reviews,\n    setup,\n}}: Props) {{\n{body}    return <h1>Reviews</h1>;\n}}\n");
    let after = before.replace("<h1>Reviews</h1>", "<h1>Sessions</h1>");
    let sides = shaped("home.tsx", &before, &after, 3);
    for source in [lhs(&sides), rhs(&sides)] {
        let open = open_leaf_lines(source.root.children());
        assert!(
            (0..4).all(|line| open.contains(&line)),
            "header hidden: {open:?}"
        );
        assert!(!open.contains(&10), "unrelated body should collapse");
        assert!(open.contains(&34), "changed JSX should stay visible");
    }
}

/// The outermost collapsed regions: the rows a reader sees, with their labels.
fn collapsed_rows(regions: &[Region]) -> Vec<((u32, u32), String)> {
    let mut out = Vec::new();
    for region in regions {
        if region.visibility.collapsed {
            out.push((
                (region.range.start.line, region.range.end.line),
                region.visibility.label.clone(),
            ));
        } else if let Node::Fold { children, .. } = &region.node {
            out.extend(collapsed_rows(children));
        }
    }
    out
}

fn find<'a>(regions: &'a [Region], test: &dyn Fn(&Region) -> bool) -> Option<&'a Region> {
    regions.iter().find_map(|region| match &region.node {
        _ if test(region) => Some(region),
        Node::Fold { children, .. } => find(children, test),
        Node::Leaf { .. } => None,
    })
}

const STORE: &str = "impl Store {\n    fn limit(&self) -> u32 {\n        10\n    }\n\n    fn load(&self) {\n        self.open();\n        self.read();\n        self.close();\n    }\n\n    fn save(&self) {\n        self.write();\n        self.flush();\n    }\n}\n";

#[test]
fn an_unchanged_fold_near_a_change_is_an_outline_and_the_rest_one_row() {
    let after = STORE.replace("        10", "        20");
    let sides = shaped("a.rs", STORE, &after, 3);
    for source in [lhs(&sides), rhs(&sides)] {
        // `fn load` starts within the padding, but it is unchanged, so it is
        // not opened: its signature and closer show and its body folds. The
        // blank line and `fn save` fold behind one row.
        assert_eq!(
            collapsed_rows(source.root.children()),
            [
                ((6, 9), "3 lines".to_owned()),
                ((10, 15), "5 unchanged lines".to_owned())
            ]
        );
        assert_eq!(
            open_leaf_lines(source.root.children()),
            BTreeSet::from([0, 1, 2, 3, 4, 5, 9, 15])
        );
        // Opening the row shows `fn save` as an outline too.
        let body = find(source.root.children(), &|r| {
            is_fold(r) && r.range.start.line == 12 && r.range.end.line == 14
        })
        .unwrap();
        assert!(body.visibility.collapsed);
        assert_eq!(body.visibility.label, "2 lines");
    }
    let (lhs_row, rhs_row) = (
        find(lhs(&sides).root.children(), &|r| {
            r.visibility.label == "5 unchanged lines"
        })
        .unwrap(),
        find(rhs(&sides).root.children(), &|r| {
            r.visibility.label == "5 unchanged lines"
        })
        .unwrap(),
    );
    assert_eq!(
        lhs_row.fold_state_id, rhs_row.fold_state_id,
        "one toggle for both sides"
    );
}

#[test]
fn a_summary_inside_a_row_shows_when_the_row_opens() {
    let before = "mod store {\n    fn limit() -> u32 {\n        10\n    }\n\n    fn load() {\n        open();\n        read();\n        close();\n    }\n\n    #[cfg(test)]\n    mod tests {\n        #[test]\n        fn loads() {\n            super::load();\n        }\n\n        #[test]\n        fn limits() {\n            assert_eq!(super::limit(), 10);\n        }\n    }\n}\n";
    let after = before.replacen("        10\n", "        20\n", 1);
    let (file, mut sides) = project("a.rs", before, &after);
    run("test-bodies", json!({ "min_lines": 3 }), &file, &mut sides);
    run("context", json!({ "lines": 3 }), &file, &mut sides);
    let regions = rhs(&sides).root.children();
    // `fn load` is near the change: an outline. The rest, test module
    // included, is one row.
    assert_eq!(
        collapsed_rows(regions),
        [
            ((6, 9), "3 lines".to_owned()),
            ((10, 23), "13 unchanged lines".to_owned())
        ]
    );
    // Inside it, `mod tests` stays open so the test module's own row shows.
    let tests = find(regions, &|r| has_tag(r, "test-bodies:module")).unwrap();
    assert!(tests.visibility.collapsed);
    let module = find(regions, &|r| {
        is_fold(r) && has_tag(r, "context:scope") && r.range.start.line == 11
    })
    .unwrap();
    assert!(!module.visibility.collapsed);
}

#[test]
fn a_changed_binding_keeps_its_closer_between_two_rows() {
    let entries = repeated(0..12, |i| format!("        \"/{i}\",\n"));
    let before = format!(
        "mod routes {{\n    const ROUTES: &[&str] = &[\n{entries}    ];\n\n    fn find(path: &str) -> bool {{\n        ROUTES.contains(&path)\n    }}\n}}\n"
    );
    let after = before.replace("\"/1\"", "\"/one\"");
    let sides = shaped("a.rs", &before, &after, 3);
    let regions = rhs(&sides).root.children();
    // The binding is a scope: `];` stays, so the hidden end of the array and
    // the code after it are two rows with the closer between them.
    assert_eq!(
        collapsed_rows(regions),
        [
            ((7, 14), "7 unchanged lines".to_owned()),
            ((15, 19), "4 unchanged lines".to_owned())
        ]
    );
    assert!(open_leaf_lines(regions).contains(&14));
}
