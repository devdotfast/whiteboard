//! Compile the supported Tree-sitter capture and directive conventions.
//!
//! A query is compiled from one or more named sources, concatenated in
//! order. Every pattern remembers which source it came from, so errors and
//! conflicts can name the file that wrote it.
use super::ConfigError;
use tree_sitter::{CaptureQuantifier, Query};

pub(crate) struct AnnotationQuery {
    pub(crate) query: Query,
    pub(crate) patterns: Vec<Pattern>,
    /// The name of every source, indexed by `Pattern::source`.
    pub(crate) sources: Vec<String>,
}

pub(crate) struct Pattern {
    pub(crate) tags: Vec<String>,
    /// Index into `AnnotationQuery::sources`.
    pub(crate) source: usize,
}

/// One piece of query text and the name errors call it by: a query file's
/// path, or a configuration key.
pub(crate) struct QuerySource {
    pub(crate) name: String,
    pub(crate) text: String,
}

impl AnnotationQuery {
    pub(crate) fn compile(
        grammar: &tree_sitter::Language,
        sources: &[QuerySource],
    ) -> Result<Self, ConfigError> {
        let mut text = String::new();
        let mut starts = Vec::with_capacity(sources.len());
        for source in sources {
            starts.push(text.len());
            text.push_str(&source.text);
            text.push('\n');
        }
        // The source a byte of the concatenated text belongs to.
        let owner = |offset: usize| starts.partition_point(|&start| start <= offset) - 1;
        let query = Query::new(grammar, &text).map_err(|error| {
            if sources.is_empty() {
                return ConfigError(error.to_string());
            }
            let index = owner(error.offset.min(text.len().saturating_sub(1)));
            let line = text[starts[index]..error.offset].matches('\n').count() + 1;
            ConfigError(format!(
                "{}:{line}: {:?} error: {}",
                sources[index].name, error.kind, error.message
            ))
        })?;
        let named = |pattern: usize, message: String| {
            ConfigError(format!(
                "{}: {message}",
                sources[owner(query.start_byte_for_pattern(pattern))].name
            ))
        };
        for name in query.capture_names() {
            if name.starts_with("related.")
                || name.starts_with('_')
                || matches!(*name, "fold" | "fold.open" | "fold.close" | "fold.indent")
            {
                continue;
            }
            let source = sources
                .iter()
                .find(|source| source.text.contains(&format!("@{name}")))
                .expect("a capture name appears in the text that declared it");
            return Err(ConfigError(format!(
                "{}: unsupported capture @{name}; use an underscore prefix for helper captures",
                source.name
            )));
        }
        let mut patterns = Vec::new();
        for index in 0..query.pattern_count() {
            let mut pattern = Pattern {
                tags: Vec::new(),
                source: owner(query.start_byte_for_pattern(index)),
            };
            // Every match with `@fold.open` has exactly one `@fold.indent`.
            let quantifier = |name: &str| {
                query
                    .capture_index_for_name(name)
                    .map_or(CaptureQuantifier::Zero, |capture| {
                        query.capture_quantifiers(index)[capture as usize]
                    })
            };
            match (quantifier("fold.open"), quantifier("fold.indent")) {
                (CaptureQuantifier::Zero, _) | (CaptureQuantifier::One, CaptureQuantifier::One) => {
                }
                (CaptureQuantifier::One, _) => {
                    return Err(named(
                        index,
                        "@fold.open needs exactly one @fold.indent".into(),
                    ))
                }
                _ => {
                    return Err(named(
                        index,
                        "@fold.open must be in every branch of its pattern".into(),
                    ))
                }
            }
            if !query.property_predicates(index).is_empty() {
                return Err(named(index, "#is? and #is-not? are not supported".into()));
            }
            for property in query.property_settings(index) {
                if property.key.as_ref() != "tag" {
                    return Err(named(
                        index,
                        format!("unsupported #set! property {}", property.key),
                    ));
                }
                if property
                    .capture_id
                    .is_some_and(|id| query.capture_names()[id] != "fold")
                {
                    return Err(named(
                        index,
                        "tag metadata must target @fold or its pattern".into(),
                    ));
                }
                let tag = property
                    .value
                    .as_deref()
                    .filter(|tag| !tag.is_empty())
                    .ok_or_else(|| named(index, "#set! tag requires a nonempty string".into()))?;
                pattern.tags.push(tag.to_owned());
            }
            if let Some(predicate) = query.general_predicates(index).first() {
                return Err(named(
                    index,
                    format!("unsupported directive #{}", predicate.operator),
                ));
            }
            patterns.push(pattern);
        }
        Ok(Self {
            query,
            patterns,
            sources: sources.iter().map(|source| source.name.clone()).collect(),
        })
    }
}
