//! File reading for `diffr debug`.

use std::fs;
use std::path::{Path, PathBuf};

use crate::exit_codes::EXIT_BAD_ARGUMENTS;

pub(crate) fn read_or_die(path: &Path) -> Vec<u8> {
    match fs::read(path) {
        Ok(src) => src,
        Err(e) => {
            eprint_read_error(path, &e);
            std::process::exit(EXIT_BAD_ARGUMENTS);
        }
    }
}

/// Write a human-friendly description of `e` to stderr.
fn eprint_read_error(path: &Path, e: &std::io::Error) {
    let shown = relative_to_current(path);
    let shown = shown.display();
    match e.kind() {
        std::io::ErrorKind::NotFound => {
            eprintln!("No such file: {shown}");
        }
        std::io::ErrorKind::PermissionDenied => {
            eprintln!("Permission denied when reading file: {shown}");
        }
        _ if path.is_dir() => {
            eprintln!("Expected a file, got a directory: {shown}");
        }
        _ => eprintln!("Could not read file: {shown} (error {:?})", e.kind()),
    };
}

fn try_canonicalize(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.into())
}

fn relative_to_current(path: &Path) -> PathBuf {
    if let Ok(current_path) = std::env::current_dir() {
        let path = try_canonicalize(path);
        let current_path = try_canonicalize(&current_path);

        if let Ok(rel_path) = path.strip_prefix(current_path) {
            return rel_path.into();
        }
    }

    path.into()
}
