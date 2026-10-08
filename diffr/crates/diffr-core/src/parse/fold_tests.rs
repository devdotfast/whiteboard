//! End-to-end fold checks: folds found by the parse, paired by the matcher,
//! over small sources and the real PR fixtures under examples/review/real.
use crate::lines::{SourcePosition, SourceRange};

fn text<'a>(source: &'a str, range: &SourceRange) -> &'a str {
    let offset = |p: &SourcePosition| {
        let line = p.line.as_usize();
        let prefix = source
            .split_inclusive('\n')
            .take(line)
            .map(str::len)
            .sum::<usize>();
        prefix + p.byte_column
    };
    let start = offset(&range.start);
    let end = offset(&range.end);
    assert!(start < end, "nonempty ranges");
    &source[start..end] // Bounds and UTF-8 boundary validation.
}

mod folds {
    use super::text;
    use crate::config::Config;
    use crate::lines::SourceRange;
    use crate::parse::folds::{Fold, FoldMatch};
    use crate::summary::DiffResult;
    use std::fmt::Write as _;

    #[test]
    fn shared_interiors_work_without_the_context_plugin() {
        let specimens = [
            ("a.rs", "fn f() { dispatch(\n  first,\n  middle,\n  last,\n); }\n"),
            ("a.go", "package a\nfunc f() { dispatch(\n  first,\n  middle,\n  last,\n) }\n"),
            ("a.py", "def f():\n    dispatch(\n        first,\n        middle,\n        last,\n    )\n"),
            ("a.js", "dispatch(\n  first,\n  middle,\n  last,\n);\n"),
            ("a.ts", "interface Props { value: string }\ndispatch(\n  first,\n  middle,\n  last,\n);\n"),
            ("a.jsx", "const view = <Panel>\n  {dispatch(\n    first,\n    middle,\n    last,\n  )}\n</Panel>;\n"),
            ("a.tsx", "interface Props { value: string }\nconst view = <Panel>\n  {dispatch(\n    first,\n    middle,\n    last,\n  )}\n</Panel>;\n"),
        ];
        for plugin in ["deleted-bodies", "test-bodies", "removed-runs", "summarize"] {
            let config = format!(
                "[plugins.shape]\norder = ['bundled.{plugin}']\n[plugins.shape.bundled.{plugin}]\nenabled = true\n"
            );
            let params = Config::from_toml(&config).unwrap().compile().unwrap();
            for (path, source) in specimens {
                let after = source.replace("middle", "next");
                let result = DiffResult::from_sources_with_params(path, source, &after, &params);
                assert!(
                    result.rhs_folds.iter().any(|fold| {
                        let interior = text(&after, &fold.range).trim();
                        interior.starts_with("first,")
                            && interior.ends_with("last,")
                            && interior.contains("next,")
                    }),
                    "multiline call interior missing for {path}, plugin {plugin}"
                );
            }
        }
    }

