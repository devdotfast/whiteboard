//! diffr in the browser. A [`Differ`] holds what the native diffr builds
//! once per run: the configuration, its compiled queries, the classifier
//! and the shape plugins, linked in (see [`plugins`]). [`Differ::diff`]
//! turns the two sides of one changed file into its `file` record of the
//! wire protocol, shaped by the plugins as the native diffr shapes it.
//! Fetching the sources is the page's job.
use diffr_core::config::{Config, Params};
use diffr_core::engine::DiffError;
use diffr_core::options::DiffOptions;
use diffr_core::pairing::Pairing;
use diffr_core::plugin::MutationFailed;
use diffr_core::present::present;
use diffr_core::protocol::project::{self, Inputs};
use diffr_core::protocol::{Diff, Event, FileChange, FileRef, FileStatus, Outcome, Problem};
use diffr_core::summary::{DiffResult, FallbackCause, FileContent, FileFormat};
use diffr_core::tags;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use wasm_bindgen::prelude::*;

mod plugins;

#[wasm_bindgen]
pub struct Differ {
    params: Params,
    options: DiffOptions,
    classifier: Option<plugins::Classifier>,
    pipeline: plugins::Pipeline,
    notices: Vec<String>,
}

/// One side of a changed file, as the page names it.
#[derive(Deserialize)]
struct Side {
    path: String,
    #[serde(default)]
    oid: String,
    #[serde(default)]
    mode: String,
    /// The file's text; absent before it is fetched.
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize)]
struct Request {
    status: FileStatus,
    lhs: Option<Side>,
    rhs: Option<Side>,
    /// Ask for highlight captures.
    #[serde(default)]
    syntax: bool,
    /// Run the summarizer too, when it is enabled.
    #[serde(default)]
    summarize: bool,
}

/// A file as the classifier sees it: its manifest entry, with tags, and why
/// it starts hidden.
#[derive(Serialize)]
struct Classified {
    entry: FileChange,
    #[serde(skip_serializing_if = "Option::is_none")]
    hidden: Option<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Preview {
    Ready(Classified),
    Failed { error: String },
}

#[derive(Serialize)]
struct Response {
    #[serde(flatten)]
    classified: Classified,
    event: Event,
}

fn js_error(error: anyhow::Error) -> JsError {
    JsError::new(&format!("{error:#}"))
}

fn file_ref(side: &Side) -> FileRef {
    FileRef {
        path: side.path.clone(),
        oid: side.oid.clone(),
        mode: side.mode.clone(),
    }
}

fn entry(request: &Request) -> anyhow::Result<FileChange> {
    let file = match (&request.lhs, &request.rhs) {
        (Some(lhs), Some(rhs)) => Pairing::Both {
            lhs: file_ref(lhs),
            rhs: file_ref(rhs),
        },
        (Some(lhs), None) => Pairing::LeftOnly { lhs: file_ref(lhs) },
        (None, Some(rhs)) => Pairing::RightOnly { rhs: file_ref(rhs) },
        (None, None) => anyhow::bail!("a changed file needs a side"),
    };
    Ok(FileChange {
        file,
        status: request.status,
        tags: Vec::new(),
    })
}

/// The wire record for an error, with the code of its typed cause.
fn problem(error: &anyhow::Error) -> Problem {
    let code = if let Some(error) = error.downcast_ref::<DiffError>() {
        match error {
            DiffError::Query(_) => "query_error",
            DiffError::Conflict(_) => "query_conflict",
        }
    } else if error.downcast_ref::<MutationFailed>().is_some() {
        "mutation_failed"
    } else {
        "internal"
    };
    Problem {
        code: code.to_owned(),
        message: format!("{error:#}"),
    }
}

/// `config` with `overrides`, a JSON object, merged over it: a table into a
/// table, anything else replaced.
fn merged(config: Option<&str>, overrides: Option<&str>) -> anyhow::Result<Option<String>> {
    fn merge(base: &mut toml::Table, over: toml::Table) {
        for (key, value) in over {
            match (base.get_mut(&key), value) {
                (Some(toml::Value::Table(base)), toml::Value::Table(over)) => merge(base, over),
                (_, value) => {
                    base.insert(key, value);
                }
            }
        }
    }
    let Some(overrides) = overrides else {
        return Ok(config.map(str::to_owned));
    };
    let mut table: toml::Table = toml::from_str(config.unwrap_or_default())?;
    let over: toml::Table = serde_json::from_str(overrides)?;
    merge(&mut table, over);
    Ok(Some(toml::to_string(&table)?))
}

#[wasm_bindgen]
impl Differ {
    /// A differ for `config`, the text of a `config.toml`, or the bundled
    /// defaults when it is absent. `overrides` is JSON merged over it, table
    /// by table: the page's own settings, such as the summarizer's key.
    #[wasm_bindgen(constructor)]
    pub fn new(config: Option<String>, overrides: Option<String>) -> Result<Differ, JsError> {
        console_error_panic_hook::set_once();
        merged(config.as_deref(), overrides.as_deref())
            .and_then(|config| Self::from_config(config.as_deref()))
            .map_err(js_error)
    }

