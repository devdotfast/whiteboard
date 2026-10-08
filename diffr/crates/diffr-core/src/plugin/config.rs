//! `[plugins.shape]`: the order plugins run in, and one entry per plugin with its
//! switch and options. Also `plugin.toml`, the static description every
//! plugin folder carries: the plugin's name, title and options schema.
//!
//! The embedded default config selects bundled plugins. An explicit `order`
//! is authoritative; every declared entry must appear exactly once. Bundled
//! entries use embedded components; external entries require a folder containing
//! `plugin.toml` and `plugin.wasm`. Options come from each manifest.
use super::builtin;
use super::queries::{PluginQuery, Queries};
use crate::config::ConfigError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// The key in a plugin entry that turns the plugin on and off.
pub(crate) const ENABLED: &str = "enabled";

/// The key in a plugin entry that points at a plugin folder on disk.
pub(crate) const PATH: &str = "path";

/// The keys in a plugin entry that diffr owns: a plugin's options may not
/// use them.
pub(crate) const RESERVED: [&str; 2] = [ENABLED, PATH];

/// A plugin folder's description, and its component when it has one.
pub(crate) const MANIFEST_FILE: &str = "plugin.toml";
/// An option's default that depends on another option's value:
/// `{ key = "<option>", values = { <value> = <default>, ... } }`.
const DEFAULT_BY: &str = "x-default-by";
/// The option whose change clears this one, such as a provider's key.
const RESET_BY: &str = "x-reset-by";
pub(crate) const COMPONENT_FILE: &str = "plugin.wasm";

/// A plugin's `plugin.toml`.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    /// The plugin's name, and the prefix of every tag
    /// its queries set: `<name>:<tag>`.
    pub(crate) name: String,
    /// The human name settings screens group the plugin's settings under.
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) description: String,
    /// How settings screens show the `enabled` switch, and whether the
    /// plugin is on by default. Without it the switch is titled
    /// `Run <title>` and the plugin is on.
    #[serde(default)]
    pub(crate) enabled: Option<Switch>,
    /// Each option's JSON Schema, in the order settings screens list them.
    /// Every option has a `title`; one with a `default` is pre-filled.
    #[serde(default)]
    pub(crate) options: Map<String, Value>,
    /// Each language's fold query: a file in the plugin's folder.
    #[serde(default)]
    pub(crate) queries: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Switch {
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) description: String,
    /// Whether an entry that does not set `enabled` runs the plugin.
    #[serde(default = "on")]
    pub(crate) default: bool,
}

fn on() -> bool {
    true
}

impl Manifest {
    /// Parse and check a `plugin.toml`.
    pub(crate) fn parse(text: &str) -> Result<Self, String> {
        let manifest: Self = toml::from_str(text).map_err(|error| error.to_string())?;
        manifest.check()?;
        Ok(manifest)
    }

