//! diffr's configuration comes from three places: the global file
//! (`$XDG_CONFIG_HOME/diffr/config.toml`),
//! command-line flags, and git attributes. This module owns the file: every
//! key it omits keeps its serde default, and an unknown key or mistyped
//! value is an error naming the key's dotted path. Flags and attributes are
//! applied by their callers. Every field carries a doc comment, which becomes
//! its description in `diffr config schema`, and every scalar setting a
//! `title` and an `x-group` that settings screens show in place of the
//! dotted key. Lists are in the schema marked `"x-settings": false`: a
//! settings screen edits scalars and leaves those to the file and `diffr
//! config set`. The `plugins.shape` part of the schema comes from each plugin's
//! `plugin.toml`, with lists and tables marked the same way. `config set`
//! keeps only what differs from the defaults (see [`prune`]).
//!
//! `[plugins.shape]` configures the plugins that shape regions after diffing (see
//! [`crate::plugin`]). Compiling assembles, per language, one query from the
//! query files of every enabled plugin (see [`crate::plugin::queries`]): its
//! `@fold` captures decide which folds exist, and its tags what they are.
//! Every tag a query sets must be written `<plugin>:<name>`.
pub mod migrate;
pub(crate) mod prune;
pub(crate) mod query;
pub mod store;
use crate::hash::DftHashMap;
use crate::options::DiffOptions;
use crate::parse::{guess_language::Language, tree_sitter_parser};
use crate::plugin::config::PluginsConfig;
use crate::plugin::queries::{self, Queries};
use query::{AnnotationQuery, QuerySource};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use strum::IntoEnumIterator;

pub(crate) const DEFAULT_CONFIG: &str = include_str!("config/default.toml");
const CONFIG_VERSION: u32 = 2;
fn config_version() -> u32 {
    CONFIG_VERSION
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// Configuration format version.
    #[serde(default = "config_version")]
    #[schemars(extend("x-settings" = false, "const" = CONFIG_VERSION))]
    pub(crate) version: u32,
    /// The shape and classifier plugins, with settings from their manifests.
    #[schemars(skip)]
    #[serde(default)]
    pub plugins: PluginsConfig,
    /// Colors for the terminal frontend.
    #[serde(default)]
    pub(crate) theme: ThemeConfig,
    /// Limits on the structural comparison itself.
    #[serde(default)]
    pub diff: DiffConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self::from_toml_in(DEFAULT_CONFIG, Path::new(""))
            .expect("the embedded default config is valid")
    }
}

/// When a file exceeds one of these, diffr falls back to a line diff for
/// it: the alignment is line-based and `stats.fallback` carries the
/// reason; folds still come from the parse where it succeeded. The matching
/// command-line flags override these for one run.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct DiffConfig {
    /// Files larger than this many bytes on either side get a line diff.
    #[schemars(title = "Largest file to diff structurally (bytes)", extend("x-group" = "Diff limits"))]
    pub byte_limit: usize,
    /// The largest AST matching graph diffr will explore for one file.
    /// A large change to a large file can exceed it; raising it costs time
    /// and memory on those files only.
    #[schemars(title = "Largest matching graph", extend("x-group" = "Diff limits"))]
    pub graph_limit: usize,
    /// Files with more tree-sitter parse errors than this get a line diff.
    #[schemars(title = "Parse errors allowed", extend("x-group" = "Diff limits"))]
    pub parse_error_limit: usize,
}

impl Default for DiffConfig {
    fn default() -> Self {
        Self {
            byte_limit: crate::options::DEFAULT_BYTE_LIMIT,
            graph_limit: crate::options::DEFAULT_GRAPH_LIMIT,
            parse_error_limit: crate::options::DEFAULT_PARSE_ERROR_LIMIT,
        }
    }
}

