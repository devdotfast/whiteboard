//! The summarizer: large new function bodies and new tests become short
//! pseudocode, shown in place of the collapsed body.
//!
//! It needs an API key for most providers: without one it does nothing and
//! says why on stderr, which is why the bundled configuration ships it off.
//! Each selected body is summarized and edited in its own asynchronous callback.
use anyhow::anyhow;
use diffr_plugin_sdk::prelude::*;
use serde::Deserialize;
use std::time::Duration;
mod http;
mod provider;
pub use provider::{Details, Provider};

/// The plugin's name, and the tags its queries set: a function body, and a
/// test body.
const FUNCTION: &str = "summarize:function";
const TEST: &str = "summarize:test";
const DOCSTRING: &str = "summarize:docstring";

/// The plugin's options, as `plugins/summarize/plugin.toml` declares them.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Options {
    pub provider: Provider,
    pub provider_details: Details,
    pub model: String,
    pub min_lines: usize,
    pub tests: bool,
    pub test_min_lines: usize,
    pub api_key: Option<String>,
    pub endpoint: Option<String>,
    pub request_timeout_ms: u64,
    pub retries: u32,
    /// The system instruction sent with every request.
    pub system_prompt: String,
}

/// The summarizer's options, API key and endpoint.
pub struct Summarize {
    options: Options,
    api_key: Key,
    endpoint: String,
}

enum Key {
    Present(String),
    /// A custom endpoint that takes no key.
    NotRequired,
    /// The summarizer does nothing.
    Missing,
}

impl Summarize {
    /// One request per selected body: its lines, numbered from `first_line`
    /// (1-based). Retried on transient failures; any other failure is a
    /// run-level failure.
    async fn complete(
        &self,
        path: &str,
        src: &str,
        first_line: usize,
    ) -> anyhow::Result<Option<String>> {
        let numbered = src
            .split_terminator('\n')
            .enumerate()
            .map(|(index, line)| format!("{:5} | {line}", first_line + index))
            .collect::<Vec<_>>()
            .join("\n");
        let provider = self.options.provider;
        let body = provider.body(
            &self.options.model,
            &self.options.system_prompt,
            &format!("File {path}:\n\n{numbered}"),
            800,
        );
        let url = provider.url(&self.endpoint, &self.options.model);
        let key = match &self.api_key {
            Key::Present(key) => Some(key.as_str()),
            Key::NotRequired | Key::Missing => None,
        };
        let headers = provider.headers(key);
        let failed = |message: String| anyhow!("{}: {message}", self.options.model);
        let text: serde_json::Value = {
            let mut attempt = 0;
            loop {
                let result = http::post(
                    &url,
                    &headers,
                    &body.to_string(),
                    self.options.request_timeout_ms,
                )
                .await;
                let retry = match result {
                    Ok((status, body)) if (200..300).contains(&status) => {
                        break serde_json::from_slice(&body)
                            .map_err(|error| failed(error.to_string()))?;
                    }
                    Ok((status, _)) if status == 429 || status >= 500 => format!("HTTP {status}"),
                    Ok((status, body)) => {
                        return Err(failed(format!(
                            "HTTP {status} {}",
                            String::from_utf8_lossy(&body)
                                .chars()
                                .take(200)
                                .collect::<String>()
                        )))
                    }
                    Err(error) => error.to_string(),
                };
                if attempt >= self.options.retries {
                    return Err(failed(format!("{retry} after {} attempts", attempt + 1)));
                }
                attempt += 1;
                http::sleep(Duration::from_millis(250 * (1 << attempt.min(6)))).await;
            }
        };
        let pseudocode = provider
            .text(&text)
            .ok_or_else(|| failed("no text in the response".to_owned()))?
            .trim();
        Ok((!pseudocode.is_empty()).then(|| pseudocode.to_owned()))
    }
}

