//! `diffr config`: read the schema and resolved values, and write one key to
//! the global file.
use super::{directory_of, Config, ConfigError};
use crate::plugin::config::PATH;
use serde_json::{json, Value};
use std::path::Path;

/// The resolved configuration as JSON, with the same nesting as the TOML.
/// The summarizer's API key is redacted unless `reveal` is set.
pub fn show(config: &Config, reveal: bool) -> serde_json::Value {
    serde_json::to_value(redacted(config, reveal)).expect("config serializes")
}

/// The configuration to print: the summarizer's API key replaced by
/// `<redacted>` unless `reveal` is set.
pub fn redacted(config: &Config, reveal: bool) -> Config {
    let mut shown = config.clone();
    if !reveal {
        for entry in shown.plugins.shape.entries.values_mut() {
            if let Some(key) = entry
                .options
                .get_mut("api_key")
                .filter(|key| key.as_str().is_some_and(|key| !key.is_empty()))
            {
                *key = Value::String("<redacted>".into());
            }
        }
    }
    shown
}

/// Write `key = value`, preserving comments, then drop every key that only
/// restates a default (see [`prune`]). `value` is read as the type the schema gives the key (see
/// [`typed_value`]), then the whole file is validated, before anything
/// touches the disk: unknown keys, text that is not the key's type, and
/// values the configuration rejects are errors.
pub fn set(path: &Path, key: &str, value: &str) -> Result<bool, ConfigError> {
    if key.is_empty() || key.split('.').any(str::is_empty) {
        return Err(ConfigError(format!("invalid key {key:?}")));
    }
    edit(path, |existing, directory| {
        let typed = typed_value(key, &setting_schema(key, existing, directory)?, value)?;
        let parts: Vec<_> = key.split('.').collect();
        apply(existing, directory, &[(parts, typed)])
    })
}

/// Apply a typed partial configuration. Resets run against the old values
/// before any patch values are assigned, so a new provider and its key can
/// be saved together. Omitted fields are retained; null is not a TOML value.
pub fn patch(path: &Path, patch: &Value) -> Result<bool, ConfigError> {
    let table = patch
        .as_object()
        .ok_or_else(|| ConfigError("config patch must be an object".into()))?;
    let mut entries = Vec::new();
    flatten(table, &mut Vec::new(), &mut entries)?;
    edit(path, |existing, directory| {
        let entries: Vec<_> = entries
            .iter()
            .map(|(parts, value)| (parts.iter().map(String::as_str).collect(), value.clone()))
            .collect();
        let candidate = apply(existing, directory, &entries)?;
        let before = Config::from_toml_in(existing, directory)?;
        let after = Config::from_toml_in(&candidate.to_string(), directory)?;
        if show(&before, true) == show(&after, true) {
            parse(existing)
        } else {
            Ok(candidate)
        }
    })
}

fn flatten(
    table: &serde_json::Map<String, Value>,
    path: &mut Vec<String>,
    entries: &mut Vec<(Vec<String>, toml::Value)>,
) -> Result<(), ConfigError> {
    for (key, value) in table {
        if key.is_empty() {
            return Err(ConfigError("config patch contains an empty key".into()));
        }
        path.push(key.clone());
        let parts: Vec<_> = path.iter().map(String::as_str).collect();
        if let Some(table) = value.as_object().filter(|_| {
            plugin_setting(&parts).is_none()
                || matches!(parts.as_slice(), ["plugins", "shape", "bundled", _])
        }) {
            if table.is_empty() {
                return Err(ConfigError(format!(
                    "{}: empty patch table",
                    path.join(".")
                )));
            }
            flatten(table, path, entries)?;
        } else {
            let value = toml::Value::try_from(value)
                .map_err(|_| ConfigError(format!("{}: not a TOML value", path.join("."))))?;
            entries.push((path.clone(), value));
        }
        path.pop();
    }
    Ok(())
}

fn apply(
    existing: &str,
    directory: &Path,
    entries: &[(Vec<&str>, toml::Value)],
) -> Result<toml_edit::DocumentMut, ConfigError> {
    let mut document = parse(existing)?;
    for (parts, value) in entries {
        reset(&mut document, parts, value, existing, directory)?;
    }
    for (parts, value) in entries {
        assign_parts(&mut document, parts, value)?;
    }
    prune(&mut document, directory)?;
    Ok(document)
}

