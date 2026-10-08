//! Assemble the query files plugins declare into one query per language.
//! Imports precede their importers and shared sources are included once. Sources
//! plugins declare take precedence over bundled or absolute-path imports.
use super::builtin;
use crate::config::query::QuerySource;
use crate::config::ConfigError;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// One language's query file a plugin declares: its text, and the name
/// imports and diagnostics know it by (`builtin:<plugin>/queries/rust.scm`,
/// or the file's path).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluginQuery {
    pub(crate) language: String,
    pub(crate) name: String,
    pub(crate) text: String,
}

/// The query files one plugin declares.
pub(crate) type Queries = Vec<PluginQuery>;

const BUILTIN_PREFIX: &str = "builtin:";

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Location {
    /// A normalized path under `builtin:`.
    Builtin(String),
    /// An absolute filesystem path, canonicalized when it exists.
    File(PathBuf),
    /// A logical source name supplied by plugin code.
    Named(String),
}

impl Location {
    fn name(&self) -> String {
        match self {
            Self::Builtin(path) => format!("{BUILTIN_PREFIX}{path}"),
            Self::File(path) => path.display().to_string(),
            Self::Named(name) => name.clone(),
        }
    }

    fn builtin(path: &str) -> Result<Self, ConfigError> {
        let mut segments: Vec<&str> = Vec::new();
        for segment in path.split('/') {
            match segment {
                "" | "." => {}
                ".." => {
                    if segments.pop().is_none() {
                        return Err(ConfigError(format!(
                            "{BUILTIN_PREFIX}{path} leaves the bundled plugins"
                        )));
                    }
                }
                segment => segments.push(segment),
            }
        }
        let normalized = segments.join("/");
        Ok(Self::Builtin(normalized))
    }

    fn source(name: &str) -> Result<Self, ConfigError> {
        if let Some(path) = name.strip_prefix(BUILTIN_PREFIX) {
            Self::builtin(path)
        } else if Path::new(name).is_absolute() {
            Ok(Self::File(
                std::fs::canonicalize(name).unwrap_or_else(|_| PathBuf::from(name)),
            ))
        } else {
            let mut parts = Vec::new();
            for part in name.split('/') {
                match part {
                    "" | "." => {}
                    ".." => {
                        if parts.pop().is_none() {
                            return Err(ConfigError(format!(
                                "query source {name} leaves its namespace"
                            )));
                        }
                    }
                    part => parts.push(part),
                }
            }
            Ok(Self::Named(parts.join("/")))
        }
    }

    /// Where `path`, written inside this file, points.
    fn resolve(&self, path: &str) -> Result<Self, ConfigError> {
        if let Some(builtin) = path.strip_prefix(BUILTIN_PREFIX) {
            return Self::builtin(builtin);
        }
        if Path::new(path).is_absolute() {
            return Self::source(path);
        }
        match self {
            Self::Named(own) => {
                let dir = own.rsplit_once('/').map_or("", |(dir, _)| dir);
                Self::source(format!("{dir}/{path}").trim_start_matches('/'))
            }
            Self::Builtin(own) => {
                let dir = own.rsplit_once('/').map_or("", |(dir, _)| dir);
                Self::builtin(&format!("{dir}/{path}"))
            }
            Self::File(own) => Self::source(
                &own.parent()
                    .expect("a canonical file path has a parent")
                    .join(path)
                    .display()
                    .to_string(),
            ),
        }
    }

    fn read(&self) -> Result<String, ConfigError> {
        match self {
            Self::Builtin(path) => builtin::file(path)
                .map(str::to_owned)
                .ok_or_else(|| ConfigError(format!("no bundled file builtin:{path}"))),
            Self::Named(name) => Err(ConfigError(format!(
                "no query source {name}; return it from queries()"
            ))),
            Self::File(path) => std::fs::read_to_string(path)
                .map_err(|error| ConfigError(format!("{}: {error}", path.display()))),
        }
    }
}

