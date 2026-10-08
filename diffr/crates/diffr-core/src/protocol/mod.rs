//! The NDJSON wire protocol between diffr and its frontends.
//!
//! One `Event` per line: a `start` header, one `file` record per changed
//! file in completion order, and a `complete` footer. Every enum on the
//! wire is internally tagged with a `type` (or `kind`) key in snake_case.
//! Optional, empty, and default fields are omitted, never `null`. Consumers
//! ignore unknown fields and tolerate unknown enum strings.
//!
//! Coordinates: lines are 0-based and split on `\n` only, so an empty file
//! has zero lines and a file without a trailing newline still counts its
//! last line. Columns are 0-based byte offsets into the UTF-8 text on the
//! wire. All ranges are half-open.
//!
//! Records end at `\n` only. U+0085, U+2028 and U+2029 are written as
//! `\u0085`, `\u2028` and `\u2029`, because some line readers also end a
//! line at them.
//!
//! Sides are always `lhs` (before) and `rhs` (after). A `Pairing` says which
//! sides exist and serializes by presence: `{lhs, rhs}`, `{lhs}`, or `{rhs}`.

use std::io::{self, Write};

use serde::{Deserialize, Serialize};
use serde_json::ser::Formatter;

use crate::pairing::Pairing;

pub mod project;

/// The current wire version. Changes within a version are additive.
pub const VERSION: u32 = 3;

/// Write `event` as one record: compact JSON and a `\n`.
pub fn write_record<W: Write>(writer: &mut W, event: &Event) -> serde_json::Result<()> {
    event.serialize(&mut serde_json::Serializer::with_formatter(
        &mut *writer,
        RecordFormatter,
    ))?;
    writer.write_all(b"\n").map_err(serde_json::Error::io)
}

/// Compact JSON that also escapes U+0085, U+2028 and U+2029.
struct RecordFormatter;

impl Formatter for RecordFormatter {
    fn write_string_fragment<W: ?Sized + Write>(
        &mut self,
        writer: &mut W,
        fragment: &str,
    ) -> io::Result<()> {
        fragment
            .split_inclusive(['\u{85}', '\u{2028}', '\u{2029}'])
            .try_for_each(|piece| {
                let mut chars = piece.chars();
                let escape: &[u8] = match chars.next_back() {
                    Some('\u{85}') => b"\\u0085",
                    Some('\u{2028}') => b"\\u2028",
                    Some('\u{2029}') => b"\\u2029",
                    _ => return writer.write_all(piece.as_bytes()),
                };
                writer.write_all(chars.as_str().as_bytes())?;
                writer.write_all(escape)
            })
    }
}

// ── stream ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[allow(clippy::large_enum_variant)]
pub enum Event {
    /// The header. Sent once, before any result, so a frontend can lay out
    /// every file up front.
    Start {
        version: u32,
        lhs: Snapshot,
        rhs: Snapshot,
        files: Vec<FileChange>,
    },
    /// One result. `file` is byte-identical to the manifest entry it
    /// answers; the path pair is the identity.
    File {
        file: Pairing<FileRef>,
        #[serde(flatten)]
        outcome: Outcome,
    },
    /// The footer. `aborted` is present when a run-level failure stopped
    /// the comparison early; every file already emitted stays valid.
    Complete {
        succeeded: u32,
        failed: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        aborted: Option<Problem>,
    },
}

/// Exactly one of `diff` or `error` appears on a `file` record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Outcome {
    Diff { diff: Diff },
    Error { error: Problem },
}

/// What one end of the comparison is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Snapshot {
    Revision {
        rev: String,
    },
    Index,
    WorkingTree,
    EmptyTree,
    /// A file on disk, for `--no-index`.
    Path {
        path: String,
    },
}

/// The one error shape, used for a file failure, a run abort, and a
/// structural fallback. `code` is an open snake_case set. Internal code
/// carries `anyhow::Error`; the stream writer builds this record from one
/// just before serializing it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Problem {
    pub code: String,
    pub message: String,
}

