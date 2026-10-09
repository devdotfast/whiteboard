//! What a diff looks like once the plugins have shaped it: the changed
//! lines that stay visible.
use std::collections::HashSet;

use crate::pairing::Pairing;
use crate::protocol::{Diff, LineRange, Node, Region, Source, StructuralChanges, Visibility};

/// Run the plugins on a diff and recount what stays visible. `shape` runs
/// the plugins on a text diff's sides. A hidden file runs no plugin: its
/// roots start collapsed behind the reason. A binary diff has nothing to
/// shape. `Err` is a run-level failure.
pub async fn present(
    hidden: Option<&str>,
    diff: Diff,
    shape: impl AsyncFnOnce(Pairing<Source>) -> anyhow::Result<Pairing<Source>>,
) -> anyhow::Result<Diff> {
    match diff {
        Diff::Text {
            sides, mut stats, ..
        } => {
            let sides = match hidden {
                Some(reason) => sides.map(|mut source| {
                    source.root.visibility = Visibility {
                        collapsed: true,
                        label: reason.to_owned(),
                    };
                    source
                }),
                None => shape(sides).await?,
            };
            let sides = remove_redundant_folds(sides);
            let coverage = change_coverage(&sides);
            stats.visible = coverage.initially_visible.counts();
            Ok(Diff::Text {
                sides,
                stats,
                structural_changes: coverage.all,
            })
        }
        Diff::Binary { sides } => Ok(Diff::Binary { sides }),
    }
}

/// Context queries need single-line scopes while plugins select relevant code.
/// Once shaping is finished, an open, unlabelled single-line fold without
/// delimiters would only replace one source line with one fold row. Unwrap it,
/// keeping its leaves and their alignment. Keep every member of a shared fold
/// state if any member has useful folding behavior, including on the other side.
fn remove_redundant_folds(sides: Pairing<Source>) -> Pairing<Source> {
    fn retain_states(region: &Region, retained: &mut HashSet<u32>) {
        let useful = !region.visibility.is_unset()
            || matches!(&region.node, Node::Fold { syntax, .. }
                if syntax.is_some() || region.range.lines().len() > 1);
        if useful {
            retained.insert(region.fold_state_id);
        }
        for child in region.children() {
            retain_states(child, retained);
        }
    }
    fn unwrap_children(region: &mut Region, retained: &HashSet<u32>) {
        let Node::Fold { children, .. } = &mut region.node else {
            return;
        };
        *children = std::mem::take(children)
            .into_iter()
            .flat_map(|mut child| {
                unwrap_children(&mut child, retained);
                if !retained.contains(&child.fold_state_id) {
                    if let Node::Fold { children, .. } = child.node {
                        return children;
                    }
                }
                vec![child]
            })
            .collect();
    }
    let mut retained = HashSet::new();
    for source in sides.sides() {
        retain_states(&source.root, &mut retained);
    }
    sides.map(|mut source| {
        unwrap_children(&mut source.root, &retained);
        source
    })
}

/// Collect complete and default-visible coverage together. A paired leaf counts
/// only lines carrying changed spans; every line of an unpaired leaf counts,
/// including blank lines. Visibility never removes lines from `all`.
struct ChangeCoverage {
    all: StructuralChanges,
    initially_visible: StructuralChanges,
}

fn change_coverage(sides: &Pairing<Source>) -> ChangeCoverage {
    fn collect(
        regions: &[Region],
        hidden: bool,
        all: &mut Vec<LineRange>,
        visible: &mut Vec<LineRange>,
    ) {
        for region in regions {
            let hidden = hidden || region.visibility.collapsed;
            match &region.node {
                Node::Leaf { pair, changed, .. } => {
                    let start = all.len();
                    if pair.is_some() {
                        all.extend(changed.iter().map(|span| [span.line, span.line + 1]));
                    } else {
                        let lines = region.range.lines();
                        all.push([lines.start, lines.end]);
                    }
                    if !hidden {
                        visible.extend_from_slice(&all[start..]);
                    }
                }
                Node::Fold { children, .. } => collect(children, hidden, all, visible),
            }
        }
    }
    fn side(source: Option<&Source>) -> (Vec<LineRange>, Vec<LineRange>) {
        let (mut all, mut visible) = (Vec::new(), Vec::new());
        if let Some(source) = source {
            collect(
                std::slice::from_ref(&source.root),
                false,
                &mut all,
                &mut visible,
            );
        }
        (coalesce(all), coalesce(visible))
    }
    let (lhs, rhs) = match sides {
        Pairing::Both { lhs, rhs } => (Some(lhs), Some(rhs)),
        Pairing::LeftOnly { lhs } => (Some(lhs), None),
        Pairing::RightOnly { rhs } => (None, Some(rhs)),
    };
    let (base, visible_base) = side(lhs);
    let (head, visible_head) = side(rhs);
    ChangeCoverage {
        all: StructuralChanges { base, head },
        initially_visible: StructuralChanges {
            base: visible_base,
            head: visible_head,
        },
    }
}

