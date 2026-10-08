//! The limits and switches one file's diff runs under.

use crate::summary::FallbackCause;

pub(crate) const DEFAULT_BYTE_LIMIT: usize = 1_000_000;
// Chosen experimentally: this is sufficiently many for all the sample
// files (the highest is slow_1.rs/slow_2.rs at 1.3M nodes), but
// small enough to terminate in ~5 seconds like the test file in #306.
pub(crate) const DEFAULT_GRAPH_LIMIT: usize = 3_000_000;
pub(crate) const DEFAULT_PARSE_ERROR_LIMIT: usize = 0;

#[derive(Debug, Clone)]
pub struct DiffOptions {
    pub graph_limit: usize,
    pub byte_limit: usize,
    pub parse_error_limit: usize,
    pub ignore_comments: bool,
    /// Diff the file by line without parsing, for this reason: it is
    /// generated or hidden.
    pub by_line: Option<FallbackCause>,
    /// Collect highlight captures from each parsed side.
    pub syntax: bool,
}

impl Default for DiffOptions {
    fn default() -> Self {
        Self {
            graph_limit: DEFAULT_GRAPH_LIMIT,
            byte_limit: DEFAULT_BYTE_LIMIT,
            parse_error_limit: DEFAULT_PARSE_ERROR_LIMIT,
            ignore_comments: false,
            by_line: None,
            syntax: false,
        }
    }
}