    /// The manifest has a name and a title, every option has a title and
    /// is not a key diffr owns, the options schema is valid, and every
    /// default satisfies it.
    fn check(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("the plugin has no name".to_owned());
        }
        if self.title.trim().is_empty() {
            return Err(format!("{}: the plugin has no title", self.name));
        }
        if let Some(reserved) = RESERVED.iter().find(|key| self.options.contains_key(**key)) {
            return Err(format!(
                "{}: the options declare {reserved:?}, which diffr owns",
                self.name
            ));
        }
        if let Some((key, _)) = self.options.iter().find(|(_, option)| {
            option
                .get("title")
                .and_then(Value::as_str)
                .is_none_or(|title| title.trim().is_empty())
        }) {
            return Err(format!(
                "{}: option {key:?} has no title for settings screens",
                self.name
            ));
        }
        self.validate(&self.defaults())
            .map_err(|error| format!("{}: the defaults: {error}", self.name))?;
        self.check_defaults_by()
    }

    /// The options a change of `key` clears.
    pub(crate) fn reset_by<'a>(&'a self, key: &'a str) -> impl Iterator<Item = &'a String> + 'a {
        self.options
            .iter()
            .filter(move |(_, option)| option.get(RESET_BY).and_then(Value::as_str) == Some(key))
            .map(|(name, _)| name)
    }

    /// Every `x-reset-by` names another option. Every `x-default-by` names an
    /// option with choices, gives a default for each choice, and every
    /// choice's defaults satisfy the schema.
    fn check_defaults_by(&self) -> Result<(), String> {
        for (name, option) in &self.options {
            if let Some(by) = option.get(RESET_BY) {
                if !by
                    .as_str()
                    .is_some_and(|key| key != name && self.options.contains_key(key))
                {
                    return Err(format!(
                        "{}: option {name:?}: {RESET_BY} must name another option",
                        self.name
                    ));
                }
            }
        }
        for (name, option) in &self.options {
            let Some(by) = option.get(DEFAULT_BY) else {
                continue;
            };
            let invalid =
                |problem: &str| format!("{}: option {name:?}: {DEFAULT_BY} {problem}", self.name);
            let key = by
                .get("key")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("needs a key"))?;
            let mut chain = vec![name.as_str()];
            let mut next = key;
            while let Some(by) = self
                .options
                .get(next)
                .and_then(|option| option.get(DEFAULT_BY))
            {
                if chain.contains(&next) {
                    return Err(invalid(&format!("forms a cycle through {chain:?}")));
                }
                chain.push(next);
                next = by.get("key").and_then(Value::as_str).unwrap_or_default();
            }
            let values = by
                .get("values")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid("needs values"))?;
            let choices: Vec<&str> = self
                .options
                .get(key)
                .and_then(|option| option.get("enum"))
                .and_then(Value::as_array)
                .ok_or_else(|| invalid(&format!("key {key:?} is not an option with choices")))?
                .iter()
                .filter_map(Value::as_str)
                .collect();
            let mut given: Vec<&str> = values.keys().map(String::as_str).collect();
            let mut expected = choices.clone();
            given.sort_unstable();
            expected.sort_unstable();
            if given != expected {
                return Err(invalid(&format!(
                    "must give a default for each of {choices:?}"
                )));
            }
            for choice in choices {
                let mut options = Map::from_iter([(key.to_owned(), Value::from(choice))]);
                self.fill_defaults(&mut options);
                self.validate(&options).map_err(|error| {
                    format!(
                        "{}: the defaults for {key} = {choice:?}: {error}",
                        self.name
                    )
                })?;
            }
        }
        Ok(())
    }

    /// The JSON Schema of the plugin's options as an object: unknown keys
    /// are errors.
    fn options_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": self.options,
            "additionalProperties": false,
        })
    }

    /// Check `options` against the options schema. The message leads with
    /// the dotted path of the key it concerns, when there is one.
    pub(crate) fn validate(&self, options: &Map<String, Value>) -> Result<(), String> {
        let validator = jsonschema::validator_for(&self.options_schema())
            .map_err(|error| format!("the options schema is invalid: {error}"))?;
        let instance = Value::Object(options.clone());
        let errors: Vec<String> = validator
            .iter_errors(&instance)
            .map(|error| match error.instance_path().as_str() {
                "" => error.to_string(),
                path => format!(
                    "{}: {error}",
                    path.trim_start_matches('/').replace('/', ".")
                ),
            })
            .collect();
        match errors.is_empty() {
            true => Ok(()),
            false => Err(errors.join("; ")),
        }
    }

    /// Whether an entry that does not set `enabled` runs the plugin.
    pub(crate) fn enabled_by_default(&self) -> bool {
        self.enabled.as_ref().is_none_or(|switch| switch.default)
    }

    /// Every option that declares a default, with it.
    pub fn defaults(&self) -> Map<String, Value> {
        self.options
            .iter()
            .filter_map(|(key, option)| {
                option
                    .get("default")
                    .map(|default| (key.clone(), default.clone()))
            })
            .collect()
    }

    /// Fill every option `options` leaves unset: from its `default`, or from
    /// its `x-default-by` for the value its key has.
    pub(crate) fn fill_defaults(&self, options: &mut Map<String, Value>) {
        for (key, default) in self.defaults() {
            options.entry(key).or_insert(default);
        }
        // A default may follow one that follows another, declared in any
        // order: fill until a round fills nothing.
        loop {
            let mut filled = false;
            for (name, option) in &self.options {
                let Some(by) = option
                    .get(DEFAULT_BY)
                    .filter(|_| !options.contains_key(name))
                else {
                    continue;
                };
                let default = by
                    .get("key")
                    .and_then(Value::as_str)
                    .and_then(|key| options.get(key))
                    .and_then(Value::as_str)
                    .and_then(|choice| by["values"].get(choice))
                    .cloned();
                if let Some(default) = default {
                    options.insert(name.clone(), default);
                    filled = true;
                }
            }
            if !filled {
                break;
            }
        }
    }

    /// The entry this plugin adds to `diffr config schema`.
    /// Each option keeps its own schema, with the plugin's title as its
    /// `x-group` unless it sets one. An option whose type is an array or an
    /// object is marked `"x-settings": false`: settings screens edit
    /// scalars.
    pub(crate) fn settings_schema(&self) -> Value {
        let group = &self.title;
        let (title, description) = match &self.enabled {
            Some(switch) => (switch.title.clone(), switch.description.clone()),
            None => (format!("Run {group}"), self.description.clone()),
        };
        let enabled = self.enabled_by_default();
        let mut properties = Map::new();
        properties.insert(
            ENABLED.to_owned(),
            json!({
                "type": "boolean",
                "title": title,
                "description": description,
                "default": enabled,
                "x-group": group,
            }),
        );
        for (key, option) in &self.options {
            let mut option = option.clone();
            if let Some(option) = option.as_object_mut() {
                option
                    .entry("x-group")
                    .or_insert_with(|| Value::String(group.clone()));
                let structured = |kind: &Value| matches!(kind.as_str(), Some("array" | "object"));
                let structured = match option.get("type") {
                    Some(Value::Array(kinds)) => kinds.iter().any(structured),
                    Some(kind) => structured(kind),
                    None => false,
                };
                if structured {
                    option.insert("x-settings".to_owned(), Value::Bool(false));
                }
            }
            properties.insert(key.clone(), option);
        }
        json!({
            "type": "object",
            "title": group,
            "description": self.description,
            "properties": properties,
            "additionalProperties": false,
        })
    }
}

/// `[plugins]`: the shape pipeline and the one file classifier.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PluginsConfig {
    pub shape: ShapeConfig,
    pub classify: ClassifierConfig,
}

