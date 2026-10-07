//! Collapse test bodies and test modules.
use diffr_plugin_sdk::prelude::*;
use serde::Deserialize;

/// The plugin's name, and the tags its queries set: a test function's body,
/// a test module's body, and an integration test's body.
const TEST: &str = "test-bodies:test";
const MODULE: &str = "test-bodies:module";
const INTEGRATION: &str = "test-bodies:integration";

/// The classifier's tags for a file of integration tests.
const FILE_INTEGRATION: [&str; 2] = ["integration", "e2e"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Options {
    min_lines: usize,
}

/// Test bodies of at least `min_lines` start collapsed on both sides, paired
/// or not, so a diff reads as the code under test first. Integration tests
/// stay open. A whole test
/// module, such as a Rust `#[cfg(test)] mod tests`, collapses as one fold
/// labelled "test module"; the header stays visible and the fold expands
/// like any other. A test body is linked to its docstring, which collapses
/// with it.
pub struct TestBodies {
    options: Options,
}

impl Guest for TestBodies {
    type Plugin = Self;
}

impl GuestPlugin for TestBodies {
    fn new(options: String) -> Result<Self, String> {
        let options: Options =
            serde_json::from_str(&options).map_err(|e| format!("invalid options: {e}"))?;
        Ok(Self { options })
    }

    async fn visit(&self, cursor: &Cursor, phase: Visit) -> Result<bool, String> {
        if phase == Visit::Pre {
            if cursor
                .file()
                .tags
                .iter()
                .any(|tag| FILE_INTEGRATION.contains(&tag.as_str()))
            {
                return Ok(false);
            }
            let data = cursor.get(cursor.id())?.data;
            if !matches!(data.kind, Kind::Fold)
                || ((data.range.end.line - data.range.start.line) as usize) < self.options.min_lines
                || data.tags.iter().any(|tag| tag == INTEGRATION)
            {
                return Ok(true);
            }
            let default = if data.tags.iter().any(|tag| tag == MODULE) {
                "test module"
            } else if data.tags.iter().any(|tag| tag == TEST) {
                "test body"
            } else {
                return Ok(true);
            };
            let label = if data.visibility.label.is_empty() {
                default.to_owned()
            } else {
                data.visibility.label
            };
            cursor.set_collapsed(data.id, true)?;
            cursor.set_label(data.id, Some(&label))?;
        }
        Ok(true)
    }
}

export_shape!(TestBodies);
