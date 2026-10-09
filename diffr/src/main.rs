//! Difftastic is a syntactic diff tool.
//!
//! For usage instructions and advice on contributing, see [the
//! manual](http://difftastic.wilfred.me.uk/).
//!

// I frequently develop difftastic on a newer rustc than the MSRV, so
// these two aren't relevant.
#![allow(renamed_and_removed_lints)]
// This tends to trigger on larger tuples of simple types, and naming
// them would probably be worse for readability.
#![allow(clippy::type_complexity)]
// == "" is often clearer when dealing with strings.
#![allow(clippy::comparison_to_empty)]
// It's common to have pairs foo_lhs and foo_rhs, leading to double
// the number of arguments and triggering this lint.
#![allow(clippy::too_many_arguments)]
// Has false positives on else if chains that sometimes have the same
// body for readability.
#![allow(clippy::if_same_then_else)]
// Good practice in general, but a necessary evil for Syntax. Its Hash
// implementation does not consider the mutable fields, so it is still
// correct.
#![allow(clippy::mutable_key_type)]
// manual_unwrap_or_default was added in Rust 1.79, so earlier versions of
// clippy complain about allowing it.
#![allow(unknown_lints)]
// It's sometimes more readable to explicitly create a vec than to use
// the Default trait.
#![allow(clippy::manual_unwrap_or_default)]
// I find the explicit arithmetic clearer sometimes.
#![allow(clippy::implicit_saturating_sub)]
// It's helpful being super explicit about byte length versus Unicode
// character point length sometimes.
#![allow(clippy::needless_as_bytes)]
// .to_owned() is more explicit on string references.
#![warn(clippy::str_to_string)]
// .to_string() on a String is clearer as .clone().
#![warn(clippy::string_to_string)]
// Debugging features shouldn't be in checked-in code.
#![warn(clippy::todo)]
#![warn(clippy::dbg_macro)]

mod cli;
mod exit_codes;
mod files;
mod git;
mod init;
mod options;
mod plugin;
mod pprint;
mod run;
mod tags;
mod version;

use diffr_core::{config, engine, pairing, parse, present, protocol, summary};

use crate::config::{ConfigError, Params};

use crate::exit_codes::EXIT_BAD_ARGUMENTS;
use crate::files::read_or_die;
use crate::parse::guess_language::{
    guess, language_globs, language_name, Language, LanguageOverride,
};
use crate::parse::syntax;

/// The global allocator used by difftastic.
///
/// Diffing allocates a large amount of memory, and both Jemalloc and
/// MiMalloc perform better than the system allocator.
///
/// Some versions of MiMalloc (specifically libmimalloc-sys greater
/// than 0.1.24) handle very large, mostly unused allocations
/// badly. This makes large line-oriented diffs very slow, as
/// discussed in #297.
///
/// MiMalloc is generally faster than Jemalloc, but older versions of
/// MiMalloc don't compile on GCC 15+, so use Jemalloc for now. See
/// #805.
///
/// For reference, Jemalloc uses 10-20% more time (although up to 33%
/// more instructions) when testing on sample files.
#[cfg(not(any(windows, target_os = "illumos", target_os = "freebsd")))]
use tikv_jemallocator::Jemalloc;

#[cfg(not(any(windows, target_os = "illumos", target_os = "freebsd")))]
#[global_allocator]
static GLOBAL: Jemalloc = Jemalloc;

use std::path::Path;

use strum::IntoEnumIterator;
use typed_arena::Arena;

use crate::options::Mode;
use crate::parse::folds::Conflict;
use crate::parse::syntax::init_all_info;
use crate::parse::tree_sitter_parser as tsp;

extern crate pretty_env_logger;

/// Terminate the process if we get SIGPIPE.
#[cfg(unix)]
fn reset_sigpipe() {
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_DFL);
    }
}

#[cfg(not(unix))]
fn reset_sigpipe() {
    // Do nothing.
}