/// The paths a query file's first line imports.
fn imports(text: &str) -> Vec<&str> {
    text.lines()
        .next()
        .and_then(|line| line.trim().strip_prefix(";"))
        .and_then(|rest| rest.trim_start().strip_prefix("inherits:"))
        .map(|paths| {
            paths
                .split(',')
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Everything one language's query is assembled from so far.
#[derive(Default)]
struct Assembly {
    sources: Vec<QuerySource>,
    included: BTreeSet<Location>,
    supplied: BTreeMap<Location, String>,
}

impl Assembly {
    fn include(
        &mut self,
        location: Location,
        stack: &mut Vec<Location>,
    ) -> Result<(), ConfigError> {
        if let Some(start) = stack.iter().position(|open| *open == location) {
            let cycle: Vec<String> = stack[start..]
                .iter()
                .chain([&location])
                .map(Location::name)
                .collect();
            return Err(ConfigError(format!(
                "query imports form a cycle: {}",
                cycle.join(" -> ")
            )));
        }
        if self.included.contains(&location) {
            return Ok(());
        }
        let text = match self.supplied.get(&location) {
            Some(text) => text.clone(),
            None => location.read()?,
        };
        stack.push(location.clone());
        for import in imports(&text) {
            let imported = location
                .resolve(import)
                .map_err(|error| ConfigError(format!("{}: {error}", location.name())))?;
            self.include(imported, stack)?;
        }
        stack.pop();
        self.sources.push(QuerySource {
            name: location.name(),
            text,
        });
        self.included.insert(location);
        Ok(())
    }
}

/// Assemble in plugin order, with imports before their first importer.
pub(crate) fn assemble(
    plugins: &[(String, Queries)],
) -> Result<BTreeMap<String, Vec<QuerySource>>, ConfigError> {
    let mut languages: BTreeMap<String, Assembly> = BTreeMap::new();
    // Register all sources first: an importer may precede its dependency.
    for (plugin, queries) in plugins {
        for source in queries {
            let location = Location::source(&source.name).map_err(|error| {
                ConfigError(format!(
                    "plugin {plugin}: queries.{}: {error}",
                    source.language
                ))
            })?;
            let assembly = languages.entry(source.language.clone()).or_default();
            if let Some(previous) = assembly.supplied.insert(location, source.text.clone()) {
                if previous != source.text {
                    return Err(ConfigError(format!(
                        "plugin {plugin}: queries.{}: conflicting text for source {}",
                        source.language, source.name
                    )));
                }
            }
        }
    }
    for (plugin, queries) in plugins {
        for source in queries {
            let key = format!("plugin {plugin}: queries.{}", source.language);
            let location = Location::source(&source.name).map_err(|error| {
                ConfigError(format!(
                    "plugin {plugin}: queries.{}: {error}",
                    source.language
                ))
            })?;
            languages
                .get_mut(&source.language)
                .expect("registered language")
                .include(location, &mut Vec::new())
                .map_err(|error| ConfigError(format!("{key}: {error}")))?;
        }
    }
    Ok(languages
        .into_iter()
        .map(|(language, assembly)| (language, assembly.sources))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::parse::guess_language::Language;
    use strum::IntoEnumIterator;

    fn source(name: &str, text: &str) -> PluginQuery {
        PluginQuery {
            language: "rust".into(),
            name: name.into(),
            text: text.into(),
        }
    }

    #[test]
    fn every_bundled_query_resolves_and_compiles() {
        let config = Config::default();
        let assembled = assemble(&config.plugins.shape.queries().unwrap()).unwrap();
        for language in Language::iter() {
            let key = format!("{language:?}").to_lowercase();
            assert!(
                assembled.contains_key(&key),
                "missing bundled query for {language:?}"
            );
        }
        let params = config.compile().unwrap();
        for language in Language::iter() {
            params.language(language).unwrap();
        }
    }

    #[test]
    fn disabled_plugins_contribute_no_queries() {
        let config =
            Config::from_toml("[plugins.shape.bundled.deleted-bodies]\nenabled = false\n").unwrap();
        let assembled = assemble(&config.plugins.shape.queries().unwrap()).unwrap();
        assert!(!assembled["rust"]
            .iter()
            .any(|s| s.name.contains("deleted-bodies")));
    }

    #[test]
    fn returned_sources_resolve_relative_imports_and_deduplicate() {
        let plugins = vec![(
            "mine".into(),
            vec![
                source(
                    "queries/rust/mine.scm",
                    "; inherits: ../shared.scm, builtin:core/queries/rust/folds.scm\n(block) @fold",
                ),
                source("queries/shared.scm", "(block) @fold"),
                source("queries/shared.scm", "(block) @fold"),
            ],
        )];
        let assembled = assemble(&plugins).unwrap();
        assert_eq!(
            assembled["rust"]
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>(),
            [
                "queries/shared.scm",
                "builtin:core/queries/rust/folds.scm",
                "queries/rust/mine.scm"
            ]
        );
    }

    #[test]
    fn absolute_imports_resolve_against_the_source() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("shared.scm"), "(block) @fold").unwrap();
        let root = dir.path().join("root.scm").display().to_string();
        let assembled =
            assemble(&[("mine".into(), vec![source(&root, "; inherits: shared.scm")])]).unwrap();
        assert_eq!(assembled["rust"].len(), 2);
        assert_eq!(assembled["rust"][0].text, "(block) @fold");
    }

    #[test]
    fn cycles_missing_imports_and_conflicting_names_are_errors() {
        for (sources, message) in [
            (
                vec![source("a", "; inherits: b"), source("b", "; inherits: a")],
                "cycle",
            ),
            (
                vec![source("a", "; inherits: absent")],
                "no query source absent",
            ),
            (
                vec![source("a", "; inherits: builtin:shared/absent")],
                "no bundled file",
            ),
            (
                vec![source("a", "; inherits: builtin:../../outside")],
                "leaves the bundled plugins",
            ),
            (
                vec![source("a", "one"), source("a", "two")],
                "conflicting text",
            ),
        ] {
            let error = assemble(&[("mine".into(), sources)])
                .err()
                .unwrap()
                .to_string();
            assert!(error.contains(message), "{error}");
            assert!(error.contains("plugin mine: queries.rust"), "{error}");
        }
    }
}