    /// The fold on the other side matched with `fold`, if any.
    fn counterpart<'a>(fold: &Fold, other_side: &'a [Fold]) -> Option<&'a Fold> {
        let FoldMatch::Matched { opposite } = fold.match_kind else {
            return None;
        };
        let other = other_side
            .iter()
            .find(|other| other.syntax_id == opposite)
            .expect("a matched fold's opposite is a fold");
        Some(other)
    }
    /// A fold's range and its counterpart's, when it has one.
    fn paired<'a>(
        fold: &'a Fold,
        other_side: &'a [Fold],
    ) -> Option<(&'a SourceRange, &'a SourceRange)> {
        counterpart(fold, other_side).map(|other| (&fold.range, &other.range))
    }
    /// A fold's range, when it has no counterpart.
    fn added<'a>(fold: &'a Fold, other_side: &[Fold]) -> Option<&'a SourceRange> {
        match counterpart(fold, other_side) {
            Some(_) => None,
            None => Some(&fold.range),
        }
    }

    #[test]
    fn renamed_function_with_changed_body_uses_structural_correspondence() {
        let lhs = "fn run() {\n    old_work();\n}\n";
        let rhs = "fn execute() {\n    old_work();\n    new_work();\n}\n";
        let diff = DiffResult::from_sources("a.rs", lhs, rhs);
        assert!(diff.lhs_folds.iter().any(|f| {
            paired(f, &diff.rhs_folds).is_some_and(|(l, r)| {
                l.start.line.as_usize() == 0
                    && l.end.line.as_usize() == 2
                    && r.end.line.as_usize() == 3
            })
        }));
    }

    #[test]
    fn call_arguments_are_not_fold_candidates() {
        let diff =
            DiffResult::from_sources("a.rs", "", "fn run() {\n    call(123, other(456));\n}\n");
        assert_eq!(diff.rhs_folds.len(), 1);
    }

    #[test]
    fn multiline_atoms_and_test_bodies_keep_fold_metadata() {
        let src = "def test_read():\n    value = \"\"\"first\nsecond\"\"\"\n    return value\n";
        let result = DiffResult::from_sources("a.py", "", src);
        assert!(result
            .rhs_folds
            .iter()
            .any(|fold| fold.tags.iter().any(|tag| tag == "test-bodies:test")));
        assert!(result
            .rhs_folds
            .iter()
            .any(|fold| added(fold, &result.lhs_folds)
                .is_some_and(|r| text(src, r) == "\"\"\"first\nsecond\"\"\"")));
    }

    #[test]
    fn flattened_test_body_keeps_the_existing_string_match_on_both_sides() {
        let lhs = "def test_doc():\n    \"\"\"some shared words before\"\"\"\n";
        let rhs = "def test_doc():\n    \"\"\"some shared words after\"\"\"\n";
        let result = DiffResult::from_sources("a.py", lhs, rhs);
        // The body and string fold the same lines, so one fold on the string
        // carries both tags.
        assert_eq!(result.lhs_folds.len(), 1);
        assert_eq!(result.rhs_folds.len(), 1);
        let fold = &result.lhs_folds[0];
        for tag in ["deleted-bodies:docstring", "deleted-bodies:function"] {
            assert!(fold.tags.iter().any(|t| t == tag), "{tag}: {:?}", fold.tags);
        }
        let (left, right) =
            paired(fold, &result.rhs_folds).expect("reuse the replaced-string correspondence");
        assert_eq!(text(lhs, left), "\"\"\"some shared words before\"\"\"");
        assert_eq!(text(rhs, right), "\"\"\"some shared words after\"\"\"");
    }

    #[test]
    fn imports_remain_individual_typed_folds() {
        let source = "import os\nimport sys\n";
        for (lhs, rhs) in [
            (
                "import os\nimport sys\nx = 1\n",
                "import os\nimport sys\nx = 2\n",
            ),
            ("", source),
            (source, ""),
        ] {
            let diff = DiffResult::from_sources("a.py", lhs, rhs);
            for (folds, own, opposite, opposite_folds) in [
                (&diff.lhs_folds, lhs, rhs, &diff.rhs_folds),
                (&diff.rhs_folds, rhs, lhs, &diff.lhs_folds),
            ] {
                if own.is_empty() {
                    assert!(folds.is_empty());
                    continue;
                }
                assert_eq!(folds.len(), 2);
                for (fold, expected) in folds.iter().zip(["import os", "import sys"]) {
                    assert!(fold.tags.is_empty(), "imports are untagged structure");
                    assert_eq!(text(own, &fold.range), expected);
                    match counterpart(fold, opposite_folds) {
                        Some(other) => assert_eq!(text(opposite, &other.range), expected),
                        None => assert!(opposite.is_empty()),
                    }
                }
            }
        }
    }

    #[test]
    fn imports_outside_displayed_context_remain_available() {
        let mut body = String::new();
        for i in 0..30 {
            writeln!(body, "    value_{i} = {i}").unwrap();
        }
        let lhs = format!("import os\n\ndef run():\n{body}\n");
        let rhs = lhs.replace("value_29 = 29", "value_29 = 999");
        let diff = DiffResult::from_sources("a.py", &lhs, &rhs);
        assert!(diff
            .lhs_folds
            .iter()
            .any(|f| text(&lhs, &f.range) == "import os"));
    }

    #[test]
    fn import_folds_remain_one_sided_when_file_added_or_deleted() {
        let source = "import os\n\ndef f():\n    return os.getcwd()\n";
        let added_diff = DiffResult::from_sources("a.py", "", source);
        assert!(added_diff.lhs_folds.is_empty());
        assert_eq!(
            text(
                source,
                added(&added_diff.rhs_folds[0], &added_diff.lhs_folds).unwrap()
            ),
            "import os"
        );
        let deleted_diff = DiffResult::from_sources("a.py", source, "");
        assert!(deleted_diff.rhs_folds.is_empty());
        assert_eq!(
            text(
                source,
                added(&deleted_diff.lhs_folds[0], &deleted_diff.rhs_folds).unwrap()
            ),
            "import os"
        );
    }

    #[test]
    fn nested_try_catch_bodies_pair_and_keep_delimiters() {
        let lhs = "function run() {\n  try {\n    work(1);\n  } catch (error) {\n    report(error);\n  }\n}\n";
        let rhs = lhs.replace("work(1)", "work(2)");
        let review = DiffResult::from_sources("a.ts", lhs, &rhs);
        for expected in [
            "\n  try {\n    work(1);\n  } catch (error) {\n    report(error);\n  }\n",
            "\n    work(1);\n  ",
            "\n    report(error);\n  ",
        ] {
            let expected_rhs = expected.replace("work(1)", "work(2)");
            assert!(
                review.lhs_folds.iter().any(|f| {
                    paired(f, &review.rhs_folds).is_some_and(|(l, r)| {
                        text(lhs, l) == expected && text(&rhs, r) == expected_rhs
                    })
                }),
                "missing paired fold for {expected:?}"
            );
        }
    }

    #[test]
    fn added_rust_test_body_is_foldable_without_hiding_signature_or_brace() {
        let lhs = include_str!("../../examples/review/real/08-ripgrep-3496/before.rs");
        let rhs = include_str!("../../examples/review/real/08-ripgrep-3496/after.rs");
        let review = DiffResult::from_sources("walk.rs", lhs, rhs);
        let signature = rhs
            .lines()
            .position(|l| l.contains("fn max_depth_does_not_load_unreachable_ignore_files()"))
            .unwrap();
        assert!(review.rhs_folds.iter().any(|f| {
            added(f, &review.lhs_folds).is_some_and(|r| {
                r.start.line.as_usize() == signature
                    && text(rhs, r).contains("let td = tmpdir();")
                    && rhs.lines().nth(r.end.line.as_usize()).unwrap().trim() == "}"
            })
        }));
    }

    #[test]
    fn python_suites_and_go_blocks_are_foldable() {
        for (path, src, expected) in [
            (
                "a.py",
                "def run():\n    try:\n        work()\n    except Exception:\n        recover()\n",
                "\n        work()",
            ),
            (
                "a.go",
                "package main\nfunc run() {\n    if ready {\n        work()\n    }\n}\n",
                "\n        work()\n    ",
            ),
        ] {
            let review = DiffResult::from_sources(path, "", src);
            assert!(
                review
                    .rhs_folds
                    .iter()
                    .any(|f| added(f, &review.lhs_folds).is_some_and(|r| text(src, r) == expected)),
                "missing body fold in {path}"
            );
        }
    }

    #[test]
    fn a_body_fold_indents_at_its_first_statement_and_keeps_its_exact_span() {
        // Each body's (indent line, column) and the text between its opener
        // and closer; Go's label is outdented, so the statement it labels
        // gives the indent.
        for (path, src, indent, span) in [
            (
                "a.rs",
                "fn run() {\n    work();\n    rest();\n}\n",
                (1, 4),
                "\n    work();\n    rest();\n",
            ),
            (
                "a.py",
                "def run():\n    work()\n    rest()\n",
                (1, 4),
                "\n    work()\n    rest()",
            ),
            (
                "a.js",
                "function run() {\n  work();\n  rest();\n}\n",
                (1, 2),
                "\n  work();\n  rest();\n",
            ),
            (
                "a.go",
                "package main\nfunc run() {\nretry:\n\tif try() {\n\t\tgoto retry\n\t}\n\trest()\n}\n",
                (3, 1),
                "\nretry:\n\tif try() {\n\t\tgoto retry\n\t}\n\trest()\n",
            ),
        ] {
            let review = DiffResult::from_sources(path, "", src);
            let body = review
                .rhs_folds
                .iter()
                .find(|fold| fold.syntax.is_some_and(|syntax| text(src, &syntax) == span))
                .unwrap_or_else(|| panic!("no body fold in {path}"));
            assert_eq!(
                (body.indent.line.as_usize(), body.indent.byte_column),
                indent,
                "{path}"
            );
        }
    }

    #[test]
    fn two_queries_folding_the_same_lines_make_one_fold() {
        // A function whose body is one `match`: the block the shared query
        // folds and the `match` the context query folds cover the same
        // lines, so they are one fold. It is the `match`'s, the innermost
        // node whose extent that region is, and it carries both tags and
        // the block's braces, since the `match` has no opener of its own.
        let src =
            "fn f(x: u32) -> u32 {\n    match x {\n        1 => 2,\n        _ => 3,\n    }\n}\n";
        let params = crate::config::Config::from_toml("")
            .expect("a valid configuration")
            .compile()
            .expect("the bundled queries compile");
        let review = DiffResult::from_sources_with_params("a.rs", "", src, &params);
        let lines: Vec<&str> = src.split_terminator('\n').collect();
        let same_lines: Vec<&Fold> = review
            .rhs_folds
            .iter()
            .filter(|fold| crate::parse::folds::line_span(&fold.range, &lines) == (1, 5))
            .collect();
        assert_eq!(same_lines.len(), 1, "{same_lines:#?}");
        assert_eq!(
            text(src, &same_lines[0].range),
            "match x {\n        1 => 2,\n        _ => 3,\n    }"
        );
        assert!(
            same_lines[0].tags.iter().any(|tag| tag == "context:scope"),
            "{:?}",
            same_lines[0].tags
        );
        let syntax = same_lines[0].syntax.expect("the block's opener and closer");
        assert_eq!(
            text(src, &syntax),
            "\n    match x {\n        1 => 2,\n        _ => 3,\n    }\n"
        );
    }

    #[test]
    fn inline_collections_have_exact_paired_byte_ranges() {
        let lhs = "const x = [\"☕\", oldValue];\n";
        let rhs = "const x = [\"☕\", newValue];\n";
        let review = DiffResult::from_sources("a.ts", lhs, rhs);
        assert!(review.lhs_folds.iter().any(|f| {
            paired(f, &review.rhs_folds).is_some_and(|(l, r)| {
                text(lhs, l) == "\"☕\", oldValue" && text(rhs, r) == "\"☕\", newValue"
            })
        }));
    }
}