impl PluginsConfig {
    pub(crate) fn schema() -> Value {
        json!({
            "type": "object",
            "description": "The shape pipeline and the classifier that tags changed files.",
            "properties": {
                "shape": ShapeConfig::schema(),
                "classify": ClassifierConfig::schema(),
            },
            "additionalProperties": false,
        })
    }
}

/// `[plugins.shape]`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(try_from = "PluginTables", into = "PluginTables")]
pub struct ShapeConfig {
    /// The plugins in the order they run; each sees the region trees the
    /// ones before it left. Every entry is listed exactly once.
    pub(crate) order: Vec<String>,
    /// Every entry, by reference: `bundled.<name>` or the whole custom name.
    pub entries: BTreeMap<String, Entry>,
}

/// The on-disk table. An explicit order makes the listed entries
/// authoritative; a partial settings file without order inherits the defaults.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct PluginTables {
    order: Option<Vec<String>>,
    bundled: BTreeMap<String, Entry>,
    #[serde(flatten)]
    entries: BTreeMap<String, Entry>,
}

fn default_tables() -> PluginTables {
    #[derive(Deserialize)]
    struct Defaults {
        plugins: PluginDefaults,
    }
    #[derive(Deserialize)]
    struct PluginDefaults {
        shape: PluginTables,
    }
    toml::from_str::<Defaults>(crate::config::DEFAULT_CONFIG)
        .expect("embedded plugin defaults")
        .plugins
        .shape
}

impl TryFrom<PluginTables> for ShapeConfig {
    type Error = ConfigError;

    fn try_from(tables: PluginTables) -> Result<Self, Self::Error> {
        for name in tables.entries.keys() {
            if name.starts_with("bundled.") {
                return Err(ConfigError(format!(
                    "plugins.shape.{name}: reserved plugin reference"
                )));
            }
        }
        let mut bundled = tables.bundled;
        let order = tables.order.unwrap_or_else(|| {
            let defaults = default_tables();
            for (name, default) in defaults.bundled {
                let entry = bundled.entry(name).or_default();
                if entry.enabled.is_none() {
                    entry.enabled = default.enabled;
                }
                for (key, value) in default.options {
                    entry.options.entry(key).or_insert(value);
                }
            }
            defaults.order.expect("embedded default order")
        });
        for reference in &order {
            if let Some(name) = reference.strip_prefix("bundled.") {
                bundled.entry(name.to_owned()).or_default();
            }
        }
        let entries = bundled
            .into_iter()
            .map(|(name, entry)| (format!("bundled.{name}"), entry))
            .chain(tables.entries.into_iter())
            .collect();
        Ok(Self { order, entries })
    }
}

impl From<ShapeConfig> for PluginTables {
    fn from(config: ShapeConfig) -> Self {
        let mut tables = Self {
            order: Some(config.order),
            ..Self::default()
        };
        for (reference, entry) in config.entries {
            if let Some(name) = reference.strip_prefix("bundled.") {
                tables.bundled.insert(name.to_owned(), entry);
            } else {
                tables.entries.insert(reference, entry);
            }
        }
        tables
    }
}

/// One plugin's entry: diffr's keys, and the plugin's options.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Entry {
    /// Whether the plugin runs; once resolved, set, from the file or the
    /// plugin's default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) enabled: Option<bool>,
    /// The plugin's folder on disk, as written: relative to the
    /// configuration file's directory, or absolute.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) path: Option<PathBuf>,
    /// The folder, loaded when the configuration resolves: `path`'s, or the
    /// bundled plugin's.
    #[serde(skip)]
    pub(crate) folder: Option<Folder>,
    #[serde(flatten)]
    pub options: Map<String, Value>,
}

/// `[plugins.classify.<name>]`: the one plugin that tags each changed file before
/// anything is diffed. `path` selects an external classifier.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(try_from = "ClassifyTables", into = "ClassifyTables")]
pub struct ClassifierConfig {
    /// `bundled`, or the custom plugin's manifest name.
    pub(crate) name: String,
    /// A classifier folder on disk, as written: relative to the configuration
    /// file's directory, or absolute.
    pub(crate) path: Option<PathBuf>,
    /// The folder, loaded when the configuration resolves.
    folder: Option<Folder>,
    /// The classifier's options, checked against its manifest.
    pub options: Map<String, Value>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct ClassifierEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<PathBuf>,
    #[serde(flatten)]
    options: Map<String, Value>,
}
type ClassifyTables = BTreeMap<String, ClassifierEntry>;

impl Default for ClassifierConfig {
    fn default() -> Self {
        Self {
            name: "bundled".into(),
            path: None,
            folder: None,
            options: Map::new(),
        }
    }
}

impl TryFrom<ClassifyTables> for ClassifierConfig {
    type Error = ConfigError;

    fn try_from(entries: ClassifyTables) -> Result<Self, Self::Error> {
        if entries.len() != 1 {
            return Err(ConfigError("expected exactly one classifier plugin".into()));
        }
        let (name, entry) = entries.into_iter().next().expect("one classifier");
        Ok(Self {
            name,
            path: entry.path,
            folder: None,
            options: entry.options,
        })
    }
}

impl From<ClassifierConfig> for ClassifyTables {
    fn from(config: ClassifierConfig) -> Self {
        Self::from([(
            config.name,
            ClassifierEntry {
                path: config.path,
                options: config.options,
            },
        )])
    }
}

