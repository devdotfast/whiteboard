//! File tags. The classifier plugin decides them before anything is diffed;
//! the host only reads `generated`, which diffs a file as text, and checks the
//! names of custom tags.

/// The tag that makes a file diff as text.
pub(crate) const GENERATED: &str = "generated";

/// A tag name: lowercase letters, digits, `-` and `_`, starting with a letter
/// or digit.
pub(crate) fn is_tag(tag: &str) -> bool {
    tag.chars()
        .next()
        .is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit())
        && tag
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}
