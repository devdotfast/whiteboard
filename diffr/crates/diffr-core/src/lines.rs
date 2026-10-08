//! Manipulate lines of text and groups of lines.

use line_numbers::LineNumber;

/// Split `s` on \n or \r\n. Always yields at least one item. Each line
/// does not include the trailing newline.
///
/// This differs from `str::lines`, which considers `""` to be zero
/// lines and `"foo\n"` to be one line.
pub(crate) fn split_on_newlines(s: &str) -> impl Iterator<Item = &str> {
    s.split('\n').map(|l| {
        if let Some(l) = l.strip_suffix('\r') {
            l
        } else {
            l
        }
    })
}

pub(crate) fn is_all_whitespace(s: &str) -> bool {
    s.chars().all(|c| c.is_whitespace())
}

/// A nonempty source interval with an exclusive end. Coordinates must be
/// ordered, in bounds, and on UTF-8 boundaries in the associated text source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct SourceRange {
    pub(crate) start: SourcePosition,
    pub(crate) end: SourcePosition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct SourcePosition {
    pub(crate) line: LineNumber,
    /// Zero-based UTF-8 byte offset within the line, not a display column.
    pub(crate) byte_column: usize,
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn test_split_line_empty() {
        assert_eq!(split_on_newlines("").collect::<Vec<_>>(), vec![""]);
    }

    #[test]
    fn test_split_line_single() {
        assert_eq!(split_on_newlines("foo").collect::<Vec<_>>(), vec!["foo"]);
    }

    #[test]
    fn test_split_line_with_newline() {
        assert_eq!(
            split_on_newlines("foo\nbar").collect::<Vec<_>>(),
            vec!["foo", "bar"]
        );
    }

    #[test]
    fn test_split_line_with_crlf() {
        assert_eq!(
            split_on_newlines("foo\r\nbar").collect::<Vec<_>>(),
            vec!["foo", "bar"]
        );
    }

    #[test]
    fn test_split_line_with_trailing_newline() {
        assert_eq!(
            split_on_newlines("foo\nbar\n").collect::<Vec<_>>(),
            vec!["foo", "bar", ""]
        );
    }

    #[test]
    fn test_is_all_whitespace() {
        assert!(is_all_whitespace(" \n\t"));
    }
}