mod matcher {
    use crate::parse::folds::FoldMatch;
    use crate::parse::syntax::MatchKind;
    use crate::summary::DiffResult;

    #[test]
    fn a_reindented_rename_target_stays_an_unchanged_token() {
        let lhs = include_str!("../../examples/review/real/02-review-175/before.ts");
        let rhs = include_str!("../../examples/review/real/02-review-175/after.ts");
        let review = DiffResult::from_sources("parser.ts", lhs, rhs);
        let token = review
            .lhs_positions
            .iter()
            .find(|p| p.pos.line.0 == 247 && p.pos.start_col == 6)
            .unwrap();
        let MatchKind::UnchangedToken { opposite_pos, .. } = &token.kind else {
            panic!(
                "the renamed binding is an unchanged token: {:?}",
                token.kind
            );
        };
        assert_eq!(
            (opposite_pos[0].line.0, opposite_pos[0].start_col),
            (253, 8)
        );
        assert!(matches!(
            review.lhs_folds[0].match_kind,
            FoldMatch::Matched { .. }
        ));
    }
}

mod results {
    use super::text;
    use crate::line_layout::aligned_rows;
    use crate::parse::folds::FoldMatch;
    use crate::summary::{DiffResult, FileContent, FileFormat};

    #[test]
    fn new_and_deleted_functions_have_folds() {
        let source = "fn run() {\n    work();\n}\n";
        for (lhs, rhs) in [("", source), (source, "")] {
            let diff = DiffResult::from_sources("a.rs", lhs, rhs);
            assert!(!diff.lhs_folds.is_empty() || !diff.rhs_folds.is_empty());
        }
    }

