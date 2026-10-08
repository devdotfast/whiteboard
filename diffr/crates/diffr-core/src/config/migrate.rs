//! Convert the v1 settings supported by Whiteboard. Custom plugins and
//! pipeline configuration are not carried forward. No plugin files are read
//! until the completed v2 candidate is validated.
use super::{store, Config, ConfigError};
use serde::Serialize;
use std::path::Path;
use toml_edit::{DocumentMut, Item};

const SUMMARY_FIELDS: &[&str] = &[
    "enabled",
    "provider",
    "model",
    "api_key",
    "endpoint",
    "system_prompt",
    "tests",
];
const STOCK_PROMPTS: &[&str] = &[
    r#"For each listed fold, rewrite that function body as short python-flavored pseudocode. Keep the names. No prose, no comments, no code fences. Use as few lines as possible: about one pseudocode line per five source lines, and never more than a third of the body's lines. When a fold lists a doc, also set "summary" to one sentence copied verbatim from that doc; otherwise leave it empty. Answer with a JSON array of {"id", "summary", "pseudocode"} objects, one per fold."#,
    r#"For each listed fold, rewrite that function body as short pseudocode. Keep the names. No prose, no comments, no code fences. Use as few lines as possible: about one pseudocode line per five source lines, and never more than a third of the body's lines. When a fold lists a doc, also set "summary" to one sentence copied verbatim from that doc; otherwise leave it empty. Answer with a JSON array of {"id", "summary", "pseudocode"} objects, one per fold."#,
    r#"For each listed fold, rewrite that function body as short pseudocode. Keep the names. No prose, no comments, no code fences. Use as few lines as possible: about one pseudocode line per five source lines, and never more than a third of the body's lines. When a fold lists a doc, also set "summary" to one sentence copied verbatim from that doc; otherwise leave it empty. Answer with a JSON object whose "summaries" array holds one {"id", "summary", "pseudocode"} object per fold."#,
];

#[derive(Debug, Serialize)]
pub struct Migration {
    pub changed: bool,
    pub from: Option<i64>,
    pub to: u32,
    pub dropped: Vec<String>,
}

/// Migrate the global file's supported v1 settings. Current and missing files
/// are unchanged. A parse or validation failure leaves the original intact.
pub fn migrate(path: &Path) -> Result<Migration, ConfigError> {
    let mut result = Migration {
        changed: false,
        from: None,
        to: super::CONFIG_VERSION,
        dropped: Vec::new(),
    };
    if !path
        .try_exists()
        .map_err(|error| ConfigError(format!("{}: {error}", path.display())))?
    {
        return Ok(result);
    }
    result.changed = store::edit(path, |source, directory| {
        let mut document = store::parse(source)?;
        let version = match document.get("version") {
            None => 1,
            Some(item) => item
                .as_integer()
                .ok_or_else(|| ConfigError("version must be an integer".into()))?,
        };
        result.from = Some(version);
        if version == i64::from(super::CONFIG_VERSION) {
            return Ok(document);
        }
        if version != 1 {
            return Err(ConfigError(format!(
                "unsupported config version {version}; migration supports version 1"
            )));
        }
        let old = document.clone();
        document.remove("plugins");
        document.remove("classifier");
        document.insert(
            "version",
            toml_edit::value(i64::from(super::CONFIG_VERSION)),
        );
        let mut retained = Vec::new();
        for name in [
            "context",
            "deleted-bodies",
            "test-bodies",
            "removed-runs",
            "summarize",
        ] {
            let fields: &[&str] = match name {
                "summarize" => SUMMARY_FIELDS,
                "context" => &["enabled", "lines"],
                _ => &["enabled"],
            };
            for field in fields {
                let path = ["plugins", "bundled", name, field];
                if let Some(item) = get(&old, &path) {
                    if name == "summarize"
                        && *field == "system_prompt"
                        && item
                            .as_str()
                            .is_some_and(|text| STOCK_PROMPTS.contains(&text))
                    {
                        continue;
                    }
                    store::insert(
                        &mut document,
                        &["plugins", "shape", "bundled", name, field],
                        item.clone(),
                    )?;
                    retained.push(path.join("."));
                }
            }
        }
        // Explicit classifier values in intermediate v1 files take precedence.
        for field in ["hide", "hide_deleted"] {
            if let Some(item) = get(&old, &["classifier", field]) {
                store::insert(
                    &mut document,
                    &["plugins", "classify", "bundled", field],
                    item.clone(),
                )?;
                retained.push(format!("classifier.{field}"));
            }
        }
        if let Some(hide) = get(&old, &["plugins", "bundled", "hide-files"]) {
            let flag = |field: &str| -> Result<bool, ConfigError> {
                hide.get(field)
                    .map(|item| {
                        item.as_bool().ok_or_else(|| {
                            ConfigError(format!(
                                "plugins.bundled.hide-files.{field}: expected boolean"
                            ))
                        })
                    })
                    .unwrap_or(Ok(true))
            };
            let enabled = flag("enabled")?;
            let deleted = flag("deleted")?;
            if get(&old, &["classifier", "hide"]).is_none() {
                let tags = if enabled {
                    hide.get("tags").cloned().unwrap_or_else(|| {
                        let mut tags = toml_edit::Array::new();
                        for tag in ["generated", "vendored", "test"] {
                            tags.push(tag);
                        }
                        Item::Value(tags.into())
                    })
                } else {
                    Item::Value(toml_edit::Array::new().into())
                };
                store::insert(
                    &mut document,
                    &["plugins", "classify", "bundled", "hide"],
                    tags,
                )?;
            }
            if get(&old, &["classifier", "hide_deleted"]).is_none() {
                store::insert(
                    &mut document,
                    &["plugins", "classify", "bundled", "hide_deleted"],
                    toml_edit::value(enabled && deleted),
                )?;
            }
            for field in ["enabled", "tags", "deleted"] {
                retained.push(format!("plugins.bundled.hide-files.{field}"));
            }
        }
        for root in ["plugins", "classifier"] {
            if let Some(item) = old.get(root) {
                dropped(item, &mut vec![root.into()], &retained, &mut result.dropped);
            }
        }
        Config::from_toml_in(&document.to_string(), directory)?;
        Ok(document)
    })?;
    Ok(result)
}