    /// Whether the summarizer is enabled: the page then asks for each file's
    /// summaries after showing it.
    pub fn summarizes(&self) -> bool {
        self.pipeline.summarizes()
    }

    /// The configuration's JSON Schema, with every setting's description
    /// and default.
    pub fn schema() -> String {
        Config::schema().to_string()
    }

    /// What the configuration asked for that the browser does not run, as
    /// a JSON array of messages.
    pub fn notices(&self) -> String {
        serde_json::to_string(&self.notices).expect("strings serialize")
    }

    /// Classify many files before their sources are fetched. `requests` is a
    /// JSON array of [`Differ::diff`] requests without text. Returns a JSON
    /// array in the same order of `{"entry", "hidden"?}`, or `{"error"}` for
    /// a file the classifier failed on. Content rules need the text, so a
    /// file's diff may tag it further.
    pub fn preview(&self, requests: &str) -> Result<String, JsError> {
        self.preview_json(requests).map_err(js_error)
    }

    /// Diff one changed file. `request` is JSON:
    /// `{"status": "modified", "lhs": {"path", "oid", "mode", "text"}, "rhs": {...}}`,
    /// with `lhs` absent for an added file and `rhs` for a deleted one, an
    /// optional `"syntax": true` for highlight captures, and an optional
    /// `"summarize": true` to run the summarizer, which blocks on the page's
    /// requests to the model. Returns JSON
    /// `{"entry", "hidden"?, "event"}`: the file classified with its text,
    /// and its `file` record.
    pub fn diff(&self, request: &str) -> Result<String, JsError> {
        self.diff_json(request).map_err(js_error)
    }
}

impl Differ {
    fn from_config(config: Option<&str>) -> anyhow::Result<Self> {
        let config = match config {
            Some(text) => Config::from_toml_in(text, Path::new(""))?,
            None => Config::default(),
        };
        let mut notices = Vec::new();
        let classifier = plugins::Classifier::from_config(&config.plugins, &mut notices)?;
        let pipeline = plugins::Pipeline::from_config(&config.plugins, &mut notices)?;
        let params = config.compile()?;
        Ok(Differ {
            options: config.diff.options(false),
            params,
            classifier,
            pipeline,
            notices,
        })
    }

    fn preview_json(&self, requests: &str) -> anyhow::Result<String> {
        let requests: Vec<Request> = serde_json::from_str(requests)?;
        let previews: Vec<Preview> = requests
            .iter()
            .map(|request| match self.classify(request, BTreeMap::new()) {
                Ok(classified) => Preview::Ready(classified),
                Err(error) => Preview::Failed {
                    error: format!("{error:#}"),
                },
            })
            .collect();
        Ok(serde_json::to_string(&previews)?)
    }