pub(super) fn parse(source: &str) -> Result<toml_edit::DocumentMut, ConfigError> {
    source.parse::<toml_edit::DocumentMut>().map_err(|error| {
        // TOML's Display includes the source line, which may contain a key.
        let line = error.span().map(|span| {
            source.as_bytes()[..span.start]
                .iter()
                .filter(|byte| **byte == b'\n')
                .count()
                + 1
        });
        ConfigError(match line {
            Some(line) => format!("invalid TOML at line {line}: {}", error.message()),
            None => format!("invalid TOML: {}", error.message()),
        })
    })
}

/// Serialize native writers with a file lock, and reject outside edits made
/// while the candidate was being built. The candidate is validated in memory.
pub(super) fn edit(
    path: &Path,
    convert: impl FnOnce(&str, &Path) -> Result<toml_edit::DocumentMut, ConfigError>,
) -> Result<bool, ConfigError> {
    let parent = directory_of(path);
    std::fs::create_dir_all(parent)
        .map_err(|error| ConfigError(format!("{}: {error}", parent.display())))?;
    let path = if path.exists() {
        std::fs::canonicalize(path)
    } else {
        std::fs::canonicalize(parent)
            .map(|parent| parent.join(path.file_name().expect("config filename")))
    }
    .map_err(|error| ConfigError(format!("{}: {error}", path.display())))?;
    let lock_path = path.with_extension("toml.lock");
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|error| ConfigError(format!("{}: {error}", lock_path.display())))?;
    lock.lock()
        .map_err(|error| ConfigError(format!("{}: {error}", lock_path.display())))?;
    let existing = read(&path)?;
    let document = convert(&existing, directory_of(&path))?;
    let candidate = document.to_string();
    if candidate == existing {
        return Ok(false);
    }
    if read(&path)? != existing {
        return Err(ConfigError(
            "config changed while preparing the update; retry".into(),
        ));
    }
    write(&path, document)?;
    Ok(true)
}

fn read(path: &Path) -> Result<String, ConfigError> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(ConfigError(format!("{}: {error}", path.display()))),
    }
}

/// When `key` takes a new value, clear the options of its plugin that
/// belong to it: a provider's key, endpoint and model go with the provider.
fn reset(
    document: &mut toml_edit::DocumentMut,
    segments: &[&str],
    value: &toml::Value,
    existing: &str,
    directory: &Path,
) -> Result<(), ConfigError> {
    let Some(("shape", name, field)) = plugin_setting(segments) else {
        return Ok(());
    };
    let config = Config::from_toml_in(existing, directory)?;
    let Some(entry) = config.plugins.shape.entries.get(&name) else {
        return Ok(());
    };
    if entry.options.get(field) == serde_json::to_value(value).ok().as_ref() {
        return Ok(());
    }
    for option in entry.folder().manifest.reset_by(field) {
        let mut path = segments[..segments.len() - 1].to_vec();
        path.push(option);
        super::prune::remove(document.as_table_mut(), &path);
    }
    Ok(())
}

/// Validate the document, then keep only what differs from the defaults,
/// and the file's `version`.
fn prune(document: &mut toml_edit::DocumentMut, directory: &Path) -> Result<(), ConfigError> {
    if !document.contains_key("version") {
        document.insert(
            "version",
            toml_edit::value(i64::from(super::CONFIG_VERSION)),
        );
    }
    Config::from_toml_in(&document.to_string(), directory)?;
    super::prune::prune(document, |text| {
        let config = Config::from_toml_in(text, directory).ok()?;
        toml::Value::try_from(config).ok()
    });
    Ok(())
}

fn write(path: &Path, document: toml_edit::DocumentMut) -> Result<(), ConfigError> {
    use std::io::Write;
    let mut temporary = tempfile::NamedTempFile::new_in(directory_of(path))
        .map_err(|error| ConfigError(format!("{}: {error}", path.display())))?;
    temporary
        .write_all(document.to_string().as_bytes())
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| ConfigError(format!("{}: {error}", path.display())))?;
    temporary
        .persist(path)
        .map_err(|error| ConfigError(format!("{}: {}", path.display(), error.error)))?;
    Ok(())
}

