//! The plugin host and the bundled plugins, run the way the stream runs
//! them: a file projected with the bundled queries, then each plugin's
//! components through a [`Pipeline`].
mod context;
mod deleted_bodies;
mod removed_runs;
mod summarize;
mod test_bodies;

use super::*;
use crate::config::{Config, Params};
use crate::options::DiffOptions;
use crate::pairing::Pairing;
use crate::protocol::{self, project, Diff, FileChange, FileRef, FileStatus, Node, Region, Source};
use serde_json::json;
use std::collections::BTreeMap;
use std::num::NonZeroUsize;

/// A test side's root. Its id stays clear of the regions' ids and differs
/// between sides, which never share region ids.
pub(crate) fn test_root(regions: Vec<Region>) -> Region {
    let id = 1000 + regions.iter().map(|region| region.id).min().unwrap_or(0);
    Region::root(id, regions)
}

/// Set each leaf's `pair` from the fixture's alignment ids.
pub(crate) fn name_pairs(sides: &mut Pairing<Source>) {
    fn name(regions: &mut [Region], other: &BTreeMap<u32, u32>) {
        for region in regions {
            match &mut region.node {
                Node::Leaf {
                    alignment_id, pair, ..
                } => *pair = other.get(alignment_id).copied(),
                Node::Fold { children, .. } => name(children, other),
            }
        }
    }
    let Pairing::Both { lhs, rhs } = sides else {
        return;
    };
    let ids = |source: &Source| {
        let mut ids = BTreeMap::new();
        walk(std::slice::from_ref(&source.root), &mut |region| {
            if let Some(alignment) = region.alignment_id() {
                ids.insert(alignment, region.id);
            }
        });
        ids
    };
    let (lhs_ids, rhs_ids) = (ids(lhs), ids(rhs));
    name(std::slice::from_mut(&mut lhs.root), &rhs_ids);
    name(std::slice::from_mut(&mut rhs.root), &lhs_ids);
}
use std::path::Path;

pub(crate) fn walk(regions: &[Region], visit: &mut impl FnMut(&Region)) {
    for region in regions {
        visit(region);
        if let Node::Fold { children, .. } = &region.node {
            walk(children, visit);
        }
    }
}

pub(crate) fn is_fold(region: &Region) -> bool {
    matches!(region.node, Node::Fold { .. })
}

pub(crate) fn has_tag(region: &Region, tag: &str) -> bool {
    region.tags.iter().any(|own| own == tag)
}

/// Project a two-source comparison with the bundled queries, the way the
/// stream does before the plugins run.
pub(crate) fn project(
    path: &str,
    before: &str,
    after: &str,
) -> (FileChange, Pairing<protocol::Source>) {
    project_with(path, before, after, DiffOptions::default())
}

pub(crate) fn project_with(
    path: &str,
    before: &str,
    after: &str,
    options: DiffOptions,
) -> (FileChange, Pairing<protocol::Source>) {
    let params = Config::from_toml("").unwrap().compile().unwrap();
    project_compiled(path, before, after, &params, options)
}

/// Project with the queries `params` was compiled with.
pub(crate) fn project_compiled(
    path: &str,
    before: &str,
    after: &str,
    params: &Params,
    options: DiffOptions,
) -> (FileChange, Pairing<protocol::Source>) {
    let result = crate::summary::DiffResult::from_sources_with_options(
        path, before, after, params, &options,
    )
    .unwrap();
    let file_ref = FileRef {
        path: path.to_owned(),
        oid: String::new(),
        mode: String::new(),
    };
    let file = FileChange {
        file: Pairing::Both {
            lhs: file_ref.clone(),
            rhs: file_ref,
        },
        status: FileStatus::Modified,
        tags: Vec::new(),
    };
    let diff = project::diff(
        &result,
        project::Inputs {
            file: &file.file,
            sizes: (before.len() as u64, after.len() as u64),
        },
    );
    let Diff::Text { sides, .. } = diff else {
        panic!("text diff expected");
    };
    (file, sides)
}

pub(crate) fn lhs(sides: &Pairing<Source>) -> &Source {
    sides.lhs().expect("a before side")
}

pub(crate) fn rhs(sides: &Pairing<Source>) -> &Source {
    sides.rhs().expect("an after side")
}

