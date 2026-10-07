//! The plugin host: plugins decide how each diffed file is shown. Nothing in
//! this module is specific to one plugin; the bundled plugins live in
//! `plugins/`.
//!
//! Every plugin is a WebAssembly component implementing the SDK's WIT contract.
//! [`config`] resolves its manifest, options and component; [`Pipeline`] loads
//! the enabled components and runs them in order on each file.
pub(crate) mod bindings;
pub(crate) mod classify;
pub(crate) mod wasm;

pub(crate) use classify::Classifier;
#[cfg(test)]
pub(crate) use diffr_core::plugin::builtin;
pub(crate) use diffr_core::plugin::{config, cursor, MutationFailed};
pub(crate) use wasm::Pipeline;

#[cfg(test)]
mod tests;