impl ClassifierConfig {
    /// Load the classifier's folder, validate its options and fill their
    /// defaults.
    pub(crate) fn resolve(&mut self, base: &Path) -> Result<(), ConfigError> {
        let folder = match (self.name.as_str(), &self.path) {
            ("bundled", None) => Folder {
                location: Location::Classifier,
                manifest: builtin::classifier_manifest().clone(),
            },
            ("bundled", Some(_)) => {
                return Err(ConfigError(
                    "plugins.classify.bundled: bundled classifiers cannot set path".into(),
                ))
            }
            (name, Some(path)) => Folder::load(name, &base.join(path))
                .map_err(|error| ConfigError(format!("plugins.classify.{name}: {error}")))?,
            (name, None) => {
                return Err(ConfigError(format!(
                    "plugins.classify.{name}: custom classifiers require path"
                )))
            }
        };
        folder
            .manifest
            .validate(&self.options)
            .map_err(|error| ConfigError(format!("plugins.classify.{}: {error}", self.name)))?;
        folder.manifest.fill_defaults(&mut self.options);
        self.folder = Some(folder);
        Ok(())
    }

    /// The classifier's folder. Set once the configuration resolves.
    pub fn folder(&self) -> &Folder {
        self.folder
            .as_ref()
            .expect("a resolved classifier has its folder")
    }

    /// The `plugins.classify` property of `diffr config schema`: one plugin entry
    /// containing the bundled classifier's options, or one custom entry.
    pub(crate) fn schema() -> Value {
        let mut schema = builtin::classifier_manifest().settings_schema();
        let properties = schema["properties"]
            .as_object_mut()
            .expect("a settings schema has properties");
        // There is always one classifier: it cannot be turned off.
        properties.remove(ENABLED);
        json!({
            "type": "object",
            "description": "The one plugin that tags each changed file (generated, vendored, docs, test, or a custom tag) and hides some, before anything is diffed. Use `bundled` for the stock classifier, or one custom entry named after its manifest with a required `path`.",
            "properties": {"bundled": schema},
            "minProperties": 1,
            "maxProperties": 1,
            "additionalProperties": {
                "type": "object",
                "required": [PATH],
                "properties": {PATH: {"type": "string"}},
                "x-settings": false,
            },
        })
    }
}

/// Where a plugin folder is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Location {
    /// Embedded in diffr: `plugins/shape/<name>/`.
    Bundled,
    /// The bundled classifier, embedded from `plugins/classify/`.
    Classifier,
    /// On disk. Canonical.
    Disk(PathBuf),
}

/// A component loaded from disk or embedded with the executable.
pub enum ComponentSource {
    File(PathBuf),
    Bundled(&'static [u8]),
}

/// A plugin folder and the `plugin.toml` in it.
#[derive(Clone, Debug)]
pub struct Folder {
    pub(crate) location: Location,
    pub(crate) manifest: Manifest,
}

impl Folder {
    pub fn name(&self) -> &str {
        &self.manifest.name
    }

    /// The bundled plugin `name`'s embedded folder.
    fn bundled(name: &str) -> Option<Self> {
        builtin::manifest(name).map(|manifest| Self {
            location: Location::Bundled,
            manifest: manifest.clone(),
        })
    }

    /// Every plugin folder supplies a component.
    pub fn component(&self) -> ComponentSource {
        match &self.location {
            Location::Bundled => ComponentSource::Bundled(
                builtin::component(&self.manifest.name)
                    .expect("every bundled manifest has a component"),
            ),
            Location::Classifier => ComponentSource::Bundled(builtin::classifier_component()),
            Location::Disk(dir) => ComponentSource::File(dir.join(COMPONENT_FILE)),
        }
    }

    /// The query files the manifest declares, read from the folder.
    pub(crate) fn queries(&self) -> Result<Queries, ConfigError> {
        self.manifest
            .queries
            .iter()
            .map(|(language, file)| {
                let (name, text) = match &self.location {
                    Location::Bundled => {
                        let path = format!("{}/{file}", self.manifest.name);
                        let text = builtin::file(&path).ok_or_else(|| {
                            ConfigError(format!("plugins/shape/{path}: not a bundled file"))
                        })?;
                        (format!("builtin:{path}"), text.to_owned())
                    }
                    Location::Classifier => {
                        return Err(ConfigError("the classifier has no queries".to_owned()))
                    }
                    Location::Disk(dir) => {
                        let path = dir.join(file);
                        let text = std::fs::read_to_string(&path)
                            .map_err(|error| ConfigError(format!("{}: {error}", path.display())))?;
                        (path.display().to_string(), text)
                    }
                };
                Ok(PluginQuery {
                    language: language.clone(),
                    name,
                    text,
                })
            })
            .collect()
    }

    /// Load the folder at `dir` for the entry `name`: its `plugin.toml` must
    /// name the entry.
    fn load(name: &str, dir: &Path) -> Result<Self, ConfigError> {
        let folder = Self::read(dir)?;
        if folder.manifest.name != name {
            return Err(ConfigError(format!(
                "{}: the plugin is named {:?}, not {name:?}",
                dir.join(MANIFEST_FILE).display(),
                folder.manifest.name
            )));
        }
        Ok(folder)
    }