// ── manifest entry ────────────────────────────────────────────────────────

/// One changed file, known before any diffing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileChange {
    /// `LeftOnly` is a deletion, `RightOnly` an addition.
    pub file: Pairing<FileRef>,
    pub status: FileStatus,
    /// What the file is, such as `generated`, `vendored`, `docs` or `test`,
    /// from bundled Linguist rules and git attributes. Sorted and
    /// deduplicated.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

/// Git's change status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileStatus {
    Added,
    Deleted,
    Modified,
    Renamed,
    Copied,
    TypeChanged,
}

/// One side of a git delta.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileRef {
    pub path: String,
    pub oid: String,
    /// Git's octal mode text, e.g. `100644`.
    pub mode: String,
}

/// How a file or region starts out. `label` is shown while collapsed: a
/// reason for a file, a placeholder or pseudocode summary for a region.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Visibility {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub collapsed: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
}

impl Visibility {
    /// Open and unlabelled, which is how a missing `visibility` reads.
    pub fn is_unset(&self) -> bool {
        !self.collapsed && self.label.is_empty()
    }
}

// ── per-file result ───────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Diff {
    Text {
        #[serde(flatten)]
        sides: Pairing<Source>,
        stats: Stats,
        /// All structurally changed lines, including content hidden by folds.
        structural_changes: StructuralChanges,
    },
    /// Either side being binary makes the whole diff binary.
    Binary {
        #[serde(flatten)]
        sides: Pairing<BinaryRef>,
    },
}

/// One side's text, colors, and regions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Source {
    pub text: String,
    /// Every token with its tree-sitter capture name. Per line, sorted,
    /// non-overlapping. Empty unless the run asked for syntax.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub syntax: Vec<SyntaxSpan>,
    /// The whole file, as one fold. Both sides' roots share one
    /// fold_state_id, and its visibility is the file's.
    pub root: Region,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BinaryRef {
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyntaxSpan {
    pub line: u32,
    pub start_column: u32,
    pub end_column: u32,
    /// A tree-sitter capture name such as `keyword` or `function.method`.
    pub capture: String,
}

/// A range on one side, carrying identities that must never be conflated.
/// `id` names the region. `fold_state_id` says what the region *opens and
/// closes with*: regions sharing it open and close together, on the same
/// side or across sides. Paired leaves and matched folds have the same
/// value on both sides; a plugin's link gives it to several regions. A
/// leaf's `alignment_id` (see `Node::Leaf`) is row alignment; folds have
/// none. Consumers key the row zip by leaf `alignment_id`, collapse state by
/// `fold_state_id`, and anything about the region itself by `id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Region {
    /// Names this region, unique within the file (across both sides).
    /// Plugin moves address it.
    pub id: u32,
    pub fold_state_id: u32,
    #[serde(flatten)]
    pub range: SourceRange,
    /// On folds, the tags the fold queries set, written `<plugin>:<name>`
    /// (`deleted-bodies:function`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Whether the region starts collapsed, and the label shown while it is.
    /// Absent means open.
    #[serde(default, skip_serializing_if = "Visibility::is_unset")]
    pub visibility: Visibility,
    #[serde(flatten)]
    pub node: Node,
}

impl Region {
    /// A side's root: one fold whose children tile the file.
    pub fn root(id: u32, children: Vec<Region>) -> Self {
        let start = SourcePos { line: 0, column: 0 };
        Self {
            id,
            fold_state_id: id,
            range: SourceRange {
                start,
                end: children.last().map_or(start, |last| last.range.end),
            },
            tags: Vec::new(),
            visibility: Visibility::default(),
            node: Node::Fold {
                children,
                indent: start,
                syntax: None,
            },
        }
    }

    /// A fold's children; a leaf has none.
    pub fn children(&self) -> &[Region] {
        match &self.node {
            Node::Fold { children, .. } => children,
            Node::Leaf { .. } => &[],
        }
    }

