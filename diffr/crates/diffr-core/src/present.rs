//! What a diff looks like once the plugins have shaped it: the changed
//! lines that stay visible.
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