    /// Load the folder at `dir`, whatever its plugin is named.
    fn read(dir: &Path) -> Result<Self, ConfigError> {
        let dir = std::fs::canonicalize(dir)
            .map_err(|error| ConfigError(format!("{}: {error}", dir.display())))?;
        let manifest_path = dir.join(MANIFEST_FILE);
        let text = std::fs::read_to_string(&manifest_path)
            .map_err(|error| ConfigError(format!("{}: {error}", manifest_path.display())))?;
        let manifest = Manifest::parse(&text)
            .map_err(|error| ConfigError(format!("{}: {error}", manifest_path.display())))?;
        Ok(Self {
            location: Location::Disk(dir),
            manifest,
        })
    }
}

impl Entry {
    /// The entry's folder. Every entry has one once the configuration
    /// resolves.
    pub fn folder(&self) -> &Folder {
        self.folder
            .as_ref()
            .expect("a resolved entry has its plugin folder")
    }

    /// Whether the plugin runs.
    pub(crate) fn is_enabled(&self) -> bool {
        self.enabled.expect("a resolved entry is enabled or not")
    }
}

impl Default for ShapeConfig {
    fn default() -> Self {
        let mut config =
            Self::try_from(default_tables()).expect("the embedded shape tables are valid");
        config
            .resolve(Path::new(""))
            .expect("the bundled plugins' defaults are valid");
        config
    }
}

impl ShapeConfig {
    /// Resolve each selected entry, validate its options, fill their defaults,
    /// and require every entry to appear in the explicit order exactly once.
    pub(crate) fn resolve(&mut self, base: &Path) -> Result<(), ConfigError> {
        let mut identities = BTreeSet::new();
        for (name, entry) in &mut self.entries {
            let folder = match (name.strip_prefix("bundled."), &entry.path) {
                (Some(plugin), None) => Folder::bundled(plugin).ok_or_else(|| {
                    ConfigError(format!("plugins.shape.{name}: unknown bundled plugin"))
                })?,
                (Some(_), Some(_)) => {
                    return Err(ConfigError(format!(
                        "plugins.shape.{name}: bundled plugins cannot set path"
                    )))
                }
                (None, Some(path)) => Folder::load(name, &base.join(path))
                    .map_err(|error| ConfigError(format!("plugins.shape.{name}: {error}")))?,
                (None, None) => {
                    return Err(ConfigError(format!(
                        "plugins.shape.{name}: custom plugins require path"
                    )))
                }
            };
            let manifest = &folder.manifest;
            entry.enabled.get_or_insert(manifest.enabled_by_default());
            if entry.is_enabled() && !identities.insert(manifest.name.clone()) {
                return Err(ConfigError(format!(
                    "plugins.shape.{name}: plugin {:?} is enabled more than once",
                    manifest.name
                )));
            }
            manifest
                .validate(&entry.options)
                .map_err(|error| ConfigError(format!("plugins.shape.{name}: {error}")))?;
            manifest.fill_defaults(&mut entry.options);
            entry.folder = Some(folder);
        }
        let mut seen = BTreeSet::new();
        for name in &self.order {
            if !self.entries.contains_key(name) {
                return Err(ConfigError(format!(
                    "plugins.shape.order: no plugin entry named {name:?}"
                )));
            }
            if !seen.insert(name.as_str()) {
                return Err(ConfigError(format!(
                    "plugins.shape.order: {name:?} is listed twice"
                )));
            }
        }
        if let Some(missing) = self
            .entries
            .keys()
            .find(|name| !seen.contains(name.as_str()))
        {
            return Err(ConfigError(format!(
                "plugins.shape.order: the plugin entry {missing:?} is not listed"
            )));
        }
        Ok(())
    }

    /// Each enabled plugin's name and query files, in `order`.
    pub fn queries(&self) -> Result<Vec<(String, Queries)>, ConfigError> {
        self.enabled()
            .map(|(name, entry)| {
                Ok((
                    entry.folder().manifest.name.clone(),
                    entry
                        .folder()
                        .queries()
                        .map_err(|error| ConfigError(format!("plugins.shape.{name}: {error}")))?,
                ))
            })
            .collect()
    }

    /// The enabled entries, in `order`.
    pub fn enabled(&self) -> impl Iterator<Item = (&str, &Entry)> {
        self.order.iter().filter_map(|name| {
            self.entries
                .get(name)
                .filter(|entry| entry.is_enabled())
                .map(|entry| (name.as_str(), entry))
        })
    }

