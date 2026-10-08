//! CLI option parsing.

use std::env;

use clap::{error::ErrorKind, Args};

use crate::parse::guess_language::{language_override_from_name, LanguageOverride};

pub(crate) use diffr_core::options::DiffOptions;

pub(crate) const DEFAULT_TERMINAL_WIDTH: usize = 80;

/// `diffr debug`: syntax dumps and the language list.
#[derive(Args)]
pub(crate) struct DebugArgs {
    #[command(flatten)]
    action: DebugAction,
    /// Don't consider comments when diffing.
    #[arg(long, env = "DFT_IGNORE_COMMENTS")]
    ignore_comments: bool,
    /// Associate this glob pattern with this language, overriding normal language detection
    ///
    /// For example:
    ///
    /// $ diffr debug --override='*.c:C++' --dump-syntax file.c
    ///
    /// See --list-languages for the list of language names. Language names are matched case insensitively. Overrides may also specify the language "text" to treat a file as plain text.
    ///
    /// This argument may be given more than once. For example:
    ///
    /// $ diffr debug --override='CustomFile:json' --override='*.c:text' --dump-syntax file.c
    ///
    /// To configure multiple overrides using environment variables, diffr also accepts DFT_OVERRIDE_1 up to DFT_OVERRIDE_9.
    ///
    /// $ export DFT_OVERRIDE='CustomFile:json'
    /// $ export DFT_OVERRIDE_1='*.c:text'
    /// $ export DFT_OVERRIDE_2='*.js:javascript jsx'
    ///
    /// When multiple overrides are specified, the first matching override wins.
    #[arg(
        long = "override",
        value_name = "GLOB:NAME",
        env = "DFT_OVERRIDE",
        value_parser = parse_override,
        verbatim_doc_comment
    )]
    overrides: Vec<(LanguageOverride, glob::Pattern)>,
}

/// What `diffr debug` does: exactly one of these.
#[derive(Args)]
#[group(required = true, multiple = false)]
struct DebugAction {
    /// Parse a single file with tree-sitter and display the diffr syntax tree.
    #[arg(long, value_name = "PATH", help_heading = "DEBUG OPTIONS")]
    dump_syntax: Option<String>,
    /// Parse a single file with tree-sitter and display the diffr syntax tree, as a DOT graph.
    #[arg(long, value_name = "PATH", help_heading = "DEBUG OPTIONS")]
    dump_syntax_dot: Option<String>,
    /// Parse a single file with tree-sitter and display the tree-sitter parse tree.
    #[arg(long, value_name = "PATH", help_heading = "DEBUG OPTIONS")]
    dump_ts: Option<String>,
    /// Print all the languages supported by diffr, along with their recognised extensions.
    #[arg(long)]
    list_languages: bool,
}

pub(crate) enum Mode {
    ListLanguages {
        language_overrides: Vec<(LanguageOverride, Vec<glob::Pattern>)>,
    },
    DumpTreeSitter {
        path: String,
        language_overrides: Vec<(LanguageOverride, Vec<glob::Pattern>)>,
    },
    DumpSyntax {
        path: String,
        ignore_comments: bool,
        language_overrides: Vec<(LanguageOverride, Vec<glob::Pattern>)>,
    },
    DumpSyntaxDot {
        path: String,
        ignore_comments: bool,
        language_overrides: Vec<(LanguageOverride, Vec<glob::Pattern>)>,
    },
}

/// One `GLOB:LANG_NAME` override, as `--override` and `DFT_OVERRIDE_N` take it.
fn parse_override(raw: &str) -> Result<(LanguageOverride, glob::Pattern), String> {
    let (glob_str, lang_name) = raw
        .rsplit_once(':')
        .ok_or("expected GLOB:LANG_NAME, e.g. '*.js:JSON'")?;
    let pattern = glob::Pattern::new(glob_str)
        .map_err(|error| format!("invalid glob '{glob_str}': {}", error.msg))?;
    let language = language_override_from_name(lang_name).ok_or_else(|| {
        format!("no such language '{lang_name}'; see --list-languages for the names, which match case insensitively")
    })?;
    Ok((language, pattern))
}

/// `DFT_OVERRIDE_1` up to `DFT_OVERRIDE_9`, which clap does not read.
fn numbered_env_overrides() -> Vec<(LanguageOverride, glob::Pattern)> {
    let mut overrides = vec![];
    for i in 1..=9 {
        let name = format!("DFT_OVERRIDE_{i}");
        let value = match env::var(&name) {
            Ok(value) => value,
            Err(env::VarError::NotPresent) => continue,
            Err(env::VarError::NotUnicode(_)) => clap::Error::raw(
                ErrorKind::InvalidUtf8,
                format!("{name} is not valid UTF-8\n"),
            )
            .exit(),
        };
        match parse_override(&value) {
            Ok(language_override) => overrides.push(language_override),
            Err(message) => clap::Error::raw(
                ErrorKind::ValueValidation,
                format!("invalid value '{value}' for {name}: {message}\n"),
            )
            .exit(),
        }
    }
    overrides
}

/// Adjacent overrides naming the same language share one entry.
fn combine_overrides(
    overrides: impl IntoIterator<Item = (LanguageOverride, glob::Pattern)>,
) -> Vec<(LanguageOverride, Vec<glob::Pattern>)> {
    let mut combined: Vec<(LanguageOverride, Vec<glob::Pattern>)> = vec![];
    for (lang, pattern) in overrides {
        match combined.last_mut() {
            Some((prev_lang, prev_globs)) if *prev_lang == lang => prev_globs.push(pattern),
            _ => combined.push((lang, vec![pattern])),
        }
    }
    combined
}

impl DebugArgs {
    pub(crate) fn mode(&self) -> Mode {
        let language_overrides = combine_overrides(
            self.overrides
                .iter()
                .cloned()
                .chain(numbered_env_overrides()),
        );

        let action = &self.action;
        if action.list_languages {
            return Mode::ListLanguages { language_overrides };
        }
        if let Some(path) = &action.dump_syntax {
            return Mode::DumpSyntax {
                path: path.to_owned(),
                ignore_comments: self.ignore_comments,
                language_overrides,
            };
        }
        if let Some(path) = &action.dump_syntax_dot {
            return Mode::DumpSyntaxDot {
                path: path.to_owned(),
                ignore_comments: self.ignore_comments,
                language_overrides,
            };
        }
        let path = action
            .dump_ts
            .as_ref()
            .expect("clap requires exactly one debug action");
        Mode::DumpTreeSitter {
            path: path.to_owned(),
            language_overrides,
        }
    }
}

/// Try to work out the width of the terminal we're on, or fall back
/// to a sensible default value.
pub(crate) fn detect_terminal_width() -> usize {
    if let Some((terminal_size::Width(columns), _)) = terminal_size::terminal_size() {
        if columns > 0 {
            return columns.into();
        }
    }

    // If we couldn't detect the terminal width, use the
    // shell variable COLUMNS if it's set. This helps with terminals like eshell.
    //
    // https://github.com/Wilfred/difftastic/issues/707
    // https://stackoverflow.com/a/48016366
    if let Ok(columns_env_val) = std::env::var("COLUMNS") {
        if let Ok(columns) = columns_env_val.parse::<usize>() {
            if columns > 0 {
                return columns;
            }
        }
    }

    DEFAULT_TERMINAL_WIDTH
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_display_width() {
        // Basic smoke test.
        assert!(detect_terminal_width() > 10);
    }
}