/// The JSON Schema of the setting at the dotted `key`, as `diffr config
/// schema` describes it. A plugin entry's keys come from the entry's own
/// `plugin.toml`, which for an entry with `path` is in the folder the file `existing`
/// (in `directory`) points it at; `path` is diffr's, and a string.
fn setting_schema(key: &str, existing: &str, directory: &Path) -> Result<Value, ConfigError> {
    let unknown = || ConfigError(format!("{key}: unknown key"));
    let config = Config::from_toml_in(existing, directory)?;
    let segments: Vec<_> = key.split('.').collect();
    if let Some((namespace, name, field)) = plugin_setting(&segments) {
        let (manifest, custom) = match namespace {
            "shape" => {
                let entry = config
                    .plugins
                    .shape
                    .entries
                    .get(&name)
                    .ok_or_else(unknown)?;
                (&entry.folder().manifest, !name.starts_with("bundled."))
            }
            "classify" if config.plugins.classify.name == name && field != "enabled" => (
                &config.plugins.classify.folder().manifest,
                name != "bundled",
            ),
            _ => return Err(unknown()),
        };
        if field == PATH && custom {
            return Ok(json!({"type": "string"}));
        }
        return manifest.settings_schema()["properties"]
            .get(field)
            .cloned()
            .ok_or_else(unknown);
    }
    let root = Config::schema();
    let resolve = |node: &Value| -> Value {
        match node.get("$ref").and_then(Value::as_str) {
            Some(reference) => {
                let name = reference.rsplit('/').next().expect("split yields a piece");
                root["$defs"][name].clone()
            }
            None => node.clone(),
        }
    };
    let mut node = root.clone();
    for segment in key.split('.') {
        node = resolve(
            resolve(&node)
                .get("properties")
                .and_then(|properties| properties.get(segment))
                .ok_or_else(unknown)?,
        );
    }
    if node.get("properties").is_some() {
        return Err(ConfigError(format!(
            "{key} is a table; set one of its keys"
        )));
    }
    Ok(node)
}

/// `text` read as the type `schema` gives the setting `key`, and nothing
/// else: a string setting takes the text as it is, an integer, number or
/// boolean setting takes only that TOML literal, an array setting a TOML
/// array, and an enum setting one of its choices.
fn typed_value(key: &str, schema: &Value, text: &str) -> Result<toml::Value, ConfigError> {
    let mistyped =
        |expected: &str| ConfigError(format!("{key}: expected {expected}, got {text:?}"));
    if let Some(choices) = schema.get("enum").and_then(Value::as_array) {
        if !choices.iter().any(|choice| choice.as_str() == Some(text)) {
            let choices: Vec<String> = choices.iter().map(Value::to_string).collect();
            return Err(mistyped(&format!("one of {}", choices.join(", "))));
        }
        return Ok(toml::Value::String(text.to_owned()));
    }
    // An optional setting is its type or null; `set` writes the type.
    let kinds: Vec<&str> = match schema.get("type") {
        Some(Value::String(kind)) => vec![kind.as_str()],
        Some(Value::Array(kinds)) => kinds
            .iter()
            .filter_map(Value::as_str)
            .filter(|kind| *kind != "null")
            .collect(),
        _ => Vec::new(),
    };
    let [kind] = kinds.as_slice() else {
        return Err(ConfigError(format!(
            "{key}: the schema gives it no single type, so config set cannot write it"
        )));
    };
    Ok(match *kind {
        "string" => toml::Value::String(text.to_owned()),
        "integer" => toml::Value::Integer(text.parse().map_err(|_| mistyped("an integer"))?),
        "number" => toml::Value::Float(text.parse().map_err(|_| mistyped("a number"))?),
        "boolean" => match text {
            "true" => toml::Value::Boolean(true),
            "false" => toml::Value::Boolean(false),
            _ => return Err(mistyped("true or false")),
        },
        "array" => {
            let mut table =
                toml::from_str::<toml::Table>(&format!("value = {text}")).map_err(|error| {
                    ConfigError(format!(
                        "{key}: expected a TOML array such as [\"a\", \"b\"], got {text:?}: {}",
                        error.message()
                    ))
                })?;
            match table
                .remove("value")
                .expect("the table has the one key parsed")
            {
                value @ toml::Value::Array(_) => value,
                _ => return Err(mistyped("a TOML array such as [\"a\", \"b\"]")),
            }
        }
        other => {
            return Err(ConfigError(format!(
                "{key}: config set cannot write a value of type {other}"
            )));
        }
    })
}