    /// The `plugins.shape` property of `diffr config schema`: `order`, and every
    /// bundled plugin's entry.
    pub(crate) fn schema() -> Value {
        let mut properties = Map::new();
        properties.insert(
            "order".to_owned(),
            json!({
                "type": "array",
                "items": {"type": "string"},
                "description": "The plugins in the order they run; each sees the region trees the ones before it left. Every entry is listed exactly once.",
                "default": Self::default().order,
                "x-settings": false,
            }),
        );
        let bundled: Map<String, Value> = builtin::manifests()
            .iter()
            .map(|manifest| (manifest.name.clone(), manifest.settings_schema()))
            .collect();
        properties.insert(
            "bundled".into(),
            json!({"type": "object", "properties": bundled, "additionalProperties": false}),
        );
        json!({
            "type": "object",
            "description": "The plugins that decide what starts collapsed, hidden, linked or grouped, and the fold queries they own.",
            "properties": properties,
            "additionalProperties": {
                "type": "object",
                "required": [PATH],
                "properties": {PATH: {"type": "string"}},
                "x-settings": false,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::config::Config;

    #[test]
    fn defaults_can_follow_another_option() {
        let summarize = |toml: &str| {
            Config::from_toml(toml).unwrap().plugins.shape.entries["bundled.summarize"]
                .options
                .clone()
        };
        let openai = summarize("[plugins.shape.bundled.summarize]\nprovider = 'openai'\n");
        assert_eq!(openai["model"], "gpt-6-luna");
        assert_eq!(
            openai["provider_details"]["key_variables"],
            serde_json::json!(["OPENAI_API_KEY"])
        );
        assert_eq!(summarize("")["model"], "gemini-3.8-flash");
        let pinned =
            summarize("[plugins.shape.bundled.summarize]\nprovider = 'openai'\nmodel = 'o9'\n");
        assert_eq!(pinned["model"], "o9");
    }

    #[test]
    fn a_default_can_follow_a_default_that_follows_another() {
        // Declared so that `size` comes before the `kind` it follows, and
        // `kind` before the `mode` it follows.
        let manifest = super::Manifest::parse(
            "name = 'p'\ntitle = 'P'\n\
             [options.size]\ntitle = 'Size'\ntype = 'integer'\n\
             [options.size.\"x-default-by\"]\nkey = 'kind'\nvalues = { small = 1, large = 2 }\n\
             [options.kind]\ntitle = 'Kind'\nenum = ['small', 'large']\n\
             [options.kind.\"x-default-by\"]\nkey = 'mode'\nvalues = { a = 'small', b = 'large' }\n\
             [options.mode]\ntitle = 'Mode'\nenum = ['a', 'b']\ndefault = 'a'\n",
        )
        .unwrap();
        let mut options = serde_json::Map::new();
        manifest.fill_defaults(&mut options);
        assert_eq!(options["kind"], "small");
        assert_eq!(options["size"], 1);
        let mut options = serde_json::Map::from_iter([("mode".to_owned(), "b".into())]);
        manifest.fill_defaults(&mut options);
        assert_eq!(options["size"], 2);
        let cycle = super::Manifest::parse(
            "name = 'p'\ntitle = 'P'\n\
             [options.x]\ntitle = 'X'\nenum = ['a', 'b']\n\
             [options.x.\"x-default-by\"]\nkey = 'y'\nvalues = { a = 'a', b = 'b' }\n\
             [options.y]\ntitle = 'Y'\nenum = ['a', 'b']\n\
             [options.y.\"x-default-by\"]\nkey = 'x'\nvalues = { a = 'a', b = 'b' }\n",
        )
        .unwrap_err();
        assert!(cycle.contains("cycle"), "{cycle}");
        let reset = super::Manifest::parse(
            "name = 'p'\ntitle = 'P'\n[options.key]\ntitle = 'Key'\ntype = 'string'\n\"x-reset-by\" = 'missing'\n",
        )
        .unwrap_err();
        assert!(
            reset.contains("x-reset-by must name another option"),
            "{reset}"
        );
    }

    #[test]
    fn a_default_by_must_cover_every_choice_and_fit_the_option() {
        let manifest = |values: &str| {
            super::Manifest::parse(&format!(
                "name = 'p'\ntitle = 'P'\n[options.kind]\ntitle = 'Kind'\nenum = ['a', 'b']\ndefault = 'a'\n[options.size]\ntitle = 'Size'\ntype = 'integer'\n[options.size.\"x-default-by\"]\nkey = 'kind'\nvalues = {{ {values} }}\n"
            ))
        };
        assert!(manifest("a = 1, b = 2").is_ok());
        let missing = manifest("a = 1").unwrap_err();
        assert!(missing.contains("\"b\""), "{missing}");
        let mistyped = manifest("a = 1, b = 'big'").unwrap_err();
        assert!(mistyped.contains("kind = \"b\""), "{mistyped}");
    }

    use serde_json::Value;

    /// Every setting the schema lists, as a settings screen flattens it:
    /// `(dotted key, title, group, type)`. A key marked `"x-settings": false`
    /// is not a setting.
    fn settings(schema: &Value) -> Vec<(String, String, String, String)> {
        fn resolve<'a>(node: &'a Value, root: &'a Value) -> &'a Value {
            match node.get("$ref").and_then(Value::as_str) {
                Some(reference) => {
                    let name = reference.rsplit('/').next().unwrap();
                    &root["$defs"][name]
                }
                None => node,
            }
        }
        fn walk(
            node: &Value,
            root: &Value,
            key: &str,
            out: &mut Vec<(String, String, String, String)>,
        ) {
            let resolved = resolve(node, root);
            if node.get("x-settings") == Some(&Value::Bool(false)) {
                return;
            }
            if let Some(properties) = resolved.get("properties").and_then(Value::as_object) {
                for (name, child) in properties {
                    let key = if key.is_empty() {
                        name.clone()
                    } else {
                        format!("{key}.{name}")
                    };
                    walk(child, root, &key, out);
                }
                return;
            }
            let text = |field: &str| {
                node.get(field)
                    .or_else(|| resolved.get(field))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned()
            };
            let kind = resolved
                .get("type")
                .map(|kind| kind.to_string())
                .or_else(|| resolved.get("enum").map(|_| "enum".to_owned()))
                .or_else(|| resolved.get("anyOf").map(|_| "optional".to_owned()))
                .expect("a typed setting");
            out.push((key.to_owned(), text("title"), text("x-group"), kind));
        }
        let mut out = Vec::new();
        walk(schema, schema, "", &mut out);
        out
    }

    #[test]
    fn every_plugin_setting_has_a_title_and_a_group_and_is_a_scalar() {
        let schema = Config::schema();
        let settings = settings(&schema);
        assert!(!settings.is_empty());
        for (key, title, group, kind) in &settings {
            assert!(
                !title.is_empty() && !group.is_empty(),
                "{key} has no title or group"
            );
            assert!(
                !kind.contains("array") && !kind.contains("object"),
                "{key} is {kind}"
            );
        }
        assert!(schema["properties"].get("languages").is_none());
        let plugins = &schema["properties"]["plugins"]["properties"]["shape"]["properties"];
        assert_eq!(plugins["order"]["x-settings"], false);
        assert_eq!(plugins["order"]["type"], "array");
        let summarize = &plugins["bundled"]["properties"]["summarize"]["properties"];
        // A text setting, so settings screens let users edit the prompt.
        assert!(summarize["system_prompt"].get("x-settings").is_none());
    }

    #[test]
    fn explicit_order_is_authoritative_and_names_every_entry_once() {
        let config = Config::from_toml("[plugins.shape]\norder = ['bundled.context']\n").unwrap();
        assert_eq!(config.plugins.shape.entries.len(), 1);
        for (text, message) in [
            (
                "[plugins.shape]\norder = ['bundled.context', 'bundled.context']",
                "listed twice",
            ),
            ("[plugins.shape]\norder = ['mine']", "no plugin entry"),
            (
                "[plugins.shape]\norder = []\n[plugins.shape.bundled.context]",
                "is not listed",
            ),
            ("[plugins.shape.mine]", "custom plugins require path"),
            ("[plugins.shape.bundled.unknown]", "unknown bundled plugin"),
            (
                "[plugins.shape.bundled.context]\npath = 'context'",
                "plugins.shape.bundled.context:",
            ),
            ("[plugins.context]", "unknown field"),
        ] {
            let error = Config::from_toml(text).err().unwrap().to_string();
            assert!(error.contains(message), "{error}");
        }
    }

    #[test]
    fn a_path_entry_loads_its_folder_relative_to_the_config_directory() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("plugins/mine");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(
            folder.join("plugin.toml"),
            "name = 'mine'\ntitle = 'Mine'\n[options.depth]\ntype = 'integer'\ntitle = 'Depth'\ndefault = 2\n",
        )
        .unwrap();
        let order = "order = ['bundled.context', 'bundled.deleted-bodies', 'bundled.test-bodies', 'bundled.removed-runs', 'bundled.summarize', 'mine']";
        let config = Config::from_toml_in(
            &format!("[plugins.shape]\n{order}\n[plugins.shape.mine]\npath = 'plugins/mine'\n"),
            dir.path(),
        )
        .unwrap();
        let entry = &config.plugins.shape.entries["mine"];
        assert_eq!(entry.options["depth"], 2);
        assert!(entry.options.get("path").is_none());

        let error = |toml: &str| {
            Config::from_toml_in(toml, dir.path())
                .err()
                .unwrap()
                .to_string()
        };
        let renamed = error(&format!(
            "[plugins.shape]\n{}\n[plugins.shape.other]\npath = 'plugins/mine'\n",
            order.replace("'mine'", "'other'")
        ));
        assert!(
            renamed.starts_with("plugins.shape.other: ")
                && renamed.ends_with("the plugin is named \"mine\", not \"other\""),
            "{renamed}"
        );
        let missing = error("[plugins.shape.context]\npath = 'plugins/absent'\n");
        assert!(missing.starts_with("plugins.shape.context: "), "{missing}");
        std::fs::write(
            folder.join("plugin.toml"),
            "name = 'mine'\ntitle = 'Mine'\n[options.path]\ntype = 'string'\ntitle = 'Path'\n",
        )
        .unwrap();
        let reserved = error(&format!(
            "[plugins.shape]\n{order}\n[plugins.shape.mine]\npath = 'plugins/mine'\n"
        ));
        assert!(reserved.contains("which diffr owns"), "{reserved}");
    }

    #[test]
    fn custom_and_bundled_entries_keep_separate_options_and_one_identity() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("plugin.toml"),
            "name = 'context'\ntitle = 'Custom context'\n[options.depth]\ntype = 'integer'\ntitle = 'Depth'\ndefault = 7\n").unwrap();
        let text = "[plugins.shape]\norder = ['bundled.context', 'context']\n[plugins.shape.bundled.context]\nenabled = false\n[plugins.shape.context]\npath = '.'\n";
        let config = Config::from_toml_in(text, dir.path()).unwrap();
        assert_eq!(config.plugins.shape.entries["context"].options["depth"], 7);
        assert!(!config.plugins.shape.entries["context"]
            .options
            .contains_key("lines"));
        assert_eq!(
            config.plugins.shape.entries["bundled.context"].options["lines"],
            3
        );
        assert_eq!(config.plugins.shape.queries().unwrap()[0].0, "context");
        let error = Config::from_toml_in(
            &text.replace("enabled = false", "enabled = true"),
            dir.path(),
        )
        .unwrap_err();
        assert!(error.to_string().contains("enabled more than once"));
    }

    #[test]
    fn custom_names_with_dots_keep_their_identity_through_a_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("plugin.toml"),
            "name = 'my.context'\ntitle = 'Custom'\n",
        )
        .unwrap();
        let config = Config::from_toml_in(
            "[plugins.shape]\norder = ['my.context']\n[plugins.shape.\"my.context\"]\npath = '.'\n",
            dir.path(),
        )
        .unwrap();
        assert_eq!(config.plugins.shape.queries().unwrap()[0].0, "my.context");
        let text = toml::to_string(&config).unwrap();
        let config = Config::from_toml_in(&text, dir.path()).unwrap();
        assert_eq!(
            config.plugins.shape.enabled().next().unwrap().0,
            "my.context"
        );
        assert_eq!(config.plugins.shape.queries().unwrap()[0].0, "my.context");
    }