impl DiffConfig {
    /// The engine options for these limits.
    pub fn options(&self, ignore_comments: bool) -> DiffOptions {
        DiffOptions {
            byte_limit: self.byte_limit,
            graph_limit: self.graph_limit,
            parse_error_limit: self.parse_error_limit,
            ignore_comments,
            ..DiffOptions::default()
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct ThemeConfig {
    /// A bundled theme name.
    #[schemars(title = "Theme", extend("x-group" = "Appearance"))]
    pub(crate) name: String,
    /// A Helix-style theme file that replaces the bundled theme.
    #[schemars(title = "Theme file", extend("x-group" = "Appearance"))]
    pub(crate) path: Option<PathBuf>,
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self {
            name: "default-dark".to_owned(),
            path: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConfigError(pub(crate) String);
impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ConfigError {}

pub struct Params {
    languages: DftHashMap<Language, OnceLock<Result<Arc<LanguageParams>, ConfigError>>>,
    sources: DftHashMap<Language, Vec<QuerySource>>,
    plugin_order: Vec<String>,
    pub diff: DiffConfig,
}

pub struct LanguageParams {
    pub parser: &'static tree_sitter_parser::TreeSitterConfig,
    /// The fold and context queries of every enabled plugin, concatenated.
    pub(crate) query: AnnotationQuery,
    sub_languages: OnceLock<
        Result<
            Vec<(
                &'static tree_sitter_parser::TreeSitterSubLanguage,
                Arc<LanguageParams>,
            )>,
            ConfigError,
        >,
    >,
}

impl LanguageParams {
    pub(crate) fn sub_languages(
        &self,
    ) -> &[(
        &'static tree_sitter_parser::TreeSitterSubLanguage,
        Arc<LanguageParams>,
    )] {
        self.sub_languages
            .get()
            .expect("resolved sub-languages")
            .as_ref()
            .expect("valid sub-languages")
    }
}

/// The user's global file: `$XDG_CONFIG_HOME/diffr/config.toml`, falling
/// back to `~/.config/diffr/config.toml`.
pub fn global_path() -> Result<PathBuf, ConfigError> {
    let dir = match std::env::var_os("XDG_CONFIG_HOME") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => dirs::home_dir()
            .ok_or_else(|| ConfigError("no home directory for this user".into()))?
            .join(".config"),
    };
    Ok(dir.join("diffr").join("config.toml"))
}

/// The directory a configuration file's relative paths resolve against.
pub(crate) fn directory_of(file: &Path) -> &Path {
    file.parent().unwrap_or(Path::new(""))
}

impl Config {
    /// Read the global file; a missing one is the defaults.
    pub fn load() -> Result<Self, ConfigError> {
        Self::load_from(&global_path()?)
    }

    /// The file at `path`; a missing file is the defaults.
    fn load_from(path: &Path) -> Result<Self, ConfigError> {
        let source = match std::fs::read_to_string(path) {
            Ok(source) => source,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(error) => return Err(ConfigError(format!("{}: {error}", path.display()))),
        };
        Self::from_toml_in(&source, directory_of(path))
            .map_err(|error| ConfigError(format!("{}: {error}", path.display())))
    }

    /// Parse text that is not a file's: a plugin folder's `path` is relative
    /// to the current directory.
    #[cfg(any(test, feature = "test-support"))]
    pub fn from_toml(source: &str) -> Result<Self, ConfigError> {
        Self::from_toml_in(source, Path::new(""))
    }

    /// Parse the text of a file in `directory`. Errors lead with the dotted
    /// path of the key they concern, such as `diff.typo`.
    pub fn from_toml_in(source: &str, directory: &Path) -> Result<Self, ConfigError> {
        #[derive(Deserialize)]
        struct Version {
            #[serde(default = "config_version")]
            version: u32,
        }
        let version: Version =
            toml::from_str(source).map_err(|error| ConfigError(error.to_string()))?;
        if version.version != CONFIG_VERSION {
            return Err(ConfigError(format!(
                "unsupported config version {}; expected {CONFIG_VERSION}",
                version.version
            )));
        }
        let mut config: Self = serde_path_to_error::deserialize(toml::Deserializer::new(source))
            .map_err(|error| {
                let path = error.path().to_string();
                let message = error.inner().message().to_owned();
                ConfigError(match path.as_str() {
                    "." => message,
                    _ => format!("{path}: {message}"),
                })
            })?;
        config.plugins.shape.resolve(directory)?;
        config.plugins.classify.resolve(directory)?;
        Ok(config)
    }

    /// The JSON Schema of the configuration, with a description and default
    /// on every setting. `plugins` comes first, built from each bundled
    /// plugin's `plugin.toml`.
    pub fn schema() -> serde_json::Value {
        let mut schema =
            serde_json::to_value(schemars::schema_for!(Config)).expect("schema serializes");
        let rest = std::mem::take(
            schema["properties"]
                .as_object_mut()
                .expect("the schema has properties"),
        );
        let properties = schema["properties"]
            .as_object_mut()
            .expect("the schema has properties");
        properties.insert("plugins".to_owned(), PluginsConfig::schema());
        properties.extend(rest);
        schema
    }

    /// Compile the query files the enabled plugins' manifests declare. No
    /// plugin runs to supply them.
    pub fn compile(&self) -> Result<Params, ConfigError> {
        self.compile_queries(self.plugins.shape.queries()?)
    }

    /// Compile with `queries`, the enabled plugins' query files in
    /// `plugins.shape.order`.
    pub fn compile_queries(&self, queries: Vec<(String, Queries)>) -> Result<Params, ConfigError> {
        let params = self.prepare_queries(queries)?;
        for &language in params.sources.keys() {
            params.compiled_language(language)?;
        }
        Ok(params)
    }

    /// Assemble query sources now, compiling each language on first use. Hosts
    /// using this path report query errors with the file that needs them.
    pub fn prepare(&self) -> Result<Params, ConfigError> {
        self.prepare_queries(self.plugins.shape.queries()?)
    }

    fn prepare_queries(&self, queries: Vec<(String, Queries)>) -> Result<Params, ConfigError> {
        let languages: DftHashMap<_, _> = Language::iter()
            .map(|language| (language, OnceLock::new()))
            .collect();
        let mut by_language = DftHashMap::default();
        for (name, sources) in queries::assemble(&queries)? {
            let language = Language::iter()
                .find(|language| format!("{language:?}").to_lowercase() == name)
                .ok_or_else(|| ConfigError(format!("unknown language: {name}")))?;
            by_language.insert(language, sources);
        }
        Ok(Params {
            languages,
            sources: by_language,
            plugin_order: self.plugins.shape.order.clone(),
            diff: self.diff,
        })
    }
}

/// Every tag names a bundled or configured plugin. Shared queries may tag
/// bundled consumers that this configuration has omitted or disabled.
fn check_tags(query: &AnnotationQuery, order: &[String]) -> Result<(), ConfigError> {
    for pattern in &query.patterns {
        for tag in &pattern.tags {
            let owned = tag.split_once(':').is_some_and(|(plugin, name)| {
                !name.is_empty()
                    && (crate::plugin::builtin::manifest(plugin).is_some()
                        || order.iter().any(|own| own == plugin))
            });
            if !owned {
                return Err(ConfigError(format!(
                    "{}: tag {tag:?} must be written <plugin>:<name> with a bundled or configured plugin",
                    query.sources[pattern.source]
                )));
            }
        }
    }
    Ok(())
}

impl Params {
    fn compiled_language(&self, language: Language) -> Result<&Arc<LanguageParams>, ConfigError> {
        self.languages[&language]
            .get_or_init(|| {
                // Languages without annotation rules still support structural diffing.
                // Keep their grammars lazy, as in the existing parser registry.
                let parser = tree_sitter_parser::from_language(language);
                let sources = self
                    .sources
                    .get(&language)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                let query = AnnotationQuery::compile(&parser.language, sources)?;
                check_tags(&query, &self.plugin_order)?;
                Ok(Arc::new(LanguageParams {
                    parser,
                    query,
                    sub_languages: OnceLock::new(),
                }))
            })
            .as_ref()
            .map_err(Clone::clone)
    }

    /// Resolve this language and its embedded languages once. Prepared configs
    /// can report query errors here; both successes and failures are cached.
    pub fn language(&self, language: Language) -> Result<&Arc<LanguageParams>, ConfigError> {
        let config = self.compiled_language(language)?;
        config
            .sub_languages
            .get_or_init(|| {
                config
                    .parser
                    .sub_languages
                    .iter()
                    .map(|sub| {
                        self.language(sub.parse_as)
                            .map(|params| (sub, Arc::clone(params)))
                    })
                    .collect()
            })
            .as_ref()
            .map_err(Clone::clone)?;
        Ok(config)
    }
}

#[cfg(any(test, feature = "test-support"))]
impl Default for Params {
    fn default() -> Self {
        Config::default()
            .compile()
            .expect("invalid bundled annotation configuration")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summary::DiffResult;

    #[test]
    fn prepared_queries_fail_only_when_their_language_is_used() {
        let queries = vec![(
            "removed-runs".to_owned(),
            vec![crate::plugin::queries::PluginQuery {
                language: "rust".into(),
                name: "broken-rust.scm".into(),
                text: "(not_a_rust_node) @fold".into(),
            }],
        )];
        let config = Config::default();
        assert!(config.compile_queries(queries.clone()).is_err());
        let params = config.prepare_queries(queries).unwrap();
        assert!(
            DiffResult::try_from_sources_with_params("a.py", "x = 1", "x = 2", &params).is_ok()
        );
        for _ in 0..2 {
            let error =
                DiffResult::try_from_sources_with_params("a.rs", "fn a() {}", "fn b() {}", &params)
                    .unwrap_err();
            assert!(error.to_string().contains("broken-rust.scm"));
        }
    }

    #[test]
    fn diff_limits_default_and_layer_from_the_file() {
        let defaults = Config::default().diff;
        assert_eq!(defaults.graph_limit, crate::options::DEFAULT_GRAPH_LIMIT);
        assert_eq!(defaults.byte_limit, crate::options::DEFAULT_BYTE_LIMIT);
        let custom = Config::from_toml("[diff]\ngraph_limit = 5").unwrap();
        assert_eq!(custom.diff.graph_limit, 5);
        assert_eq!(custom.diff.byte_limit, defaults.byte_limit);
        let options = custom.diff.options(true);
        assert_eq!(options.graph_limit, 5);
        assert!(options.ignore_comments);
        let compiled = custom.compile().unwrap();
        assert_eq!(compiled.diff.graph_limit, 5);
        let schema = Config::schema();
        assert!(
            schema["$defs"]["DiffConfig"]["properties"]["graph_limit"]["description"]
                .as_str()
                .is_some_and(|text| !text.is_empty())
        );
    }

    #[test]
    fn language_without_annotation_rules_keeps_structural_diffing() {
        let params = with_queries(&[]);
        let result = DiffResult::from_sources_with_params(
            "a.c",
            "int run() { return 1; }",
            "int run() { return 2; }",
            &params,
        );
        assert!(matches!(
            result.file_format,
            crate::summary::FileFormat::SupportedLanguage(Language::C)
        ));
        assert!(result
            .rhs_positions
            .iter()
            .any(|position| position.kind.is_novel()));
        assert!(result.rhs_folds.is_empty());
    }

    #[test]
    fn shared_grammars_keep_language_configuration_independent() {
        let params = with_queries(&[
            (
                "javascript",
                r#"((statement_block) @fold (#set! tag "removed-runs:plain-js"))"#,
            ),
            (
                "javascriptjsx",
                r#"((statement_block) @fold (#set! tag "removed-runs:jsx"))"#,
            ),
        ]);
        for (path, tag) in [
            ("file.js", "removed-runs:plain-js"),
            ("file.jsx", "removed-runs:jsx"),
        ] {
            let result = DiffResult::from_sources_with_params(
                path,
                "",
                "function run() { work(); }",
                &params,
            );
            assert_eq!(result.rhs_folds.len(), 1);
            assert_eq!(result.rhs_folds[0].tags, [tag]);
        }
    }

    #[test]
    fn embedded_languages_use_the_configured_queries() {
        let params = with_queries(&[(
            "javascript",
            r#"((statement_block) @fold (#set! tag "removed-runs:embedded"))"#,
        )]);
        let result = DiffResult::from_sources_with_params(
            "page.html",
            "",
            "<script>function run() { work(); }</script>",
            &params,
        );
        assert_eq!(result.rhs_folds.len(), 1);
        assert_eq!(result.rhs_folds[0].tags, ["removed-runs:embedded"]);
    }

    #[test]
    fn rejects_unknown_settings_languages_and_invalid_queries() {
        assert!(Config::from_toml("typo = true").is_err());
        assert!(Config::from_toml("[languages.rust]\ncontext = '(block) @context'").is_err());
        let error = Config::default()
            .compile_queries(vec![(
                "removed-runs".to_owned(),
                vec![crate::plugin::queries::PluginQuery {
                    language: "klingon".into(),
                    name: "unknown.scm".into(),
                    text: "".into(),
                }],
            )])
            .err()
            .expect("an unknown language")
            .to_string();
        assert!(error.contains("unknown language: klingon"), "{error}");
        for (query, message) in [
            ("(not_a_rust_node) @fold", "NodeType error"),
            ("(block) @typo", "unsupported capture @typo"),
            (
                r#"(block "{" @fold.open "}" @fold.close) @fold"#,
                "@fold.open needs exactly one @fold.indent",
            ),
            (
                r#"[(block "{" @fold.open . (_) @fold.indent "}" @fold.close) (match_block)] @fold"#,
                "@fold.open must be in every branch",
            ),
            (
                r#"((block) @fold (#set! tag "body"))"#,
                "must be written <plugin>:<name>",
            ),
            (
                r#"((block) @fold (#set! tag "nobody:body"))"#,
                "must be written <plugin>:<name>",
            ),
        ] {
            let error = try_with_queries(&[("rust", query)])
                .err()
                .expect(query)
                .to_string();
            assert!(error.contains("removed-runs.scm"), "{error}");
            assert!(error.contains(message), "{error}");
        }
    }
}

/// Params whose only fold query per listed language is the given text,
/// returned as source text the removed-runs plugin owns; no other plugin
/// contributes queries.
#[cfg(test)]
pub(crate) fn try_with_queries(queries: &[(&str, &str)]) -> Result<Params, ConfigError> {
    let files = queries
        .iter()
        .map(|(language, text)| crate::plugin::queries::PluginQuery {
            language: (*language).into(),
            name: format!("{language}-removed-runs.scm"),
            text: (*text).into(),
        })
        .collect();
    Config::default().compile_queries(vec![("removed-runs".to_owned(), files)])
}

#[cfg(test)]
fn with_queries(queries: &[(&str, &str)]) -> Params {
    try_with_queries(queries).expect("the test queries compile")
}

/// Params with the folds of every bundled plugin's queries but `context`'s,
/// the summarizer's included: the bodies, collections and docstrings the
/// engine's tests are written against, without the scopes `context` lays
/// over them.
#[cfg(test)]
pub(crate) fn body_params() -> Params {
    Config::from_toml(
        "[plugins.shape.bundled.context]\nenabled = false\n[plugins.shape.bundled.summarize]\nenabled = true\napi_key = 'test'\n",
    )
    .expect("a valid configuration")
    .compile()
    .expect("the bundled queries compile")
}

#[cfg(test)]
mod query_tests {
    use super::*;
    use crate::summary::DiffResult;

    #[test]
    fn arbitrary_tags_and_delimiter_captures_reach_the_domain() {
        let params = with_queries(&[(
            "rust",
            r#"((block "{" @fold.open . (_) @fold.indent "}" @fold.close) @fold (#set! tag "removed-runs:user.validation"))"#,
        )]);
        let source = "fn f() { println!(\"☕\"); }";
        let diff = DiffResult::from_sources_with_params("a.rs", "", source, &params);
        let fold = &diff.rhs_folds[0];
        assert_eq!(fold.tags, ["removed-runs:user.validation"]);
        assert_eq!(
            &source[fold.range.start.byte_column..fold.range.end.byte_column],
            " println!(\"☕\"); "
        );
    }

    #[test]
    fn rejects_unsupported_or_malformed_directives_at_compile_time() {
        for query in [
            "((block) @fold (#offset! @fold 0 1 0 -1))",
            "((block) @fold (#unknown! @fold))",
            "((block) @fold (#make-range! \"fold\" @fold @fold))",
            "((block) @fold (#set! typo value))",
            "((block) @fold (#set! tag))",
        ] {
            let error = match try_with_queries(&[("rust", query)]) {
                Ok(_) => panic!("accepted {query}"),
                Err(error) => error.to_string(),
            };
            assert!(error.contains("rust-removed-runs.scm: "), "{error}");
        }
    }

    #[test]
    fn rust_labeled_blocks_fold_between_actual_braces() {
        let params = Params::default();
        for source in [
            "fn f() { 'outer: { work(); } }",
            "fn f() { 'outer: /* prefix */ { work(); } }",
            "fn f() { { work(); } }",
        ] {
            let result = DiffResult::from_sources_with_params("a.rs", "", source, &params);
            let start = source.find("{ work(); }").unwrap() + 1;
            let end = start + " work(); ".len();
            assert!(
                result.rhs_folds.iter().any(|fold| {
                    fold.range.start.line.as_usize() == 0
                        && fold.range.start.byte_column == start
                        && fold.range.end.byte_column == end
                }),
                "missing inner body in {source}"
            );
        }
    }

    #[test]
    fn unicode_string_fold_uses_the_complete_node_range() {
        let params = with_queries(&[("rust", "(string_literal) @fold")]);
        let source = "fn f() { let x = \"☕\"; }";
        let diff = DiffResult::from_sources_with_params("a.rs", "", source, &params);
        assert_eq!(diff.rhs_folds.len(), 1);
        let range = diff.rhs_folds[0].range;
        assert_eq!(
            &source[range.start.byte_column..range.end.byte_column],
            "\"☕\""
        );
    }
}

#[cfg(test)]
mod tag_tests {
    use super::*;
    use crate::parse::folds::FoldMatch;
    use crate::summary::DiffResult;

    #[test]
    fn repeated_rules_accumulate_sorted_tags_without_duplicate_folds() {
        let params = with_queries(&[(
            "rust",
            r#"
            ((block) @fold (#set! tag "removed-runs:user.check"))
            ((block) @fold (#set! tag "removed-runs:body"))
            ((block) @fold (#set! tag "removed-runs:user.check"))
        "#,
        )]);
        let result =
            DiffResult::from_sources_with_params("a.rs", "", "fn f() { work(); }", &params);
        assert_eq!(result.rhs_folds.len(), 1);
        assert_eq!(
            result.rhs_folds[0].tags,
            ["removed-runs:body", "removed-runs:user.check"]
        );
    }

    #[test]
    fn an_opening_capture_alone_folds_to_the_end_of_the_fold_node() {
        let query = r#"((function_definition ":" @fold.open body: (block . (_) @fold.indent) @fold) (#set! tag "removed-runs:body"))"#;
        let params = with_queries(&[("python", query)]);
        let rhs = "def f(a):\n    x = a\n    return x\n";
        let result = DiffResult::from_sources_with_params("a.py", "", rhs, &params);
        assert_eq!(result.rhs_folds.len(), 1);
        let range = &result.rhs_folds[0].range;
        // From just after the `:` to the end of the block.
        assert_eq!(
            (range.start.line.as_usize(), range.start.byte_column),
            (0, 9)
        );
        assert_eq!((range.end.line.as_usize(), range.end.byte_column), (2, 12));
    }

    #[test]
    fn a_node_captured_with_two_ranges_is_a_query_conflict_naming_both_files() {
        let whole = "((block) @fold (#set! tag \"removed-runs:whole\"))";
        let interior =
            "((block \"{\" @fold.open . (_) @fold.indent \"}\" @fold.close) @fold (#set! tag \"summarize:inside\"))";
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("queries/rust")).unwrap();
        let removed_runs = dir.path().join("queries/rust/removed-runs.scm");
        let summarize = dir.path().join("queries/rust/summarize.scm");
        std::fs::write(&removed_runs, whole).unwrap();
        std::fs::write(&summarize, interior).unwrap();
        let queries = |plugin: &str, path: &std::path::Path| {
            (
                plugin.to_owned(),
                vec![crate::plugin::queries::PluginQuery {
                    language: "rust".into(),
                    name: path.display().to_string(),
                    text: std::fs::read_to_string(path).unwrap(),
                }],
            )
        };
        for order in [
            [
                queries("removed-runs", &removed_runs),
                queries("summarize", &summarize),
            ],
            [
                queries("summarize", &summarize),
                queries("removed-runs", &removed_runs),
            ],
        ] {
            let params = Config::default().compile_queries(order.to_vec()).unwrap();
            let conflict = DiffResult::try_from_sources_with_params(
                "src/lib.rs",
                "",
                "fn f() {\n    work();\n}\n",
                &params,
            )
            .expect_err("a conflict");
            // The message names real paths, which Windows writes with `\`.
            let message = conflict.to_string().replace('\\', "/");
            assert!(message.starts_with("src/lib.rs:1: "), "{message}");
            assert!(
                message.contains("queries/rust/removed-runs.scm and ")
                    && message.contains(
                        "queries/rust/summarize.scm capture the same block with different fold ranges or indents"
                    ),
                "{message}"
            );
            // Other files diff as usual.
            assert!(
                DiffResult::try_from_sources_with_params("a.py", "", "x = 1\n", &params).is_ok()
            );
        }
    }

    #[test]
    fn test_bodies_keep_every_owner_tag_and_remain_paired() {
        let params = body_params();
        let result = DiffResult::from_sources_with_params(
            "a.rs",
            "#[test]\nfn example() { old(); }",
            "#[test]\nfn example() { old(); new(); }",
            &params,
        );
        assert_eq!(result.lhs_folds.len(), 1);
        assert_eq!(result.rhs_folds.len(), 1);
        let tags = [
            "deleted-bodies:function",
            "removed-runs:function",
            "summarize:function",
            "summarize:test",
            "test-bodies:test",
        ];
        assert_eq!(result.lhs_folds[0].tags, tags);
        assert_eq!(result.rhs_folds[0].tags, tags);
        assert!(matches!(
            result.lhs_folds[0].match_kind,
            FoldMatch::Matched { .. }
        ));
    }
}

#[cfg(test)]
mod load_tests {
    use super::*;

    #[test]
    fn the_file_overrides_defaults_key_by_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(
            &path,
            "[diff]\ngraph_limit = 5\nbyte_limit = 6\n[theme]\nname = 'mine'\n",
        )
        .unwrap();
        let config = Config::load_from(&path).unwrap();
        assert_eq!(config.diff.graph_limit, 5);
        assert_eq!(config.diff.byte_limit, 6);
        assert_eq!(
            config.diff.parse_error_limit,
            crate::options::DEFAULT_PARSE_ERROR_LIMIT
        );
        assert_eq!(config.theme.name, "mine");
        assert_eq!(config.theme.path, None);
    }

    #[test]
    fn unknown_keys_name_their_path_and_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "[diff]\ngraph_limit = 5\ntypo = 1\n").unwrap();
        let error = Config::load_from(&path).unwrap_err().to_string();
        assert!(
            error.starts_with(&format!("{}: diff.typo: ", path.display())),
            "{error}"
        );
        std::fs::write(&path, "[diff]\ngraph_limit = 'many'\n").unwrap();
        let error = Config::load_from(&path).unwrap_err().to_string();
        assert!(error.contains("diff.graph_limit: "), "{error}");
    }

    #[test]
    fn a_missing_file_is_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let config = Config::load_from(&dir.path().join("absent.toml")).unwrap();
        assert_eq!(config.theme.name, Config::default().theme.name);
    }

    #[test]
    fn schema_describes_every_setting_with_its_default() {
        let schema = Config::schema();
        let diff = &schema["properties"]["diff"];
        let diff = match diff.get("$ref") {
            Some(reference) => {
                let name = reference.as_str().unwrap().rsplit('/').next().unwrap();
                &schema["$defs"][name]
            }
            None => diff,
        };
        let graph_limit = &diff["properties"]["graph_limit"];
        assert_eq!(graph_limit["default"], crate::options::DEFAULT_GRAPH_LIMIT);
        assert!(graph_limit["description"]
            .as_str()
            .unwrap()
            .contains("matching graph"));
        assert!(schema["properties"].get("languages").is_none());
    }
}

#[cfg(test)]
mod format_tests {
    use super::*;

    #[test]
    fn embedded_defaults_round_trip_with_an_explicit_version_and_order() {
        let defaults = Config::default();
        let text = toml::to_string_pretty(&defaults).unwrap();
        let restored = Config::from_toml(&text).unwrap();
        assert_eq!(defaults.version, 2);
        assert_eq!(
            serde_json::to_value(defaults).unwrap(),
            serde_json::to_value(restored).unwrap()
        );
    }

    #[test]
    fn unsupported_versions_are_rejected_before_their_keys() {
        assert!(
            Config::from_toml("version = 1\n[plugins.bundled.context]\nenabled = false")
                .err()
                .unwrap()
                .to_string()
                .contains("unsupported config version 1; expected 2")
        );
    }
}
