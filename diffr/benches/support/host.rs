//! Reuse the CLI host without exporting benchmark-only production APIs.
#![allow(dead_code)]
#[path = "../../src/plugin/bindings.rs"]
mod bindings;
#[path = "../../src/plugin/wasm.rs"]
mod wasm;
use diffr_core::plugin::{config, cursor, MutationFailed};
pub(crate) use wasm::Pipeline;