fn plugin_setting<'a>(parts: &'a [&str]) -> Option<(&'a str, String, &'a str)> {
    match parts {
        ["plugins", "shape", "bundled", name, field] => {
            Some(("shape", format!("bundled.{name}"), field))
        }
        ["plugins", namespace @ ("shape" | "classify"), name, field] => {
            Some((namespace, (*name).to_owned(), field))
        }
        _ => None,
    }
}

fn assign_parts(
    document: &mut toml_edit::DocumentMut,
    parts: &[&str],
    value: &toml::Value,
) -> Result<(), ConfigError> {
    insert(document, parts, toml_edit::Item::Value(edit_value(value)?))
}

pub(super) fn insert(
    document: &mut toml_edit::DocumentMut,
    parts: &[&str],
    value: toml_edit::Item,
) -> Result<(), ConfigError> {
    let (last, parents) = parts
        .split_last()
        .ok_or_else(|| ConfigError("empty config key".into()))?;
    let mut item = document.as_item_mut();
    for segment in parents {
        let table = item
            .as_table_like_mut()
            .ok_or_else(|| ConfigError(format!("{}: parent is not a table", parts.join("."))))?;
        if !table.contains_key(segment) {
            let mut nested = toml_edit::Table::new();
            nested.set_implicit(true);
            table.insert(segment, toml_edit::Item::Table(nested));
        }
        item = table.get_mut(segment).expect("just inserted");
    }
    item.as_table_like_mut()
        .ok_or_else(|| ConfigError(format!("{}: parent is not a table", parts.join("."))))?
        .insert(last, value);
    Ok(())
}

