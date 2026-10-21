use super::*;
use crate::protocol::{SourcePos, SourceRange, Span, Visibility};

fn range(start: u32, end: u32) -> SourceRange {
    SourceRange {
        start: SourcePos {
            line: start,
            column: 0,
        },
        end: SourcePos {
            line: end,
            column: 0,
        },
    }
}

fn removed(id: u32, alignment: u32, start: u32, end: u32) -> Region {
    Region {
        id,
        fold_state_id: id,
        range: range(start, end),
        tags: vec![],
        visibility: Visibility::default(),
        node: Node::Leaf {
            alignment_id: alignment,
            pair: None,
            changed: (start..end)
                .map(|line| Span {
                    line,
                    start_column: 0,
                    end_column: 4,
                })
                .collect(),
        },
    }
}

fn function(id: u32, start: u32, end: u32, children: Vec<Region>) -> Region {
    Region {
        id,
        fold_state_id: id,
        range: range(start, end),
        tags: vec!["deleted-bodies:function".to_owned()],
        visibility: Visibility::default(),
        node: Node::Fold {
            indent: range(start, end).start,
            syntax: None,
            children,
        },
    }
}

fn source(regions: Vec<Region>) -> Source {
    Source {
        syntax: Vec::new(),
        text: String::new(),
        root: test_root(regions),
    }
}

fn modified() -> FileChange {
    let file = FileRef {
        path: "x".to_owned(),
        oid: String::new(),
        mode: String::new(),
    };
    FileChange {
        file: Pairing::Both {
            lhs: file.clone(),
            rhs: file,
        },
        status: FileStatus::Modified,
        tags: vec![],
    }
}

/// A deleted function body, and a removed stretch after it.
fn fixture() -> Pairing<Source> {
    Pairing::Both {
        lhs: source(vec![
            function(1, 0, 3, vec![removed(2, 0, 0, 3)]),
            removed(3, 1, 3, 10),
        ]),
        rhs: source(vec![removed(20, 2, 0, 1)]),
    }
}

/// The bundled plugin `name`'s folder, copied with a manifest that marks
/// it deferred.
fn deferred_copy(name: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("plugins/shape/{name}/plugin.wasm")),
        dir.path().join("plugin.wasm"),
    )
    .unwrap();
    std::fs::write(
        dir.path().join("plugin.toml"),
        format!("name = '{name}'\ntitle = 'Deferred'\ndeferred = true\n[options.min_lines]\ntype = 'integer'\ntitle = 'Lines'\ndefault = 1\n"),
    )
    .unwrap();
    dir
}

/// Each top-level lhs region: its lines and whether it is collapsed.
fn shape_of(sides: &Pairing<Source>) -> Vec<(u32, u32, bool)> {
    lhs(sides)
        .root
        .children()
        .iter()
        .map(|region| {
            let lines = region.range.lines();
            (lines.start, lines.end, region.visibility.collapsed)
        })
        .collect()
}

#[test]
fn a_deferred_plugin_may_only_change_visibility_in_the_deferred_pass() {
    let dir = deferred_copy("removed-runs");
    let pipeline = configured(&format!(
        "[plugins.shape]\norder = ['removed-runs']\n[plugins.shape.removed-runs]\npath = {:?}\nmin_lines = 5\n",
        dir.path()
    ))
    .unwrap();
    assert!(pipeline.has_deferred());
    let error = shape_in(&pipeline, &modified(), &mut fixture(), Pass::Deferred).unwrap_err();
    let error = format!("{error:#}");
    assert!(error.contains("removed-runs"), "{error}");
    assert!(
        error.contains("deferred plugins may only change visibility"),
        "{error}"
    );
    let mut sides = fixture();
    shape_in(&pipeline, &modified(), &mut sides, Pass::All).unwrap();
    assert_eq!(shape_of(&sides).len(), 4, "the removed stretch is cut");
}

#[test]
fn the_eager_pass_skips_deferred_plugins_and_the_deferred_pass_runs_only_them() {
    let dir = deferred_copy("deleted-bodies");
    let pipeline = configured(&format!(
        "[plugins.shape]\norder = ['deleted-bodies', 'bundled.removed-runs']\n[plugins.shape.deleted-bodies]\npath = {:?}\n[plugins.shape.bundled.removed-runs]\nmin_lines = 5\n",
        dir.path()
    ))
    .unwrap();
    assert!(pipeline.has_deferred());
    let run = |passes: &[Pass]| {
        let mut sides = fixture();
        for pass in passes {
            shape_in(&pipeline, &modified(), &mut sides, *pass).unwrap();
        }
        sides
    };
    let cut = [(3, 4, false), (4, 9, true), (9, 10, false)];
    let eager = run(&[Pass::Eager]);
    assert_eq!(shape_of(&eager), [&[(0, 3, false)], &cut[..]].concat());
    let deferred = run(&[Pass::Deferred]);
    assert_eq!(shape_of(&deferred), [(0, 3, true), (3, 10, false)]);
    let all = run(&[Pass::All]);
    assert_eq!(shape_of(&all), [&[(0, 3, true)], &cut[..]].concat());
    assert_eq!(run(&[Pass::Eager, Pass::Deferred]), all);
}

#[test]
fn bundled_shape_plugins_other_than_the_summarizer_are_eager() {
    assert!(!bundled("context", json!({})).has_deferred());
    assert!(bundled("summarize", json!({"api_key": "test"})).has_deferred());
}