/// A pipeline of the bundled plugin `name` alone, configured with
/// `overrides` the way a settings file would.
pub(crate) fn bundled(name: &str, overrides: serde_json::Value) -> Pipeline {
    configured(&format!(
        "[plugins.shape]\norder = ['bundled.{name}']\n[plugins.shape.bundled.{name}]\nenabled = true\n{}",
        options(overrides)
    ))
    .unwrap()
}

/// A one-worker pipeline from a settings file's text.
pub(crate) fn configured(toml: &str) -> anyhow::Result<Pipeline> {
    let config = Config::from_toml(toml)?;
    Pipeline::from_config(&config, Path::new("."), NonZeroUsize::MIN)
}

/// Plugin options as the lines of a settings table.
pub(crate) fn options(options: serde_json::Value) -> String {
    let serde_json::Value::Object(options) = options else {
        panic!("options are an object");
    };
    toml::to_string(&options).unwrap()
}

/// Run `pipeline` on `sides` in place, as the stream does.
pub(crate) fn shape(
    pipeline: &Pipeline,
    file: &FileChange,
    sides: &mut Pairing<Source>,
) -> anyhow::Result<()> {
    *sides = crate::test_runtime().block_on(pipeline.run(file, sides.clone()))?;
    Ok(())
}

/// Run the bundled plugin `name` with `overrides` and carry out its moves.
pub(crate) fn run(
    name: &str,
    overrides: serde_json::Value,
    file: &FileChange,
    sides: &mut Pairing<protocol::Source>,
) {
    shape(&bundled(name, overrides), file, sides).unwrap();
}

/// For each `deleted-bodies:function` body on the after side, the first line
/// of the body and the lines of its docstring: the `deleted-bodies:docstring`
/// region sharing its `fold_state_id`.
fn documented(path: &str, after: &str) -> Vec<(u32, Option<(u32, u32)>)> {
    let (_, sides) = project(path, "", after);
    let source = rhs(&sides);
    let mut bodies = Vec::new();
    walk(source.root.children(), &mut |region| {
        if is_fold(region) && has_tag(region, "deleted-bodies:function") {
            let mut docstring = None;
            walk(source.root.children(), &mut |other| {
                if other.fold_state_id == region.fold_state_id
                    && has_tag(other, "deleted-bodies:docstring")
                {
                    let lines = other.range.lines();
                    assert!(docstring.is_none(), "one docstring per body");
                    docstring = Some((lines.start, lines.end));
                }
            });
            bodies.push((region.range.start.line, docstring));
        }
    });
    bodies
}

#[test]
fn rust_doc_and_line_comments_above_a_function_are_its_docstring() {
    let after = "fn keep() -> u32 {\n    let x = 1;\n    x\n}\n\n/// Adds one.\n/// Twice, really.\nfn add(\n    a: u32,\n) -> u32 {\n    let b = a;\n    b + 2\n}\n\n// Plain comment.\n// Two lines.\n#[inline]\nfn sub(a: u32) -> u32 {\n    let b = a;\n    b - 1\n}\n\n// One line.\nfn one(a: u32) -> u32 {\n    let b = a;\n    b - 1\n}\n\n/**\n * Block.\n */\nfn block() {\n    x();\n    y();\n}\n";
    assert_eq!(
        documented("a.rs", after),
        [
            (1, None),
            (10, Some((5, 7))),
            (18, Some((14, 16))),
            (24, Some((22, 23))),
            (32, Some((28, 31)))
        ],
        "one-line docstrings are linked"
    );
}

#[test]
fn a_comment_separated_from_the_function_by_code_does_not_count() {
    let after =
        "// About the constant.\n// Really.\nconst X: u32 = 1;\nfn f() -> u32 {\n    let y = X;\n    y\n}\n";
    assert_eq!(documented("a.rs", after), [(4, None)]);
}

#[test]
fn a_docstring_is_not_found_past_a_one_line_function() {
    let after = "/// First.\n/// Documented.\nfn a() {}\nfn b() {\n    x();\n    y();\n}\n";
    assert_eq!(documented("a.rs", after), [(4, None)]);
    let after =
        "// First.\n// Documented.\nexport const a = 1;\nfunction b() {\n  x();\n  y();\n}\n";
    assert_eq!(documented("a.ts", after), [(4, None)]);
}