fn edit_value(value: &toml::Value) -> Result<toml_edit::Value, ConfigError> {
    Ok(match value {
        toml::Value::String(text) => toml_edit::Value::from(text.as_str()),
        toml::Value::Integer(number) => toml_edit::Value::from(*number),
        toml::Value::Float(number) => toml_edit::Value::from(*number),
        toml::Value::Boolean(flag) => toml_edit::Value::from(*flag),
        toml::Value::Array(items) => {
            let mut array = toml_edit::Array::new();
            for item in items {
                array.push(edit_value(item)?);
            }
            toml_edit::Value::Array(array)
        }
        toml::Value::Table(table) => {
            let mut result = toml_edit::InlineTable::new();
            for (key, value) in table {
                result.insert(key, edit_value(value)?);
            }
            toml_edit::Value::InlineTable(result)
        }
        toml::Value::Datetime(_) => {
            return Err(ConfigError(
                "config set takes a scalar or array value".into(),
            ));
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn set_writes_typed_values_and_keeps_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("config.toml");
        set(&path, "diff.graph_limit", "20").unwrap();
        // `theme.name` is a string, so digits are its text.
        set(&path, "theme.name", "1234").unwrap();
        set(&path, "theme.path", "themes/mine.toml").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("graph_limit = 20"), "{text}");
        assert!(text.contains("name = \"1234\""), "{text}");
        assert!(text.contains("path = \"themes/mine.toml\""), "{text}");
        let config = Config::from_toml(&text).unwrap();
        assert_eq!(config.diff.graph_limit, 20);
        assert_eq!(config.theme.name, "1234");
    }

    #[test]
    fn plugin_keys_are_written_under_their_quoted_names() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        set(
            &path,
            "plugins.shape.bundled.deleted-bodies.min_lines",
            "30",
        )
        .unwrap();
        set(&path, "plugins.shape.bundled.summarize.api_key", "secret").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let config = Config::from_toml(&text).unwrap();
        assert_eq!(
            config.plugins.shape.entries["bundled.deleted-bodies"].options["min_lines"],
            30
        );
        assert!(set(&path, "plugins.shape.bundled.deleted-bodies.typo", "1").is_err());
        assert!(set(
            &path,
            "plugins.shape.bundled.deleted-bodies.min_lines",
            "-1"
        )
        .is_err());
        assert!(set(&path, "plugins.shape.order", "[\"group\"]").is_err());
        let error = |key: &str, value: &str| set(&path, key, value).unwrap_err().to_string();
        assert_eq!(
            error("plugins.shape.bundled.context.enabled", "yes"),
            "plugins.shape.bundled.context.enabled: expected true or false, got \"yes\""
        );
        assert!(error("plugins.shape.order", "context")
            .starts_with("plugins.shape.order: expected a TOML array such as [\"a\", \"b\"]"));
        assert_eq!(
            error("plugins.shape.bundled.context.lines", "many"),
            "plugins.shape.bundled.context.lines: expected an integer, got \"many\""
        );
        assert_eq!(
            error("plugins.shape.bundled.summarize.provider", "mistral"),
            "plugins.shape.bundled.summarize.provider: expected one of \"gemini\", \"openai\", \"anthropic\", got \"mistral\""
        );
        assert_eq!(
            error("plugins.shape.mine.enabled", "true"),
            "plugins.shape.mine.enabled: unknown key"
        );
        set(&path, "plugins.shape.bundled.context.enabled", "false").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            Config::from_toml(&text).unwrap().plugins.shape.entries["bundled.context"].enabled,
            Some(false)
        );
        let shown = show(&config, false);
        assert_eq!(
            shown["plugins"]["shape"]["bundled"]["summarize"]["api_key"],
            "<redacted>"
        );
        assert_eq!(
            show(&config, true)["plugins"]["shape"]["bundled"]["summarize"]["api_key"],
            "secret"
        );
        assert_eq!(
            shown["plugins"]["shape"]["bundled"]["deleted-bodies"],
            serde_json::json!({"enabled": true, "min_lines": 30})
        );
        let text = toml::to_string_pretty(&redacted(&config, false)).unwrap();
        assert!(text.contains("[plugins.shape.bundled.summarize]"), "{text}");
        assert!(text.contains("system_prompt = "), "{text}");
    }

    #[test]
    fn classifier_settings_use_the_selected_manifests_types() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("plugin.toml"),
            "name = 'custom'\ntitle = 'Custom classifier'\n[options.depth]\ntype = 'integer'\ntitle = 'Depth'\ndefault = 2\n",
        ).unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "[plugins.classify.custom]\npath = '.'\n").unwrap();
        set(&path, "plugins.classify.custom.depth", "5").unwrap();
        let saved = std::fs::read_to_string(&path).unwrap();
        let config = Config::from_toml_in(&saved, dir.path()).unwrap();
        assert_eq!(config.plugins.classify.options["depth"], 5);
        assert!(set(&path, "plugins.classify.custom.depth", "many").is_err());
        assert!(set(&path, "plugins.classify.custom.enabled", "false").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), saved);
    }

    #[test]
    fn a_custom_name_with_spaces_keeps_its_identity_when_edited() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("plugin.toml"),
            "name = 'my context'\ntitle = 'Custom'\n[options.depth]\ntype = 'integer'\ntitle = 'Depth'\ndefault = 2\n").unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(
            &path,
            "[plugins.shape]\norder = ['my context']\n[plugins.shape.\"my context\"]\npath = '.'\n",
        )
        .unwrap();
        set(&path, "plugins.shape.my context.depth", "5").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let config = Config::from_toml_in(&text, dir.path()).unwrap();
        assert_eq!(
            config.plugins.shape.entries["my context"].options["depth"],
            5
        );
        assert_eq!(config.plugins.shape.queries().unwrap()[0].0, "my context");
        set(&path, "plugins.shape.my context.depth", "2").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("depth"), "{text}");
        let config = Config::from_toml_in(&text, dir.path()).unwrap();
        assert_eq!(
            config.plugins.shape.entries["my context"].options["depth"],
            2
        );
    }

    #[test]
    fn an_old_format_is_reported_before_its_keys_and_left_as_it_is() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let old = "version = 1\n[plugins.bundled.context]\nlines = 8\n";
        std::fs::write(&path, old).unwrap();
        let error = set(&path, "plugins.bundled.context.lines", "9").unwrap_err();
        assert!(
            error.to_string().contains("unsupported config version 1"),
            "{error}"
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), old);
    }

    #[test]
    fn a_wasm_plugin_option_takes_the_type_its_folder_declares() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("plugins/mine");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(
            folder.join("plugin.toml"),
            "name = 'mine'\ntitle = 'Mine'\n[options.depth]\ntype = 'integer'\ntitle = 'Depth'\ndefault = 2\n",
        )
        .unwrap();
        let path = dir.path().join("config.toml");
        let order = "order = ['bundled.context', 'bundled.deleted-bodies', 'bundled.test-bodies', 'bundled.removed-runs', 'bundled.summarize', 'mine']";
        std::fs::write(
            &path,
            format!("[plugins.shape]\n{order}\n[plugins.shape.mine]\npath = 'plugins/mine'\n"),
        )
        .unwrap();
        set(&path, "plugins.shape.mine.depth", "3").unwrap();
        set(&path, "plugins.shape.mine.enabled", "false").unwrap();
        set(&path, "plugins.shape.mine.path", "plugins/mine").unwrap();
        let error = |key: &str, value: &str| set(&path, key, value).unwrap_err().to_string();
        assert_eq!(
            error("plugins.shape.mine.depth", "deep"),
            "plugins.shape.mine.depth: expected an integer, got \"deep\""
        );
        assert_eq!(
            error("plugins.shape.mine.typo", "1"),
            "plugins.shape.mine.typo: unknown key"
        );
        let text = std::fs::read_to_string(&path).unwrap();
        let config = Config::from_toml_in(&text, dir.path()).unwrap();
        assert_eq!(config.plugins.shape.entries["mine"].options["depth"], 3);
        assert_eq!(config.plugins.shape.entries["mine"].enabled, Some(false));
    }

    #[test]
    fn set_rejects_unknown_keys_and_wrong_types_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "# keep me\n[diff]\ngraph_limit = 4\n").unwrap();
        let error = |key: &str, value: &str| set(&path, key, value).unwrap_err().to_string();
        assert_eq!(error("diff.typo", "1"), "diff.typo: unknown key");
        assert_eq!(
            error("diff.graph_limit", "abc"),
            "diff.graph_limit: expected an integer, got \"abc\""
        );
        assert_eq!(
            error("diff.graph_limit", "\"20\""),
            "diff.graph_limit: expected an integer, got \"\\\"20\\\"\""
        );
        assert!(error("diff.graph_limit", "-1").starts_with("diff.graph_limit: "));
        assert_eq!(error("diff", "1"), "diff is a table; set one of its keys");
        assert_eq!(error("", "1"), "invalid key \"\"");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "# keep me\n[diff]\ngraph_limit = 4\n"
        );
    }

    #[test]
    fn values_are_read_as_the_setting_type_only() {
        let value = |schema: Value, text: &str| typed_value("k", &schema, text);
        let error = |schema: Value, text: &str| value(schema, text).unwrap_err().to_string();
        assert_eq!(
            value(json!({"type": "string"}), "12").unwrap(),
            toml::Value::String("12".into())
        );
        assert_eq!(
            value(json!({"type": ["string", "null"]}), "true").unwrap(),
            toml::Value::String("true".into())
        );
        assert_eq!(
            value(json!({"type": "integer"}), "12").unwrap(),
            toml::Value::Integer(12)
        );
        assert_eq!(
            error(json!({"type": "integer"}), "1.5"),
            "k: expected an integer, got \"1.5\""
        );
        assert_eq!(
            value(json!({"type": "number"}), "1.5").unwrap(),
            toml::Value::Float(1.5)
        );
        assert_eq!(
            value(json!({"type": "boolean"}), "false").unwrap(),
            toml::Value::Boolean(false)
        );
        assert_eq!(
            error(json!({"type": "boolean"}), "yes"),
            "k: expected true or false, got \"yes\""
        );
        assert_eq!(
            value(json!({"type": "array"}), "[\"a\", \"b\"]").unwrap(),
            toml::Value::Array(vec!["a".into(), "b".into()])
        );
        assert_eq!(
            error(json!({"type": "array"}), "12"),
            "k: expected a TOML array such as [\"a\", \"b\"], got \"12\""
        );
        assert!(error(json!({"type": "array"}), "a, b")
            .starts_with("k: expected a TOML array such as [\"a\", \"b\"], got \"a, b\": "));
        assert_eq!(
            value(json!({"enum": ["gemini"]}), "gemini").unwrap(),
            toml::Value::String("gemini".into())
        );
        assert_eq!(
            error(json!({"enum": ["gemini"]}), "openai"),
            "k: expected one of \"gemini\", got \"openai\""
        );
        assert_eq!(
            error(json!({"type": ["integer", "string"]}), "1"),
            "k: the schema gives it no single type, so config set cannot write it"
        );
        assert_eq!(
            error(json!({"type": "object"}), "{}"),
            "k: config set cannot write a value of type object"
        );
    }
}