    fn diff_json(&self, request: &str) -> anyhow::Result<String> {
        fn text(side: &Option<Side>) -> &str {
            side.as_ref()
                .and_then(|side| side.text.as_deref())
                .unwrap_or("")
        }
        let request: Request = serde_json::from_str(request)?;
        let blobs = [&request.lhs, &request.rhs]
            .into_iter()
            .flatten()
            .filter(|side| !side.oid.is_empty())
            .filter_map(|side| Some((side.oid.clone(), side.text.clone()?.into_bytes())))
            .collect();
        let classified = self.classify(&request, blobs)?;
        let _http = diffr_plugin_sdk::native::set_http(Box::new(plugins::PageHttp));
        let outcome = match self.shaped(
            &classified,
            text(&request.lhs),
            text(&request.rhs),
            request.syntax,
            request.summarize,
        ) {
            Ok(diff) => Outcome::Diff { diff },
            Err(error) => Outcome::Error {
                error: problem(&error),
            },
        };
        let event = Event::File {
            file: classified.entry.file.clone(),
            outcome,
        };
        Ok(serde_json::to_string(&Response { classified, event })?)
    }

    fn classify(
        &self,
        request: &Request,
        blobs: BTreeMap<String, Vec<u8>>,
    ) -> anyhow::Result<Classified> {
        let mut entry = entry(request)?;
        let hidden = match &self.classifier {
            Some(classifier) => {
                let (tags, hidden) = classifier.classify(&entry, blobs)?;
                entry.tags = tags;
                hidden
            }
            None => None,
        };
        Ok(Classified { entry, hidden })
    }