    #[test]
    fn stock_selection_cannot_load_custom_folders() {
        for text in [
            "[plugins.shape.bundled.context]\npath = '.'",
            "[plugins.classify.bundled]\npath = '.'",
        ] {
            assert!(Config::from_toml(text)
                .unwrap_err()
                .to_string()
                .contains("cannot set path"));
        }
        let validator = jsonschema::validator_for(&Config::schema()).unwrap();
        assert!(validator.is_valid(&serde_json::to_value(Config::default()).unwrap()));
        for text in [
            "[plugins.shape.custom]\npath = '.'",
            "[plugins.classify.custom]\npath = '.'",
        ] {
            let parsed: toml::Value = toml::from_str(text).unwrap();
            assert!(validator.is_valid(&serde_json::to_value(parsed).unwrap()));
        }
        for text in [
            "[plugins.shape.bundled.context]\npath = '.'",
            "[plugins.classify.bundled]\npath = '.'",
            "[plugins.shape.custom]",
            "[plugins.classify.custom]",
        ] {
            let parsed: toml::Value = toml::from_str(text).unwrap();
            assert!(!validator.is_valid(&serde_json::to_value(parsed).unwrap()));
        }
        assert!(
            Config::from_toml("[plugins.shape.\"bundled.context\"]\npath = '.'")
                .unwrap_err()
                .to_string()
                .contains("reserved plugin reference")
        );
    }