#[cfg(test)]
mod sparse_tests {
    use super::*;

    fn read_toml(path: &Path) -> toml::Value {
        toml::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn set_writes_only_what_differs_from_the_defaults_and_keeps_comments() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        set(&path, "diff.graph_limit", "42").unwrap();
        let raw = read_toml(&path);
        assert_eq!(raw["version"].as_integer(), Some(2));
        assert_eq!(raw["diff"]["graph_limit"].as_integer(), Some(42));
        assert!(raw.get("plugins").is_none(), "{raw}");
        let text = std::fs::read_to_string(&path).unwrap();
        std::fs::write(&path, format!("# personal config\n{text}")).unwrap();
        set(&path, "plugins.shape.bundled.context.lines", "8").unwrap();
        set(&path, "plugins.shape.bundled.summarize.api_key", "").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("# personal config\n"), "{text}");
        let raw = read_toml(&path);
        assert_eq!(
            raw["plugins"]["shape"]["bundled"]["context"]["lines"].as_integer(),
            Some(8)
        );
        // An empty key is not the same as no key, so it stays.
        assert_eq!(
            raw["plugins"]["shape"]["bundled"]["summarize"]["api_key"].as_str(),
            Some("")
        );
        // Setting a default removes the key.
        set(&path, "plugins.shape.bundled.context.lines", "3").unwrap();
        let raw = read_toml(&path);
        assert!(
            raw["plugins"]["shape"]["bundled"].get("context").is_none(),
            "{raw}"
        );
        assert_eq!(Config::from_toml(&text).unwrap().diff.graph_limit, 42);
    }

    #[test]
    fn a_materialized_file_becomes_sparse() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        // What earlier versions wrote on the first edit: every default.
        let mut old = toml::Value::try_from(Config::default()).unwrap();
        let summarize = old["plugins"]["shape"]["bundled"]["summarize"]
            .as_table_mut()
            .unwrap();
        summarize.insert("api_key".into(), "secret".into());
        old["plugins"]["shape"]["bundled"]["context"]
            .as_table_mut()
            .unwrap()
            .insert("lines".into(), 8.into());
        std::fs::write(&path, toml::to_string(&old).unwrap()).unwrap();
        set(&path, "diff.graph_limit", "42").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("[plugins.shape]\n"), "{text}");
        let raw = read_toml(&path);
        let mut keys = Vec::new();
        fn walk(value: &toml::Value, prefix: String, keys: &mut Vec<String>) {
            match value.as_table() {
                Some(table) => {
                    for (key, child) in table {
                        walk(child, format!("{prefix}{key}."), keys);
                    }
                }
                None => keys.push(prefix.trim_end_matches('.').to_owned()),
            }
        }
        walk(&raw, String::new(), &mut keys);
        assert_eq!(
            keys,
            [
                "diff.graph_limit",
                "plugins.shape.bundled.context.lines",
                "plugins.shape.bundled.summarize.api_key",
                "version",
            ]
        );
    }

    #[test]
    fn commented_keys_and_tables_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(
            &path,
            "# my settings\n[plugins.shape] # note\n[plugins.shape.bundled.context]\n# lines = 10 later\nenabled = true\nlines = 8\n",
        )
        .unwrap();
        set(&path, "diff.graph_limit", "42").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        for comment in ["# my settings", "# note", "# lines = 10 later"] {
            assert!(text.contains(comment), "{comment} in {text}");
        }
    }

    #[test]
    fn a_comment_inside_a_default_list_keeps_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(
            &path,
            "[plugins.classify.bundled]\nhide = [\n  # keep generated code out\n  \"generated\",\n  \"vendored\",\n  \"test\", # tests too\n]\n",
        )
        .unwrap();
        set(&path, "diff.graph_limit", "42").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        for comment in ["# keep generated code out", "# tests too"] {
            assert!(text.contains(comment), "{comment} in {text}");
        }
    }

    #[test]
    fn tables_left_empty_by_pruning_go_too() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        // Earlier versions wrote every table with its own header.
        std::fs::write(
            &path,
            "version = 2\n\n[plugins.shape]\n[plugins.shape.bundled.context]\nlines = 3\n",
        )
        .unwrap();
        set(&path, "diff.graph_limit", "42").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("shape"), "{text}");
    }

    #[test]
    fn a_model_equal_to_its_providers_default_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        set(&path, "plugins.shape.bundled.summarize.provider", "openai").unwrap();
        set(&path, "plugins.shape.bundled.summarize.model", "gpt-6-luna").unwrap();
        let raw = read_toml(&path);
        assert!(
            raw["plugins"]["shape"]["bundled"]["summarize"]
                .get("model")
                .is_none(),
            "{raw}"
        );
        set(
            &path,
            "plugins.shape.bundled.summarize.model",
            "gemini-3.8-flash",
        )
        .unwrap();
        let raw = read_toml(&path);
        assert_eq!(
            raw["plugins"]["shape"]["bundled"]["summarize"]["model"].as_str(),
            Some("gemini-3.8-flash")
        );
    }

    #[test]
    fn a_new_provider_clears_the_old_ones_settings_but_keeps_the_prompt() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let summarize = |key: &str, value: &str| {
            set(
                &path,
                &format!("plugins.shape.bundled.summarize.{key}"),
                value,
            )
            .unwrap()
        };
        summarize("provider", "anthropic");
        summarize("api_key", "anthropic-key");
        summarize("endpoint", "https://proxy.example/anthropic");
        summarize("model", "claude-sonnet-5-5");
        summarize("system_prompt", "Be terse.");
        summarize("min_lines", "7");
        // The same provider again changes nothing.
        summarize("provider", "anthropic");
        let raw = read_toml(&path);
        assert_eq!(
            raw["plugins"]["shape"]["bundled"]["summarize"]["api_key"].as_str(),
            Some("anthropic-key")
        );
        summarize("provider", "gemini");
        let raw = read_toml(&path);
        let entry = raw["plugins"]["shape"]["bundled"]["summarize"]
            .as_table()
            .unwrap();
        let mut keys: Vec<&str> = entry.keys().map(String::as_str).collect();
        keys.sort_unstable();
        // Gemini is the default provider, so it is pruned too.
        assert_eq!(keys, ["min_lines", "system_prompt"], "{raw}");
    }

    #[test]
    fn an_explicit_plugin_list_still_pins_membership() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(
            &path,
            "# just context\n[plugins.shape]\norder = ['bundled.context']\n",
        )
        .unwrap();
        set(&path, "diff.graph_limit", "42").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let config = Config::from_toml(&text).unwrap();
        assert_eq!(config.plugins.shape.entries.len(), 1);
        assert!(text.contains("# just context\n[plugins.shape]"), "{text}");
        assert!(!text.contains("deleted-bodies"));
    }
}

