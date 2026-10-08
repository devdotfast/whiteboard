//! Shared source-to-domain diff computation, independent of CLI and transport.
#[cfg(test)]
use crate::config::body_params;
use crate::config::Params;
use crate::constants::Side;
use crate::diff::changes::ChangeMap;
use crate::diff::shortest_path::{mark_syntax, ExceededGraphLimit};
use crate::diff::sliders::fix_all_sliders;
use crate::diff::unchanged;
use crate::line_parser;
use crate::options::DiffOptions;
use crate::parse::folds;
use crate::parse::guess_language::{guess, language_name, LanguageOverride};
use crate::parse::syntax::{self, init_next_prev};
use crate::parse::tree_sitter_parser as tsp;
use crate::summary::{DiffResult, FallbackCause, FileContent, FileFormat, Highlight};
use humansize::{format_size, FormatSizeOptions, BINARY};
use std::{env, fmt, path::Path};
use typed_arena::Arena;

/// The fallback reason for a file diffed by line because of what it is.
fn by_line_reason(cause: FallbackCause) -> &'static str {
    match cause {
        FallbackCause::Generated => "generated file, diffed by line",
        FallbackCause::Hidden => "hidden file, diffed by line",
        FallbackCause::ByteLimit | FallbackCause::GraphLimit | FallbackCause::ParseErrorLimit => {
            unreachable!("only a file's tags choose a line diff up front")
        }
    }
}

/// A file whose fold query captured one syntax node with two different
/// ranges. The file is not diffed; the stream reports it as a
/// `query_conflict` error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryConflict {
    /// The file's display path.
    pub(crate) path: String,
    pub(crate) side: Side,
    pub(crate) conflict: folds::Conflict,
}

impl fmt::Display for QueryConflict {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (first, second) = &self.conflict.sources;
        write!(
            f,
            "{}:{}{}: {first} and {second} capture the same {} with different fold ranges or indents",
            self.path,
            self.conflict.line + 1,
            match self.side {
                Side::Left => " (before)",
                Side::Right => "",
            },
            self.conflict.kind,
        )
    }
}

impl std::error::Error for QueryConflict {}

impl DiffResult {
    #[cfg(test)]
    pub(crate) fn from_sources(path: &str, lhs: &str, rhs: &str) -> Self {
        Self::from_sources_with_params(path, lhs, rhs, &body_params())
    }

    /// A diff with the given parameters, for tests whose queries cannot
    /// conflict.
    #[cfg(test)]
    pub(crate) fn from_sources_with_params(
        path: &str,
        lhs: &str,
        rhs: &str,
        params: &Params,
    ) -> Self {
        Self::try_from_sources_with_params(path, lhs, rhs, params)
            .expect("the test's fold queries do not conflict")
    }

    #[cfg(test)]
    pub(crate) fn try_from_sources_with_params(
        path: &str,
        lhs: &str,
        rhs: &str,
        params: &Params,
    ) -> anyhow::Result<Self> {
        Self::from_sources_with_options(path, lhs, rhs, params, &DiffOptions::default())
    }