    #[test]
    fn exactly_one_classifier_runs() {
        for text in [
            "[plugins.classify]",
            "[plugins.classify.bundled]\n[plugins.classify.other]",
        ] {
            let error = Config::from_toml(text).unwrap_err().to_string();
            assert!(error.contains("expected exactly one classifier"), "{error}");
        }
    }

    #[test]
    fn options_are_checked_against_the_plugin_toml_and_filled_with_its_defaults() {
        let config = Config::from_toml(
            "[plugins.shape.bundled.deleted-bodies]\nmin_lines = 30\n[plugins.shape.bundled.removed-runs]\nenabled = false\n[plugins.classify.bundled]\nhide_deleted = false\n",
        )
        .unwrap();
        let deleted = &config.plugins.shape.entries["bundled.deleted-bodies"];
        assert_eq!(deleted.enabled, Some(true));
        assert_eq!(deleted.options["min_lines"], 30);
        let removed = &config.plugins.shape.entries["bundled.removed-runs"];
        assert_eq!(removed.enabled, Some(false));
        let classifier = &config.plugins.classify.options;
        assert_eq!(classifier["hide_deleted"], false);
        assert_eq!(
            classifier["hide"],
            serde_json::json!(["generated", "vendored"])
        );
        let summarize = &config.plugins.shape.entries["bundled.summarize"];
        assert_eq!(
            summarize.enabled,
            Some(false),
            "the summarizer needs a key, so it is off unless turned on"
        );
        assert!(summarize.options.get("api_key").is_none());
        assert_eq!(summarize.options["request_timeout_ms"], 60_000);
        let error = |toml: &str| Config::from_toml(toml).err().unwrap().to_string();
        let typo = error("[plugins.shape.bundled.deleted-bodies]\ntypo = 1\n");
        assert!(
            typo.starts_with("plugins.shape.bundled.deleted-bodies: ") && typo.contains("typo"),
            "{typo}"
        );
        let mistyped = error("[plugins.shape.bundled.deleted-bodies]\nmin_lines = 'many'\n");
        assert!(
            mistyped.starts_with("plugins.shape.bundled.deleted-bodies: min_lines: "),
            "{mistyped}"
        );
        let zero = error("[plugins.shape.bundled.summarize]\nrequest_timeout_ms = 0\n");
        assert!(
            zero.starts_with("plugins.shape.bundled.summarize: request_timeout_ms: "),
            "{zero}"
        );
        assert!(
            error("[plugins.shape.bundled.summarize]\nprovider = 'mistral'\n")
                .starts_with("plugins.shape.bundled.summarize: provider: ")
        );
    }
}

#[cfg(test)]
mod concurrency_tests {
    use crate::config::Config;

    #[test]
    fn obsolete_instance_and_concurrency_options_are_rejected() {
        for name in ["context", "summarize"] {
            assert!(
                Config::from_toml(&format!("[plugins.shape.bundled.{name}]\ninstances = 1\n"))
                    .is_err()
            );
        }
        assert!(
            Config::from_toml("[plugins.shape.bundled.summarize]\nmax_concurrency = 16\n").is_err()
        );
    }
}