    /// Diff, project and shape one file, as the native diffr's `run.rs` does.
    fn shaped(
        &self,
        classified: &Classified,
        before: &str,
        after: &str,
        syntax: bool,
        summarize: bool,
    ) -> anyhow::Result<Diff> {
        let entry = &classified.entry;
        let sizes = (before.len() as u64, after.len() as u64);
        // A binary file is a successful, size-only record.
        let result = if before.contains('\0') || after.contains('\0') {
            DiffResult {
                file_format: FileFormat::Binary,
                lhs_src: FileContent::Binary,
                rhs_src: FileContent::Binary,
                lhs_positions: vec![],
                rhs_positions: vec![],
                lhs_folds: vec![],
                rhs_folds: vec![],
                lhs_highlights: vec![],
                rhs_highlights: vec![],
            }
        } else {
            let path = match &entry.file {
                Pairing::Both { rhs, .. } | Pairing::RightOnly { rhs } => &rhs.path,
                Pairing::LeftOnly { lhs } => &lhs.path,
            };
            let options = DiffOptions {
                by_line: if entry.tags.iter().any(|tag| tag == tags::GENERATED) {
                    Some(FallbackCause::Generated)
                } else if classified.hidden.is_some() {
                    Some(FallbackCause::Hidden)
                } else {
                    None
                },
                syntax,
                ..self.options.clone()
            };
            DiffResult::from_sources_with_options(path, before, after, &self.params, &options)?
        };
        let diff = project::diff(
            &result,
            Inputs {
                file: &entry.file,
                sizes,
            },
        );
        plugins::ready(present(classified.hidden.as_deref(), diff, async |sides| {
            self.pipeline.run(entry, sides, summarize)
        }))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn differ(config: Option<&str>) -> Differ {
        Differ::from_config(config).expect("the config loads")
    }

    fn diff(differ: &Differ, request: Value) -> Value {
        serde_json::from_str(
            &differ
                .diff_json(&request.to_string())
                .expect("the file diffs"),
        )
        .unwrap()
    }

    #[test]
    fn a_modified_file_gets_a_shaped_record() {
        let before = "export function f(a: number) {\n  const x = a + 1;\n  return x * 2;\n}\n";
        let after =
            "export function f(a: number, b: number) {\n  const x = a + b;\n  return x * 2;\n}\n";
        let response = diff(
            &differ(None),
            json!({
                "status": "modified",
                "lhs": {"path": "src/a.ts", "text": before},
                "rhs": {"path": "src/a.ts", "text": after},
                "syntax": true,
            }),
        );
        assert_eq!(response["entry"]["status"], "modified");
        let event = &response["event"];
        assert_eq!(event["type"], "file");
        assert_eq!(event["diff"]["type"], "text", "{event}");
        assert!(!event["diff"]["rhs"]["syntax"]
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(event["diff"]["stats"]["textual"]["added"], 2);
    }

    #[test]
    fn the_context_plugin_folds_unchanged_stretches() {
        let mut before = String::new();
        for line in 0..40 {
            before.push_str(&format!("const v{line} = {line};\n"));
        }
        let after = before.replace("const v20 = 20;", "const v20 = 21;");
        let response = diff(
            &differ(None),
            json!({
                "status": "modified",
                "lhs": {"path": "src/a.ts", "text": before},
                "rhs": {"path": "src/a.ts", "text": after},
            }),
        );
        let text = response["event"]["diff"]["rhs"].to_string();
        assert!(text.contains("\"collapsed\":true"), "{text}");
    }

    #[test]
    fn a_preview_hides_vendored_and_deleted_files_before_any_source() {
        let previews: Value = serde_json::from_str(
            &differ(None)
                .preview_json(
                    &json!([
                        {"status": "modified", "lhs": {"path": "src/a.ts"}, "rhs": {"path": "src/a.ts"}},
                        {"status": "modified", "lhs": {"path": "vendor/lib.js"}, "rhs": {"path": "vendor/lib.js"}},
                        {"status": "deleted", "lhs": {"path": "src/old.ts"}},
                    ])
                    .to_string(),
                )
                .expect("the files preview"),
        )
        .unwrap();
        let hidden: Vec<bool> = previews
            .as_array()
            .unwrap()
            .iter()
            .map(|preview| preview["hidden"].is_string())
            .collect();
        assert_eq!(hidden, [false, true, true], "{previews}");
        assert!(previews[1]["entry"]["tags"]
            .as_array()
            .unwrap()
            .contains(&"vendored".into()));
    }

    #[test]
    fn a_hidden_file_is_collapsed_and_diffed_by_line() {
        let response = diff(
            &differ(None),
            json!({
                "status": "modified",
                "lhs": {"path": "vendor/lib.js", "text": "a();\n"},
                "rhs": {"path": "vendor/lib.js", "text": "b();\n"},
            }),
        );
        assert!(response["hidden"].is_string(), "{response}");
        let diff = &response["event"]["diff"];
        assert_eq!(diff["stats"]["fallback"]["code"], "hidden", "{diff}");
    }

    #[test]
    fn overrides_merge_into_the_config_table_by_table() {
        let config = merged(
            Some("[plugins.shape.bundled.summarize]\nmin_lines = 5\nprovider = \"openai\"\n"),
            Some(r#"{"plugins": {"shape": {"bundled": {"summarize": {"enabled": true, "provider": "anthropic"}}}}}"#),
        )
        .unwrap()
        .unwrap();
        let table: toml::Table = toml::from_str(&config).unwrap();
        let summarize = &table["plugins"]["shape"]["bundled"]["summarize"];
        assert_eq!(summarize["min_lines"].as_integer(), Some(5));
        assert_eq!(summarize["provider"].as_str(), Some("anthropic"));
        assert_eq!(summarize["enabled"].as_bool(), Some(true));
    }

    #[test]
    fn the_summarizer_runs_only_in_its_own_pass_and_asks_the_page() {
        let differ = Differ::from_config(
            merged(
                None,
                Some(r#"{"plugins": {"shape": {"bundled": {"summarize": {"enabled": true, "api_key": "key", "min_lines": 1}}}}}"#),
            )
            .unwrap()
            .as_deref(),
        )
        .expect("the config loads");
        assert!(differ.summarizes());
        let body: String = (0..30).map(|i| format!("  const v{i} = {i};\n")).collect();
        let request = |summarize: bool| {
            json!({
                "status": "added",
                "rhs": {"path": "src/a.ts", "text": format!("export function f() {{\n{body}}}\n")},
                "summarize": summarize,
            })
        };
        let first = diff(&differ, request(false));
        assert_eq!(first["event"]["diff"]["type"], "text", "{first}");
        // Off the web there is no page, so the summarizer's request fails the file.
        let summarized = diff(&differ, request(true));
        let error = summarized["event"]["error"]["message"]
            .as_str()
            .unwrap_or_default();
        assert!(
            error.contains("no page to make HTTP requests"),
            "{summarized}"
        );
    }

    #[test]
    fn a_plugin_from_disk_is_a_config_error() {
        let error = Differ::from_config(Some("[plugins.shape.mine]\npath = \"plugins/mine\"\n"));
        assert!(error.is_err());
    }
}
