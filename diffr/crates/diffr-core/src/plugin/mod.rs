//! The engine's side of the plugin host: plugin configuration, the bundled
//! plugins' embedded assets, plugin queries and the [`cursor`] a plugin walks
//! one file's trees with. Running components is the native runtime's job.
pub mod builtin;
pub mod config;
pub mod cursor;
pub mod queries;

use std::fmt;

/// A plugin stopped the run: its own failure, or a move it asked for
/// that could not be carried out. The stream reports `mutation_failed`.
#[derive(Debug)]
pub struct MutationFailed(pub String);

impl fmt::Display for MutationFailed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "mutation {}", self.0)
    }
}

impl std::error::Error for MutationFailed {}