/// Compact spans and whole-leaf ranges without allocating one entry per source line.
fn coalesce(mut ranges: Vec<LineRange>) -> Vec<LineRange> {
    ranges.sort_unstable();
    let mut merged: Vec<LineRange> = Vec::new();
    for [start, end] in ranges {
        if start >= end {
            continue;
        }
        if let Some(last) = merged.last_mut() {
            if start <= last[1] {
                last[1] = last[1].max(end);
                continue;
            }
        }
        merged.push([start, end]);
    }
    merged
}

#[cfg(test)]
mod visible_tests {
    use super::*;
    use crate::plugin::cursor::tests::name_pairs;
    use crate::protocol::{SourcePos, SourceRange, Span};

    fn test_root(regions: Vec<Region>) -> Region {
        let id = 1000 + regions.iter().map(|region| region.id).min().unwrap_or(0);
        Region::root(id, regions)
    }

    fn pos(line: u32) -> SourcePos {
        SourcePos { line, column: 0 }
    }

    fn leaf(
        id: u32,
        alignment: u32,
        lines: (u32, u32),
        changed: &[u32],
        collapsed: bool,
    ) -> Region {
        Region {
            id,
            fold_state_id: id,
            range: SourceRange {
                start: pos(lines.0),
                end: pos(lines.1),
            },
            tags: vec![],
            visibility: Visibility {
                collapsed,
                label: String::new(),
            },
            node: Node::Leaf {
                alignment_id: alignment,
                pair: None,
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

    fn fold(id: u32, lines: (u32, u32), collapsed: bool, children: Vec<Region>) -> Region {
        Region {
            id,
            fold_state_id: id,
            range: SourceRange {
                start: pos(lines.0),
                end: pos(lines.1),
            },
            tags: vec![],
            visibility: Visibility {
                collapsed,
                label: String::new(),
            },
            node: Node::Fold {
                indent: pos(lines.0),
                syntax: None,
                children,
            },
        }
    }

    fn source(regions: Vec<Region>) -> Source {
        Source {
            text: String::new(),
            syntax: vec![],
            root: test_root(regions),
        }
    }

    #[test]
    fn single_line_statements_remain_source_leaves_in_presented_blocks() {
        use crate::config::Config;
        use crate::protocol::{project, FileRef};
        use crate::summary::DiffResult;

        let script = r#"async function check(p: Page) {
  const data = fixture();
  data.change.files = data.change.files.slice(0, 1);
  await p.route("**/_ui-fixture.json", (r) => r.fulfill({ json: data }));
  await p.goto(`${base}/fixture/mobile/pull/1?ui-fixture`);
  await p.getByRole("button", { name: "Skip", exact: true }).click();
  await p.locator(".modified .view-line").first().waitFor();
  await p.waitForTimeout(1500);
}
"#;
        let javascript = script.replace("p: Page", "p");
        let params = Config::default().compile().unwrap();
        for (path, text) in [
            ("a.css", ".input {\n  box-sizing: border-box;\n  width: 100%;\n  color: var(--foreground);\n}\n"),
            ("a.ts", script),
            ("a.js", javascript.as_str()),
        ] {
            let result = DiffResult::from_sources_with_params(path, "", text, &params);
            let file = Pairing::RightOnly {
                rhs: FileRef {
                    path: path.to_owned(),
                    oid: String::new(),
                    mode: String::new(),
                },
            };
            let Diff::Text { sides, .. } = project::diff(
                &result,
                project::Inputs {
                    file: &file,
                    sizes: (0, text.len() as u64),
                },
            ) else {
                panic!("expected a text diff");
            };
            fn declarations(region: &Region) -> usize {
                usize::from(
                    matches!(region.node, Node::Fold { syntax: None, .. })
                        && region.range.lines().len() == 1,
                ) + region.children().iter().map(declarations).sum::<usize>()
            }
            assert!(
                declarations(&sides.rhs().unwrap().root) >= 3,
                "context selection receives declaration scopes"
            );
            let cleaned = remove_redundant_folds(sides);
            let rhs = cleaned.rhs().unwrap();
            assert_eq!(rhs.text, text);
            assert_eq!(
                declarations(&rhs.root),
                0,
                "output has no standalone one-line folds"
            );
            fn block(region: &Region) -> Option<&Region> {
                if matches!(
                    region.node,
                    Node::Fold {
                        syntax: Some(_),
                        ..
                    }
                ) {
                    Some(region)
                } else {
                    region.children().iter().find_map(block)
                }
            }
            let body = block(&rhs.root).expect("the containing block remains foldable");
            assert_eq!(body.range.lines(), 1..text.lines().count() as u32 - 1, "{path}");
            assert!(body
                .children()
                .iter()
                .all(|region| matches!(region.node, Node::Leaf { .. })));
        }
    }

    #[test]
    fn single_line_scopes_are_unwrapped_without_losing_code_or_block_folds() {
        let declaration = leaf(2, 2, (1, 2), &[1], false);
        let mut body = fold(
            10,
            (1, 2),
            false,
            vec![fold(1, (1, 2), false, vec![declaration.clone()])],
        );
        if let Node::Fold { syntax, .. } = &mut body.node {
            *syntax = Some(SourceRange {
                start: pos(0),
                end: pos(2),
            });
        }
        let mut rhs = source(vec![
            leaf(3, 3, (0, 1), &[0], false),
            body,
            leaf(4, 4, (2, 3), &[2], false),
        ]);
        rhs.text = ".input {\n  width: 100%;\n}\n".to_owned();
        let sides = Pairing::RightOnly { rhs };
        let coverage = change_coverage(&sides);
        let cleaned = remove_redundant_folds(sides);
        let rhs = cleaned.rhs().unwrap();
        let body = &rhs.root.children()[1];
        assert_eq!(body.id, 10, "a block with a one-line body still folds");
        assert_eq!(
            body.children(),
            &[declaration],
            "only the scope wrapper is removed"
        );
        let after = change_coverage(&cleaned);
        assert_eq!(after.all, coverage.all);
        assert_eq!(after.initially_visible, coverage.initially_visible);
    }

    #[test]
    fn summaries_and_shared_folding_states_survive_cleanup() {
        let mut summary = fold(1, (0, 1), false, vec![leaf(2, 2, (0, 1), &[], false)]);
        summary.visibility.label = "summary".to_owned();
        let collapsed = fold(3, (1, 2), true, vec![leaf(4, 4, (1, 2), &[], false)]);
        let mut linked = fold(5, (2, 3), false, vec![leaf(6, 6, (2, 3), &[], false)]);
        linked.fold_state_id = 7;
        let lhs = source(vec![summary, collapsed, linked]);
        let rhs = source(vec![fold(
            7,
            (0, 2),
            false,
            vec![leaf(8, 8, (0, 2), &[], false)],
        )]);
        let sides = Pairing::Both { lhs, rhs };
        assert_eq!(remove_redundant_folds(sides.clone()), sides);
    }

    #[test]
    fn redundant_scopes_on_both_sides_are_removed_together() {
        let lhs_leaf = leaf(2, 2, (0, 1), &[], false);
        let rhs_leaf = leaf(4, 2, (0, 1), &[], false);
        let lhs = source(vec![fold(1, (0, 1), false, vec![lhs_leaf.clone()])]);
        let mut rhs_fold = fold(3, (0, 1), false, vec![rhs_leaf.clone()]);
        rhs_fold.fold_state_id = 1;
        let rhs = source(vec![rhs_fold]);
        let cleaned = remove_redundant_folds(Pairing::Both { lhs, rhs });
        assert_eq!(cleaned.lhs().unwrap().root.children(), &[lhs_leaf]);
        assert_eq!(cleaned.rhs().unwrap().root.children(), &[rhs_leaf]);
    }

    #[test]
    fn counts_span_lines_and_every_line_of_a_one_sided_leaf() {
        let rhs = source(vec![
            // paired leaf: only the lines with spans count (two, one twice)
            leaf(0, 1, (0, 3), &[0, 1, 1], false),
            // paired leaf without spans: unchanged context, not counted
            leaf(1, 9, (3, 4), &[], false),
            // one-sided leaf with no spans (blank lines): every line counts
            leaf(2, 2, (4, 6), &[], false),
            // collapsed leaf: hidden
            leaf(3, 3, (6, 9), &[6, 7], true),
            // open fold with an open one-sided leaf: every line counts
            fold(4, (9, 12), false, vec![leaf(5, 5, (9, 12), &[10], false)]),
            // collapsed fold: its open child is hidden by the ancestor
            fold(
                6,
                (12, 15),
                true,
                vec![leaf(7, 7, (12, 15), &[13, 14], false)],
            ),
        ]);
        let lhs = source(vec![
            leaf(8, 1, (0, 3), &[0], false),
            leaf(9, 9, (3, 4), &[], false),
            leaf(10, 8, (4, 7), &[4, 5], true),
        ]);
        let mut sides = Pairing::Both { lhs, rhs };
        name_pairs(&mut sides);
        let coverage = change_coverage(&sides);
        assert_eq!(coverage.all.head, vec![[0, 2], [4, 15]]);
        assert_eq!(coverage.all.base, vec![[0, 1], [4, 7]]);
        let counts = coverage.initially_visible.counts();
        assert_eq!(counts.added, 2 + 2 + 3);
        assert_eq!(counts.removed, 1);
    }

    #[test]
    fn changing_fold_visibility_never_changes_complete_coverage() {
        let lhs = source(vec![leaf(1, 7, (0, 3), &[], false)]);
        let rhs = source(vec![fold(
            2,
            (0, 3),
            true,
            vec![fold(
                3,
                (0, 3),
                false,
                vec![leaf(4, 7, (0, 3), &[2, 0, 0], false)],
            )],
        )]);
        let mut sides = Pairing::Both { lhs, rhs };
        name_pairs(&mut sides);
        let hidden = change_coverage(&sides);
        assert_eq!(hidden.all.head, vec![[0, 1], [2, 3]]);
        assert!(hidden.all.base.is_empty()); // Added tokens do not imply removed tokens.
        assert_eq!(hidden.initially_visible.counts().added, 0);
        if let Pairing::Both { rhs, .. } = &mut sides {
            let Node::Fold { children, .. } = &mut rhs.root.node else {
                unreachable!("a root is a fold");
            };
            children[0].visibility.collapsed = false;
        }
        let opened = change_coverage(&sides);
        assert_eq!(opened.all, hidden.all);
        assert_eq!(opened.initially_visible, opened.all);
    }

    #[test]
    fn deleted_blank_lines_and_empty_files_have_complete_coverage() {
        let lhs = source(vec![leaf(1, 0, (0, 2), &[], true)]);
        let deleted = change_coverage(&Pairing::LeftOnly { lhs });
        assert_eq!(deleted.all.base, vec![[0, 2]]);
        assert!(deleted.all.head.is_empty());
        assert_eq!(deleted.initially_visible.counts().removed, 0);
        let empty = change_coverage(&Pairing::RightOnly {
            rhs: source(vec![]),
        });
        assert_eq!(empty.all, StructuralChanges::default());
    }

    #[test]
    fn a_missing_side_counts_nothing() {
        let rhs = source(vec![leaf(0, 1, (0, 1), &[0], false)]);
        let counts = change_coverage(&Pairing::RightOnly { rhs })
            .initially_visible
            .counts();
        assert_eq!(counts.added, 1);
        assert_eq!(counts.removed, 0);
    }
}