#[cfg(test)]
mod patch_tests {
    use super::*;

    #[test]
    fn provider_reset_precedes_explicit_batch_values() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "version = 2\n[plugins.shape.bundled.summarize]\nprovider = 'gemini'\napi_key = 'old-key'\nmodel = 'old-model'\nendpoint = 'old-endpoint'\n").unwrap();
        patch(&path, &json!({"plugins": {"shape": {"bundled": {"summarize": {"enabled": true, "provider": "openai", "api_key": "new-key", "model": "new-model"}}}}})).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let values = show(&Config::from_toml(&text).unwrap(), true);
        let summary = &values["plugins"]["shape"]["bundled"]["summarize"];
        assert_eq!(summary["api_key"], "new-key");
        assert_eq!(summary["model"], "new-model");
        assert_eq!(summary["enabled"], true);
        assert!(!text.contains("old-endpoint"));
    }

    #[test]
    fn a_rejected_batch_saves_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let original = "version = 2\n[plugins.shape.bundled.context]\nlines = 8 # saved value\n";
        std::fs::write(&path, original).unwrap();
        for patch_value in [
            json!({"plugins": {"shape": {"bundled": {"summarize": {"api_key": "private-key"}, "context": {"lines": -1}}}}}),
            json!({"diff": {"graph_limit": "wrong-type"}}),
            json!({"diff": {"unknown": true}}),
            json!({"diff": {"graph_limit": null}}),
        ] {
            assert!(patch(&path, &patch_value).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        }
    }
}

#[cfg(test)]
mod concurrent_writes {
    use super::*;

    #[test]
    fn separate_writers_keep_both_updates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "version = 2\n").unwrap();
        let barrier = std::sync::Barrier::new(2);
        std::thread::scope(|scope| {
            for patch_value in [
                json!({"diff": {"graph_limit": 1234}}),
                json!({"plugins": {"shape": {"bundled": {"context": {"lines": 17}}}}}),
            ] {
                let path = &path;
                let barrier = &barrier;
                scope.spawn(move || {
                    barrier.wait();
                    patch(path, &patch_value).unwrap();
                });
            }
        });
        let text = std::fs::read_to_string(&path).unwrap();
        let values = show(&Config::from_toml(&text).unwrap(), false);
        assert_eq!(values["diff"]["graph_limit"], 1234);
        assert_eq!(
            values["plugins"]["shape"]["bundled"]["context"]["lines"],
            17
        );
    }
}
