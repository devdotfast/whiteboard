//! Data types summarising the result of diffing content.

use std::fmt::Display;

use crate::parse::folds::Fold;
use crate::parse::guess_language::{self, language_name};
use crate::parse::syntax::MatchedPos;

#[derive(Debug, PartialEq, Eq)]
pub enum FileContent {
    Text(String),
    Binary,
}

#[derive(Debug, Clone)]
pub enum FileFormat {
    SupportedLanguage(guess_language::Language),
    PlainText,
    /// A file in a supported language diffed by line: `cause` says why, and
    /// `reason` says so in prose, with the numbers.
    TextFallback {
        cause: FallbackCause,
        reason: String,
    },
    Binary,
}

/// Why a file in a supported language was diffed by line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FallbackCause {
    /// A side is larger than the byte limit.
    ByteLimit,
    /// The AST matching graph grew past the graph limit.
    GraphLimit,
    /// A side has more parse errors than the parse error limit.
    ParseErrorLimit,
    /// The file is tagged `generated`, and so is never parsed.
    Generated,
    /// The classifier hid the file, and so it is never parsed.
    Hidden,
}

impl Display for FileFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SupportedLanguage(language) => write!(f, "{}", language_name(*language)),
            Self::PlainText => write!(f, "Text"),
            Self::TextFallback { reason, .. } => write!(f, "Text ({})", reason),
            Self::Binary => write!(f, "Binary"),
        }
    }
}

/// A highlight capture: a byte interval and its capture name, such as
/// `keyword.return`.
pub type Highlight = (usize, usize, &'static str);

#[derive(Debug)]
pub struct DiffResult {
    pub file_format: FileFormat,
    pub lhs_src: FileContent,
    pub rhs_src: FileContent,
    pub lhs_folds: Vec<Fold>,
    pub rhs_folds: Vec<Fold>,
    /// Highlight captures of each parsed side, when the options asked for
    /// them. A file diffed by line still has them if it parsed.
    pub lhs_highlights: Vec<Highlight>,
    pub rhs_highlights: Vec<Highlight>,

    pub lhs_positions: Vec<MatchedPos>,
    pub rhs_positions: Vec<MatchedPos>,
}