/// The entrypoint.
fn main() {
    pretty_env_logger::try_init_timed_custom_env("DFT_LOG")
        .expect("The logger has not been previously initialized");
    reset_sigpipe();

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("application runtime");
    match cli::run(&runtime) {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    }
}

/// `diffr debug`: syntax dumps and the language list.
fn run_debug(mode: Mode, params: &Params) {
    match mode {
        Mode::DumpTreeSitter {
            path,
            language_overrides,
        } => {
            let path = Path::new(&path);
            let bytes = read_or_die(path);
            let src = String::from_utf8_lossy(&bytes).to_string();

            let language = guess(path, &src, &language_overrides);
            match language {
                Some(lang) => {
                    let ts_lang = tsp::from_language(lang);
                    let tree = tsp::to_tree(&src, ts_lang);
                    tsp::print_tree(&src, &tree);
                }
                None => {
                    eprintln!("No tree-sitter parser for file: {:?}", path);
                }
            }
        }
        Mode::DumpSyntax {
            path,
            ignore_comments,
            language_overrides,
        } => {
            let path = Path::new(&path);
            let bytes = read_or_die(path);
            let src = String::from_utf8_lossy(&bytes).to_string();

            let language = guess(path, &src, &language_overrides);
            match language {
                Some(lang) => {
                    let ts_lang = query_or_die(params.language(lang));
                    let arena = Arena::new();
                    let ast = conflict_or_die(tsp::parse(&arena, &src, ts_lang, ignore_comments));
                    init_all_info(&ast, &[]);
                    println!("{:#?}", ast);
                }
                None => {
                    eprintln!("No tree-sitter parser for file: {:?}", path);
                }
            }
        }
        Mode::DumpSyntaxDot {
            path,
            ignore_comments,
            language_overrides,
        } => {
            let path = Path::new(&path);
            let bytes = read_or_die(path);
            let src = String::from_utf8_lossy(&bytes).to_string();

            let language = guess(path, &src, &language_overrides);
            match language {
                Some(lang) => {
                    let ts_lang = query_or_die(params.language(lang));
                    let arena = Arena::new();
                    let ast = conflict_or_die(tsp::parse(&arena, &src, ts_lang, ignore_comments));
                    init_all_info(&ast, &[]);
                    syntax::print_as_dot(&ast);
                }
                None => {
                    eprintln!("No tree-sitter parser for file: {:?}", path);
                }
            }
        }
        Mode::ListLanguages { language_overrides } => {
            for (lang_override, globs) in language_overrides {
                let name = match lang_override {
                    LanguageOverride::Language(lang) => language_name(lang),
                    LanguageOverride::PlainText => "Text",
                };
                println!("{} (from override)", name);
                for glob in globs {
                    print!(" {}", glob.as_str());
                }
                println!();
            }

            for language in Language::iter() {
                println!("{}", language_name(language));

                for glob in language_globs(language) {
                    print!(" {}", glob.as_str());
                }
                println!();
            }
        }
    };
}

/// The syntax dumps stop at a fold query conflict.
fn query_or_die<T>(result: Result<T, ConfigError>) -> T {
    match result {
        Ok(value) => value,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(EXIT_BAD_ARGUMENTS);
        }
    }
}

fn conflict_or_die<T>(result: Result<T, Conflict>) -> T {
    match result {
        Ok(value) => value,
        Err(conflict) => {
            eprintln!(
                "line {}: {} and {} capture the same {} with different fold ranges or indents",
                conflict.line + 1,
                conflict.sources.0,
                conflict.sources.1,
                conflict.kind
            );
            std::process::exit(EXIT_BAD_ARGUMENTS);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::diff_file_content;
    use crate::options::DiffOptions;

    #[test]
    fn test_diff_identical_content() {
        let s = "foo";
        let res = diff_file_content(
            &Params::default(),
            "foo.el",
            s,
            s,
            &DiffOptions::default(),
            &[],
        )
        .unwrap();

        assert_eq!(res.lhs_positions, vec![]);
        assert_eq!(res.rhs_positions, vec![]);
    }
}

#[cfg(test)]
pub(crate) fn test_runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap()
    })
}