    pub fn from_sources_with_options(
        path: &str,
        lhs: &str,
        rhs: &str,
        params: &Params,
        options: &DiffOptions,
    ) -> anyhow::Result<Self> {
        diff_file_content(params, path, lhs, rhs, options, &[])
    }
}
pub fn diff_file_content(
    params: &Params,
    display_path: &str,
    lhs_src: &str,
    rhs_src: &str,
    diff_options: &DiffOptions,
    overrides: &[(LanguageOverride, Vec<glob::Pattern>)],
) -> anyhow::Result<DiffResult> {
    // A deleted file's language comes from what it was.
    let guess_src = if rhs_src.is_empty() { lhs_src } else { rhs_src };
    let language = guess(Path::new(display_path), guess_src, overrides);
    let lang_config = language
        .map(|lang| params.language(lang).map(|params| (lang, params)))
        .transpose()?;

    // Highlights come from the same parse as the folds, so a side that
    // parsed has them whether or not the match runs.
    let highlights = |lhs_tree: &tree_sitter::Tree, rhs_tree: &tree_sitter::Tree, parser| {
        if diff_options.syntax {
            (
                tsp::highlight_captures(lhs_tree, lhs_src, parser),
                tsp::highlight_captures(rhs_tree, rhs_src, parser),
            )
        } else {
            (Vec::new(), Vec::new())
        }
    };

    if lhs_src == rhs_src {
        let file_format = match language {
            Some(language) => FileFormat::SupportedLanguage(language),
            None => FileFormat::PlainText,
        };
        let (lhs_highlights, rhs_highlights) = match lang_config {
            Some((_, lang_config)) if diff_options.syntax => {
                let tree = tsp::to_tree(lhs_src, lang_config.parser);
                highlights(&tree, &tree, lang_config.parser)
            }
            _ => (Vec::new(), Vec::new()),
        };

        // If the two files are byte-for-byte identical, return early
        // rather than doing any more work.
        return Ok(DiffResult {
            file_format,
            lhs_src: FileContent::Text(lhs_src.into()),
            rhs_src: FileContent::Text(rhs_src.into()),
            lhs_positions: vec![],
            rhs_positions: vec![],
            lhs_folds: vec![],
            rhs_folds: vec![],
            lhs_highlights,
            rhs_highlights,
        });
    }

    let mut lhs_folds = Vec::new();
    let mut lhs_highlights: Vec<Highlight> = Vec::new();
    let mut rhs_highlights: Vec<Highlight> = Vec::new();
    let mut rhs_folds = Vec::new();
    let (file_format, lhs_positions, rhs_positions) = match lang_config {
        _ if diff_options.by_line.is_some() => {
            let cause = diff_options.by_line.expect("checked above");
            let file_format = FileFormat::TextFallback {
                cause,
                reason: by_line_reason(cause).to_owned(),
            };
            let (lhs_positions, rhs_positions) = line_parser::change_positions(lhs_src, rhs_src);
            (file_format, lhs_positions, rhs_positions)
        }
        None => {
            let file_format = FileFormat::PlainText;
            let (lhs_positions, rhs_positions) = line_parser::change_positions(lhs_src, rhs_src);
            (file_format, lhs_positions, rhs_positions)
        }
        Some((language, lang_config)) => {
            let arena = Arena::new();
            match tsp::to_tree_with_limit(diff_options, lang_config.parser, lhs_src, rhs_src) {
                Ok((lhs_tree, rhs_tree)) => {
                    (lhs_highlights, rhs_highlights) =
                        highlights(&lhs_tree, &rhs_tree, lang_config.parser);
                    match tsp::to_syntax_with_limit(
                        lhs_src,
                        rhs_src,
                        &lhs_tree,
                        &rhs_tree,
                        &arena,
                        lang_config,
                        diff_options,
                    ) {
                        Ok((lhs, rhs)) => {
                            let mut change_map = ChangeMap::default();
                            let possibly_changed = if env::var("DFT_DBG_KEEP_UNCHANGED").is_ok() {
                                vec![(lhs.clone(), rhs.clone())]
                            } else {
                                unchanged::mark_unchanged(&lhs, &rhs, &mut change_map)
                            };

                            let mut exceeded_graph_limit = false;

                            for (lhs_section_nodes, rhs_section_nodes) in possibly_changed {
                                init_next_prev(&lhs_section_nodes);
                                init_next_prev(&rhs_section_nodes);

                                match mark_syntax(
                                    lhs_section_nodes.first().copied(),
                                    rhs_section_nodes.first().copied(),
                                    &mut change_map,
                                    diff_options.graph_limit,
                                ) {
                                    Ok(()) => {}
                                    Err(ExceededGraphLimit {}) => {
                                        exceeded_graph_limit = true;
                                        break;
                                    }
                                }
                            }

                            if exceeded_graph_limit {
                                // The parse still stands, so its folds do,
                                // each unpaired: nothing matched the nodes
                                // they belong to.
                                folds::unmatched(&lhs, &mut lhs_folds);
                                folds::unmatched(&rhs, &mut rhs_folds);
                                let (lhs_positions, rhs_positions) =
                                    line_parser::change_positions(lhs_src, rhs_src);
                                (
                                    FileFormat::TextFallback {
                                        cause: FallbackCause::GraphLimit,
                                        reason: format!(
                                            "structural diff exceeded diff.graph_limit ({}); raise it in diffr config",
                                            diff_options.graph_limit
                                        ),
                                    },
                                    lhs_positions,
                                    rhs_positions,
                                )
                            } else {
                                fix_all_sliders(language, &lhs, &mut change_map);
                                fix_all_sliders(language, &rhs, &mut change_map);

                                let mut lhs_positions =
                                    syntax::change_positions(&lhs, &change_map, &mut lhs_folds);
                                let mut rhs_positions =
                                    syntax::change_positions(&rhs, &change_map, &mut rhs_folds);

                                if diff_options.ignore_comments {
                                    let lhs_comments =
                                        tsp::comment_positions(&lhs_tree, lhs_src, lang_config);
                                    lhs_positions.extend(lhs_comments);

                                    let rhs_comments =
                                        tsp::comment_positions(&rhs_tree, rhs_src, lang_config);
                                    rhs_positions.extend(rhs_comments);
                                }

                                (
                                    FileFormat::SupportedLanguage(language),
                                    lhs_positions,
                                    rhs_positions,
                                )
                            }
                        }
                        Err(tsp::ToSyntaxError::QueryConflict(conflict, side)) => {
                            return Err(QueryConflict {
                                path: display_path.to_owned(),
                                side,
                                conflict,
                            }
                            .into());
                        }
                        Err(tsp::ToSyntaxError::ExceededParseErrorLimit(
                            tsp::ExceededParseErrorLimit {
                                error_count,
                                first_error_pos,
                            },
                        )) => {
                            let location = match first_error_pos {
                                Some((line, column, side)) => {
                                    let in_initial = match side {
                                        Side::Left => " in initial file",
                                        Side::Right => "",
                                    };
                                    format!(
                                        ", first at {}:{}{}",
                                        line.display(),
                                        column,
                                        in_initial
                                    )
                                }
                                None => "".to_owned(),
                            };
                            let file_format = FileFormat::TextFallback {
                                cause: FallbackCause::ParseErrorLimit,
                                reason: format!(
                                    "{} {} parse error{}{}, exceeded diff.parse_error_limit ({}); raise it in diffr config",
                                    error_count,
                                    language_name(language),
                                    if error_count == 1 { "" } else { "s" },
                                    location,
                                    diff_options.parse_error_limit
                                ),
                            };

                            // The trees parsed, only with too many errors to
                            // match on. Folds and context still come from them.
                            let conflict = |side| {
                                move |conflict| QueryConflict {
                                    path: display_path.to_owned(),
                                    side,
                                    conflict,
                                }
                            };
                            let (lhs, _) = tsp::to_syntax(
                                &lhs_tree,
                                lhs_src,
                                &arena,
                                lang_config,
                                diff_options.ignore_comments,
                            )
                            .map_err(conflict(Side::Left))?;
                            let (rhs, _) = tsp::to_syntax(
                                &rhs_tree,
                                rhs_src,
                                &arena,
                                lang_config,
                                diff_options.ignore_comments,
                            )
                            .map_err(conflict(Side::Right))?;
                            // Folds are identified by syntax id, which only
                            // exists once both sides are numbered.
                            syntax::init_all_info(&lhs, &rhs);
                            folds::unmatched(&lhs, &mut lhs_folds);
                            folds::unmatched(&rhs, &mut rhs_folds);

                            let (lhs_positions, rhs_positions) =
                                line_parser::change_positions(lhs_src, rhs_src);
                            (file_format, lhs_positions, rhs_positions)
                        }
                    }
                }
                Err(tsp::ExceededByteLimit(num_bytes)) => {
                    let format_options = FormatSizeOptions::from(BINARY).decimal_places(1);
                    let file_format = FileFormat::TextFallback {
                        cause: FallbackCause::ByteLimit,
                        reason: format!(
                            "{} exceeded diff.byte_limit ({}); raise it in diffr config",
                            format_size(num_bytes, format_options),
                            diff_options.byte_limit
                        ),
                    };

                    let (lhs_positions, rhs_positions) =
                        line_parser::change_positions(lhs_src, rhs_src);
                    (file_format, lhs_positions, rhs_positions)
                }
            }
        }
    };

    Ok(DiffResult {
        file_format,
        lhs_src: FileContent::Text(lhs_src.to_owned()),
        rhs_src: FileContent::Text(rhs_src.to_owned()),
        lhs_positions,
        rhs_positions,
        lhs_folds,
        rhs_folds,
        lhs_highlights,
        rhs_highlights,
    })
}