fn get<'a>(document: &'a DocumentMut, parts: &[&str]) -> Option<&'a Item> {
    parts
        .iter()
        .try_fold(document.as_item(), |item, part| item.get(part))
}

fn dropped(item: &Item, path: &mut Vec<String>, retained: &[String], result: &mut Vec<String>) {
    if let Some(table) = item.as_table_like() {
        for (key, item) in table.iter() {
            path.push(key.into());
            dropped(item, path, retained, result);
            path.pop();
        }
    } else {
        let key = path.join(".");
        if !retained.contains(&key) {
            result.push(key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn file(source: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, source).unwrap();
        (dir, path)
    }

    #[test]
    fn migrates_whiteboard_values_and_drops_unmanaged_plugins_without_reading_them() {
        let (_dir, path) = file(concat!(
            "version = 1\n[plugins]\norder = ['external.bundled', 'bundled.summarize']\n",
            "[plugins.external.bundled]\npath = 'does-not-exist'\n",
            "[plugins.bundled.context]\nenabled = false\nlines = 17 # keep this\n",
            "[plugins.bundled.summarize]\nenabled = true\ninstances = 3\nmax_concurrency = 9\n",
            "provider = 'openai'\napi_key = 'saved-key'\nmodel = 'my-model'\nendpoint = 'https://example.test'\n",
            "system_prompt = '''  Custom prompt\nwith two lines.\n'''\ntests = false\nmin_lines = 999\n",
            "[plugins.bundled.group]\nenabled = true\n",
            "[plugins.bundled.hide-files]\nenabled = true\ntags = ['test']\ndeleted = false\n",
            "[diff]\nbyte_limit = 123456\n[theme]\npath = 'themes/mine.toml'\n"
        ));
        let result = migrate(&path).unwrap();
        assert!(result.changed);
        assert!(result
            .dropped
            .contains(&"plugins.bundled.summarize.instances".into()));
        assert!(result
            .dropped
            .contains(&"plugins.external.bundled.path".into()));
        let text = std::fs::read_to_string(&path).unwrap();
        let config = Config::from_toml_in(&text, path.parent().unwrap()).unwrap();
        let values = store::show(&config, true);
        assert_eq!(
            values["plugins"]["shape"]["bundled"]["context"]["lines"],
            17
        );
        assert_eq!(
            values["plugins"]["shape"]["bundled"]["context"]["enabled"],
            false
        );
        assert_eq!(
            values["plugins"]["shape"]["bundled"]["summarize"]["api_key"],
            "saved-key"
        );
        assert_eq!(
            values["plugins"]["shape"]["bundled"]["summarize"]["system_prompt"],
            "  Custom prompt\nwith two lines.\n"
        );
        assert_eq!(
            values["plugins"]["classify"]["bundled"]["hide"],
            json!(["test"])
        );
        assert_eq!(
            values["plugins"]["classify"]["bundled"]["hide_deleted"],
            false
        );
        assert_eq!(values["diff"]["byte_limit"], 123456);
        assert!(text.contains("# keep this"));
        assert!(!migrate(&path).unwrap().changed);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
    }

    #[test]
    fn disabled_hide_and_explicit_classifier_values_are_retained() {
        for (source, tags, deleted) in [
            ("[plugins.bundled.hide-files]\nenabled = false\n", json!([]), false),
            ("[classifier]\npath = 'missing'\nhide = ['team']\nhide_deleted = true\n[plugins.bundled.hide-files]\nenabled = false\n", json!(["team"]), true),
        ] {
            let (_dir, path) = file(source);
            migrate(&path).unwrap();
            let text = std::fs::read_to_string(&path).unwrap();
            let values = store::show(&Config::from_toml(&text).unwrap(), false);
            assert_eq!(values["plugins"]["classify"]["bundled"]["hide"], tags);
            assert_eq!(values["plugins"]["classify"]["bundled"]["hide_deleted"], deleted);
        }
    }

    #[test]
    fn stock_prompts_follow_the_new_default() {
        for prompt in STOCK_PROMPTS {
            let (_dir, path) = file(&format!(
                "[plugins.bundled.summarize]\nsystem_prompt = {prompt:?}\n"
            ));
            migrate(&path).unwrap();
            assert!(!std::fs::read_to_string(path)
                .unwrap()
                .contains("system_prompt"));
        }
    }

    #[test]
    fn errors_preserve_the_file_and_do_not_echo_credentials() {
        for source in [
            "version = 9\n",
            "version = 1\n[plugins.bundled.summarize]\napi_key = 'private-key'\nprovider = 'unknown'\n",
            "[plugins.bundled.context]\nlines = -1\n",
            "api_key = 'private-key\n",
        ] {
            let (_dir, path) = file(source);
            let error = migrate(&path).unwrap_err().to_string();
            assert!(!error.contains("private-key"), "{error}");
            assert_eq!(std::fs::read_to_string(path).unwrap(), source);
        }
        let dir = tempfile::tempdir().unwrap();
        assert!(!migrate(&dir.path().join("absent.toml")).unwrap().changed);
    }
}