    /// A leaf's row alignment; a fold has none.
    pub fn alignment_id(&self) -> Option<u32> {
        match self.node {
            Node::Leaf { alignment_id, .. } => Some(alignment_id),
            Node::Fold { .. } => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Node {
    /// Tiles the file. `changed` holds the byte ranges painted as changed
    /// within it; a fully new line carries one span covering it.
    Leaf {
        /// Row alignment: the leaf on the other side with the same value lines up with this one.
        /// Paired leaves have the same line count, their rows pair line for
        /// line, and they come in the same order on both sides. A leaf on
        /// one side only has a value no leaf on the other side carries.
        alignment_id: u32,
        /// The `id` of the leaf on the other side with the same
        /// `alignment_id`; absent when this leaf is added or deleted.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pair: Option<u32>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        changed: Vec<Span>,
    },
    /// A foldable region. Its range is the hull of its children.
    Fold {
        children: Vec<Region>,
        /// Where the fold's content starts. Collapsed rows sit at this column.
        indent: SourcePos,
        /// From the opener to the closer, before rounding to lines. None
        /// without an opener.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        syntax: Option<SourceRange>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub line: u32,
    pub start_column: u32,
    pub end_column: u32,
}

/// Half-open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceRange {
    pub start: SourcePos,
    pub end: SourcePos,
}

impl SourceRange {
    /// The lines this range touches, half-open. A range ending at column
    /// zero does not touch its end line.
    pub fn lines(&self) -> std::ops::Range<u32> {
        let end = if self.end.column == 0 {
            self.end.line
        } else {
            self.end.line + 1
        };
        self.start.line..end
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourcePos {
    pub line: u32,
    pub column: u32,
}

/// Zero-based, half-open source line interval: `[start, end)` on the wire.
pub type LineRange = [u32; 2];

/// Structural change coverage, independent of visibility. Ranges are sorted,
/// nonempty, disjoint, and coalesced when adjacent. A missing side has no ranges.
/// `base` refers to `lhs`; `head` refers to `rhs`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StructuralChanges {
    pub base: Vec<LineRange>,
    pub head: Vec<LineRange>,
}

impl StructuralChanges {
    pub fn counts(&self) -> LineCounts {
        let count = |ranges: &[LineRange]| ranges.iter().map(|[start, end]| end - start).sum();
        LineCounts {
            added: count(&self.head),
            removed: count(&self.base),
        }
    }
}

/// Line counts for one file. `fallback` is present exactly when the AST
/// match did not run and the alignment is a line diff, carrying why:
/// `too_complex`, `too_large`, `unsupported_language`, `parse_error`,
/// `generated`.
/// Folds are still present on a fallback whenever the language parsed,
/// paired through that alignment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stats {
    /// Lines with any byte change.
    pub textual: LineCounts,
    /// Changed lines still on screen under the default visibility: a
    /// changed line inside a region that starts collapsed, or under one,
    /// is not counted. Computed after the plugins run, so
    /// configuration changes it.
    pub visible: LineCounts,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<Problem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineCounts {
    pub added: u32,
    pub removed: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pos(line: u32, column: u32) -> SourcePos {
        SourcePos { line, column }
    }

    /// A leaf on the side whose ids start at `first`: the lhs numbers its
    /// regions first, and the rhs leaf shares the lhs leaf's fold state.
    fn leaf(first: u32, index: u32, start: u32, end: u32, changed: Vec<Span>) -> Region {
        Region {
            id: first + 1 + index,
            fold_state_id: 2 + index,
            range: SourceRange {
                start: pos(start, 0),
                end: pos(end, 0),
            },
            tags: vec![],
            visibility: Visibility::default(),
            node: Node::Leaf {
                alignment_id: index,
                pair: None,
                changed,
            },
        }
    }

    /// A paired function with one changed word: `fn f() { 1 }` became
    /// `fn f() { 1 + 2 }`. Each side numbers its four regions in turn.
    fn example_file() -> Event {
        let file_ref = |oid: &str| FileRef {
            path: "src/lib.rs".to_owned(),
            oid: oid.to_owned(),
            mode: "100644".to_owned(),
        };
        // The roots come last, 9 and 10, and share the lhs root's fold state.
        let side = |first: u32, root: u32, text: &str, changed: Vec<Span>| Source {
            text: text.to_owned(),
            syntax: vec![],
            root: Region {
                fold_state_id: 9,
                ..Region::root(
                    root,
                    vec![Region {
                        id: first,
                        fold_state_id: 1,
                        range: SourceRange {
                            start: pos(0, 0),
                            end: pos(3, 0),
                        },
                        tags: vec!["deleted-bodies:function".to_owned()],
                        visibility: Visibility::default(),
                        node: Node::Fold {
                            indent: pos(0, 0),
                            syntax: None,
                            children: vec![
                                leaf(first, 0, 0, 1, vec![]),
                                leaf(first, 1, 1, 2, changed),
                                leaf(first, 2, 2, 3, vec![]),
                            ],
                        },
                    }],
                )
            },
        };
        Event::File {
            file: Pairing::Both {
                lhs: file_ref("3b18e5"),
                rhs: file_ref("9be2c1"),
            },
            outcome: Outcome::Diff {
                diff: Diff::Text {
                    sides: Pairing::Both {
                        lhs: side(1, 9, "fn f() {\n    1\n}\n", vec![]),
                        rhs: side(
                            5,
                            10,
                            "fn f() {\n    1 + 2\n}\n",
                            vec![Span {
                                line: 1,
                                start_column: 5,
                                end_column: 9,
                            }],
                        ),
                    },
                    structural_changes: StructuralChanges {
                        base: vec![],
                        head: vec![[1, 2]],
                    },
                    stats: Stats {
                        textual: LineCounts {
                            added: 1,
                            removed: 1,
                        },
                        visible: LineCounts {
                            added: 1,
                            removed: 1,
                        },
                        fallback: None,
                    },
                },
            },
        }
    }

    #[test]
    fn file_record_serializes_to_the_documented_shape() {
        let region = |first: u32, changed: serde_json::Value| {
            let mut middle = json!({"id": first + 2, "fold_state_id": 3, "kind": "leaf", "alignment_id": 1, "start": {"line": 1, "column": 0}, "end": {"line": 2, "column": 0}});
            if let Some(spans) = changed.as_array().filter(|spans| !spans.is_empty()) {
                middle["changed"] = json!(spans);
            }
            json!({
                "id": first, "fold_state_id": 1, "kind": "fold", "tags": ["deleted-bodies:function"],
                "start": {"line": 0, "column": 0}, "end": {"line": 3, "column": 0},
                "indent": {"line": 0, "column": 0},
                "children": [
                    {"id": first + 1, "fold_state_id": 2, "kind": "leaf", "alignment_id": 0, "start": {"line": 0, "column": 0}, "end": {"line": 1, "column": 0}},
                    middle,
                    {"id": first + 3, "fold_state_id": 4, "kind": "leaf", "alignment_id": 2, "start": {"line": 2, "column": 0}, "end": {"line": 3, "column": 0}},
                ],
            })
        };
        let root = |id: u32, child: serde_json::Value| {
            json!({
                "id": id, "fold_state_id": 9, "kind": "fold",
                "start": {"line": 0, "column": 0}, "end": {"line": 3, "column": 0},
                "indent": {"line": 0, "column": 0}, "children": [child],
            })
        };
        let expected = json!({
            "type": "file",
            "file": {
                "lhs": {"path": "src/lib.rs", "oid": "3b18e5", "mode": "100644"},
                "rhs": {"path": "src/lib.rs", "oid": "9be2c1", "mode": "100644"},
            },
            "diff": {
                "type": "text",
                "lhs": {"text": "fn f() {\n    1\n}\n", "root": root(9, region(1, json!([])))},
                "rhs": {"text": "fn f() {\n    1 + 2\n}\n",
                        "root": root(10, region(5, json!([{"line": 1, "start_column": 5, "end_column": 9}])))},
                "stats": {"textual": {"added": 1, "removed": 1}, "visible": {"added": 1, "removed": 1}},
                "structural_changes": {"base": [], "head": [[1, 2]]},
            },
        });
        assert_eq!(serde_json::to_value(example_file()).unwrap(), expected);
    }

    #[test]
    fn every_event_round_trips() {
        let events = vec![
            Event::Start {
                version: VERSION,
                lhs: Snapshot::Revision {
                    rev: "main".to_owned(),
                },
                rhs: Snapshot::WorkingTree,
                files: vec![FileChange {
                    file: Pairing::RightOnly {
                        rhs: FileRef {
                            path: "gen/schema.json".to_owned(),
                            oid: "0e1f2a".to_owned(),
                            mode: "100644".to_owned(),
                        },
                    },
                    status: FileStatus::Added,
                    tags: vec!["generated".to_owned()],
                }],
            },
            example_file(),
            Event::File {
                file: Pairing::LeftOnly {
                    lhs: FileRef {
                        path: "old.bin".to_owned(),
                        oid: "aaaaaa".to_owned(),
                        mode: "100644".to_owned(),
                    },
                },
                outcome: Outcome::Diff {
                    diff: Diff::Binary {
                        sides: Pairing::LeftOnly {
                            lhs: BinaryRef { size: 4096 },
                        },
                    },
                },
            },
            Event::File {
                file: Pairing::Both {
                    lhs: FileRef {
                        path: "a.txt".to_owned(),
                        oid: "bbbbbb".to_owned(),
                        mode: "100644".to_owned(),
                    },
                    rhs: FileRef {
                        path: "a.txt".to_owned(),
                        oid: "cccccc".to_owned(),
                        mode: "100644".to_owned(),
                    },
                },
                outcome: Outcome::Error {
                    error: Problem {
                        code: "not_utf8".to_owned(),
                        message: "a.txt is not valid UTF-8".to_owned(),
                    },
                },
            },
            Event::Complete {
                succeeded: 2,
                failed: 1,
                aborted: Some(Problem {
                    code: "mutation_failed".to_owned(),
                    message: "mutation summarize: summarizer: gemini-3.8-flash: HTTP 503 Service Unavailable after 4 attempts".to_owned(),
                }),
            },
        ];
        for event in events {
            let line = serde_json::to_string(&event).unwrap();
            assert_eq!(
                serde_json::from_str::<Event>(&line).unwrap(),
                event,
                "{line}"
            );
        }
    }

    #[test]
    fn records_escape_line_separators() {
        let event = Event::Complete {
            succeeded: 0,
            failed: 1,
            aborted: Some(Problem {
                code: "x".to_owned(),
                message: "a\u{2028}b\u{2029}c\u{85}d\u{2028}".to_owned(),
            }),
        };
        let mut record = Vec::new();
        write_record(&mut record, &event).unwrap();
        let line = String::from_utf8(record).unwrap();
        assert!(
            line.ends_with("\"message\":\"a\\u2028b\\u2029c\\u0085d\\u2028\"}}\n"),
            "{line}"
        );
        assert_eq!(serde_json::from_str::<Event>(&line).unwrap(), event);
    }

    #[test]
    fn defaults_are_omitted() {
        let line = serde_json::to_string(&example_file()).unwrap();
        for absent in [
            "null",
            "visibility",
            "collapsed",
            "syntax",
            "fallback",
            "\"changed\":[]",
        ] {
            assert!(!line.contains(absent), "{absent} appeared in {line}");
        }
        let untagged = FileChange {
            file: Pairing::RightOnly {
                rhs: FileRef {
                    path: "a.rs".to_owned(),
                    oid: "0e1f2a".to_owned(),
                    mode: "100644".to_owned(),
                },
            },
            status: FileStatus::Added,
            tags: Vec::new(),
        };
        let line = serde_json::to_string(&untagged).unwrap();
        assert!(!line.contains("tags"), "{line}");
    }
}