/// The API key: the `api_key` option, or else the first of the provider's
/// environment variables that is set and not empty. `Missing` says why on
/// stderr.
fn resolve_key(config: &Options, custom_endpoint: bool) -> Key {
    let set = |key: &String| !key.is_empty();
    if let Some(key) = config.api_key.clone().filter(set) {
        return Key::Present(key);
    }
    let variables = &config.provider_details.key_variables;
    for variable in variables {
        if let Some(key) = std::env::var_os(variable) {
            let Ok(key) = key.into_string() else {
                eprintln!("summarize: off for this run: {variable} is not valid UTF-8");
                return Key::Missing;
            };
            if set(&key) {
                return Key::Present(key);
            }
        }
    }
    if config.provider_details.keyless_custom_endpoint && custom_endpoint {
        return Key::NotRequired;
    }
    eprintln!(
        "summarize: off for this run: no API key: set plugins.shape.bundled.summarize.api_key, or {} in the environment, or turn the summarizer off with plugins.shape.bundled.summarize.enabled = false",
        variables.join(" or ")
    );
    Key::Missing
}

impl Guest for Summarize {
    type Plugin = Self;
}

impl GuestPlugin for Summarize {
    fn new(options: String) -> Result<Self, String> {
        let options: Options =
            serde_json::from_str(&options).map_err(|e| format!("invalid options: {e}"))?;
        let endpoint = options
            .endpoint
            .clone()
            .filter(|endpoint| !endpoint.is_empty());
        let api_key = resolve_key(&options, endpoint.is_some());
        Ok(Self {
            api_key,
            endpoint: endpoint.unwrap_or_else(|| options.provider_details.endpoint.clone()),
            options,
        })
    }

    async fn visit(&self, cursor: &Cursor, phase: Visit) -> Result<bool, String> {
        if matches!(self.api_key, Key::Missing) {
            return Ok(false);
        }
        if phase == Visit::Post {
            return Ok(true);
        }
        let RegionView {
            side: Side::Rhs,
            data,
            ..
        } = cursor.get(cursor.id())?
        else {
            return Ok(true);
        };
        if !self.eligible(cursor, &data)? {
            return Ok(true);
        }
        let text = cursor.text(data.id)?;
        let file = cursor.file();
        let path = match &file.file {
            FileSides::Both((_, rhs)) | FileSides::RightOnly(rhs) => &rhs.path,
            FileSides::LeftOnly(lhs) => &lhs.path,
        };
        let Some(pseudocode) = self
            .complete(path, &text, data.range.start.line as usize + 1)
            .await
            .map_err(|e| format!("summarizer: {e:#}"))?
        else {
            return Ok(false);
        };
        // Pseudocode earns its place only when it is at most two thirds as
        // long as the body; otherwise the body keeps its original visibility.
        let size = |text: &str| text.chars().filter(|c| !c.is_whitespace()).count();
        if size(&pseudocode) * 3 > size(&text) * 2 {
            return Ok(false);
        }
        cursor.set_collapsed(data.id, true)?;
        let Some(docstring) = docstring(cursor, data.id)? else {
            cursor.set_label(data.id, Some(&pseudocode))?;
            return Ok(false);
        };
        let docstring_text = cursor.text(docstring)?;
        let first = docstring_text
            .lines()
            .next()
            .ok_or_else(|| format!("empty docstring region {docstring}"))?
            .trim();
        cursor.set_label(data.id, Some(&format!("{first}\n{pseudocode}")))?;
        Ok(false)
    }
}

/// The `summarize:docstring` region on `id`'s side that shares its fold state.
fn docstring(cursor: &Cursor, id: u32) -> Result<Option<u32>, String> {
    let side = cursor.get(id)?.side;
    for region in cursor.linked_regions(id)? {
        let RegionView {
            side: other, data, ..
        } = cursor.get(region)?;
        if other == side && data.tags.iter().any(|tag| tag == DOCSTRING) {
            return Ok(Some(region));
        }
    }
    Ok(None)
}

impl Summarize {
    fn eligible(&self, cursor: &Cursor, data: &Region) -> Result<bool, String> {
        if !matches!(data.kind, Kind::Fold) {
            return Ok(false);
        }
        let count = (data.range.end.line - data.range.start.line) as usize;
        Ok(if data.tags.iter().any(|tag| tag == TEST) {
            self.options.tests
                && count >= self.options.test_min_lines
                && cursor.is_one_sided(data.id)?
        } else {
            data.tags.iter().any(|tag| tag == FUNCTION)
                && !data.visibility.collapsed
                && count >= self.options.min_lines
                && cursor.is_one_sided(data.id)?
        })
    }
}

export_shape!(Summarize);
