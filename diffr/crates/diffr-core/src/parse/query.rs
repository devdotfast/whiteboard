//! Source-coordinate helpers for the annotation queries.
use crate::lines::{SourcePosition, SourceRange};
use tree_sitter::Node;

pub(super) fn node_range(node: Node<'_>) -> SourceRange {
    let position = |point: tree_sitter::Point| SourcePosition {
        line: (point.row as u32).into(),
        byte_column: point.column,
    };
    SourceRange {
        start: position(node.start_position()),
        end: position(node.end_position()),
    }
}