    #[test]
    fn unicode_and_crlf_sources_are_kept_exactly() {
        let lhs =
            "def café():\r\n    x = 1\r\n    return (\r\n        x,\r\n\r\n        '☕',\r\n    )\r\n";
        let rhs = lhs.replace("x = 1", "x = 2");
        let result = DiffResult::from_sources("a.py", lhs, &rhs);
        assert!(matches!(&result.rhs_src, FileContent::Text(s) if s == &rhs));
    }

    #[test]
    fn identical_files_keep_alignment_for_showing_hidden_source() {
        let source = "fn unchanged() {\n    work();\n}\n";
        let diff = DiffResult::from_sources("a.rs", source, source);
        let rows = aligned_rows((source, source), (&diff.lhs_positions, &diff.rhs_positions));
        assert_eq!(
            rows,
            [(Some(0), Some(0)), (Some(1), Some(1)), (Some(2), Some(2))]
        );
    }

    #[test]
    fn unsupported_language_uses_text_diff_without_folds() {
        let result = DiffResult::from_sources("a.txt", "hello old\n", "hello new\n");
        assert!(matches!(result.file_format, FileFormat::PlainText));
        assert!(result.lhs_folds.is_empty() && result.rhs_folds.is_empty());
    }

    #[test]
    fn real_fixture_folds_have_valid_reciprocal_ranges() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/review/real");
        for dir in std::fs::read_dir(root).unwrap() {
            let dir = dir.unwrap().path();
            let p: serde_json::Value =
                serde_json::from_slice(&std::fs::read(dir.join("provenance.json")).unwrap())
                    .unwrap();
            let read_source = |side: &str| {
                std::fs::read_to_string(dir.join(p["sources"][side]["file"].as_str().unwrap()))
                    .unwrap()
            };
            let (lhs_src, rhs_src) = (read_source("lhs"), read_source("rhs"));
            let path = p["sources"]["rhs"]["path"].as_str().unwrap();
            let result = DiffResult::from_sources(path, &lhs_src, &rhs_src);
            for (folds, own_src, opposite_src, opposite_folds) in [
                (&result.lhs_folds, &lhs_src, &rhs_src, &result.rhs_folds),
                (&result.rhs_folds, &rhs_src, &lhs_src, &result.lhs_folds),
            ] {
                for fold in folds {
                    text(own_src, &fold.range);
                    let counterparts: Vec<_> = opposite_folds
                        .iter()
                        .filter(|other| {
                            fold.match_kind
                                == FoldMatch::Matched {
                                    opposite: other.syntax_id,
                                }
                        })
                        .collect();
                    assert!(
                        counterparts.len() <= 1,
                        "a fold has at most one counterpart"
                    );
                    for other in counterparts {
                        text(opposite_src, &other.range);
                        assert_eq!(
                            other.match_kind,
                            FoldMatch::Matched {
                                opposite: fold.syntax_id
                            },
                            "matched folds must be reciprocal"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn byte_limit_fallback_has_no_folds() {
        let options = crate::options::DiffOptions {
            byte_limit: 1,
            ..Default::default()
        };
        let diff = crate::engine::diff_file_content(
            &crate::config::Params::default(),
            "a.py",
            "x = 1\n",
            "x = 2\n",
            &options,
            &[],
        )
        .unwrap();
        assert!(matches!(diff.file_format, FileFormat::TextFallback { .. }));
        assert!(diff.lhs_folds.is_empty() && diff.rhs_folds.is_empty());
    }
}