#[test]
fn a_python_string_first_in_the_body_is_its_docstring() {
    let after =
        "def f(a):\n    \"\"\"Double a.\n\n    Returns an int.\n    \"\"\"\n    return a * 2\n";
    assert_eq!(documented("a.py", after), [(1, Some((1, 5)))]);
}

#[test]
fn go_and_javascript_comment_runs_document_functions() {
    for (path, source, expected) in [
        (
            "a.go",
            "package a\n\n// Sum adds.\n// Twice.\nfunc Sum(a int) int {\n\tb := a\n\treturn a + b\n}\n",
            (5, Some((2, 4))),
        ),
        (
            "a.ts",
            "// Sum adds.\n// Twice.\nexport function sum(a: number) {\n  const b = a;\n  return a + b;\n}\n",
            (3, Some((0, 2))),
        ),
        (
            "a.js",
            "/**\n * Sum adds.\n */\nconst sum = (a) => {\n  const b = a;\n  return a + b;\n};\n",
            (4, Some((0, 3))),
        ),
    ] {
        assert_eq!(documented(path, source), [expected], "{path}");
    }
}

#[test]
fn the_default_pipeline_can_be_created() {
    let config = Config::default();
    Pipeline::from_config(&config, Path::new("."), NonZeroUsize::MIN).unwrap();
}

/// The manifest can accept an option the component itself rejects: the
/// component's constructor has the last word, and fails setup.
#[test]
fn options_that_do_not_deserialize_are_a_setup_error() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("plugins/shape/context/plugin.wasm"),
        dir.path().join("plugin.wasm"),
    )
    .unwrap();
    std::fs::write(
        dir.path().join("plugin.toml"),
        "name = 'context'\ntitle = 'Context'\n[options.extra]\ntype = 'integer'\ntitle = 'Extra'\n",
    )
    .unwrap();
    let error = configured(&format!(
        "[plugins.shape]\norder = ['context']\n[plugins.shape.context]\npath = {:?}\nextra = 1\n",
        dir.path()
    ))
    .err()
    .expect("unknown option rejected");
    let error = format!("{error:#}");
    assert!(error.contains("plugins.shape.context"), "{error}");
    assert!(error.contains("unknown field `extra`"), "{error}");
}

#[test]
fn external_plugins_require_a_component() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("plugin.toml"),
        "name = 'context'\ntitle = 'External context'\n",
    )
    .unwrap();
    let config = Config::from_toml_in(
        "[plugins.shape]\norder = ['context']\n[plugins.shape.context]\npath = '.'\n",
        dir.path(),
    )
    .unwrap();
    let error = Pipeline::from_config(&config, dir.path(), NonZeroUsize::MIN)
        .err()
        .unwrap();
    let error = format!("{error:#}");
    assert!(error.contains("plugin.wasm"), "{error}");
    assert!(error.contains("plugins.shape.context"), "{error}");
}

#[test]
fn a_subset_of_bundled_plugins_can_use_shared_query_tags() {
    Config::from_toml("[plugins.shape]\norder = ['bundled.deleted-bodies']\n")
        .unwrap()
        .compile()
        .unwrap();
}

#[test]
fn documentation_link_comes_from_query_captures_not_distance() {
    let parameters = (0..16)
        .map(|i| format!("    arg{i}: u32,\n"))
        .collect::<String>();
    let source = format!("/// This belongs to f.\n/// Even with a long signature.\nfn f(\n{parameters}) {{\n    first();\n    second();\n}}\n");
    assert_eq!(documented("long.rs", &source), [(20, Some((0, 2)))]);
}

/// A component's exports decide its kind: a shape plugin is no classifier,
/// and the classifier is no shape plugin.
#[test]
fn a_plugin_configured_as_the_wrong_kind_is_a_setup_error() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let config = Config::from_toml(&format!(
        "[plugins.classify.context]\npath = {:?}\n",
        root.join("plugins/shape/context")
    ))
    .unwrap();
    let error = Classifier::from_config(&config, Path::new("."))
        .err()
        .expect("a shape plugin is not a classifier");
    assert!(
        format!("{error:#}").contains("not a classifier"),
        "{error:#}"
    );
    let error = configured(&format!(
        "[plugins.shape]\norder = ['classify']\n[plugins.shape.classify]\npath = {:?}\n",
        root.join("plugins/classify")
    ))
    .err()
    .expect("the classifier is not a shape plugin");
    assert!(
        format!("{error:#}").contains("not a shape plugin"),
        "{error:#}"
    );
}
