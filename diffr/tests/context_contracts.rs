//! Reviewed context contracts, using the real diff, context plugin and Rust printer.

mod support;
use diffr_core::parse::guess_language::Language;
use diffr_core::protocol::{Diff, Event, Node, Outcome, Region};
use std::collections::BTreeSet;
use strum::IntoEnumIterator;
use support::get_base_command;

#[path = "fixtures/context-contracts/go.rs"]
mod go;
#[path = "fixtures/context-contracts/jsx.rs"]
mod jsx;
#[path = "fixtures/context-contracts/python.rs"]
mod python;
#[path = "fixtures/context-contracts/rust.rs"]
mod rust;
#[path = "fixtures/context-contracts/tsx.rs"]
mod tsx;
#[path = "fixtures/context-contracts/typescript.rs"]
mod typescript;

#[path = "fixtures/context-contracts/ada.rs"]
mod ada;
#[path = "fixtures/context-contracts/apex.rs"]
mod apex;
#[path = "fixtures/context-contracts/asm.rs"]
mod asm;
#[path = "fixtures/context-contracts/bash.rs"]
mod bash;
#[path = "fixtures/context-contracts/c.rs"]
mod c;
#[path = "fixtures/context-contracts/clojure.rs"]
mod clojure;
#[path = "fixtures/context-contracts/cmake.rs"]
mod cmake;
#[path = "fixtures/context-contracts/commonlisp.rs"]
mod commonlisp;
#[path = "fixtures/context-contracts/cplusplus.rs"]
mod cplusplus;
#[path = "fixtures/context-contracts/csharp.rs"]
mod csharp;
#[path = "fixtures/context-contracts/css.rs"]
mod css;
#[path = "fixtures/context-contracts/dart.rs"]
mod dart;
#[path = "fixtures/context-contracts/devicetree.rs"]
mod devicetree;
#[path = "fixtures/context-contracts/dockerfile.rs"]
mod dockerfile;
#[path = "fixtures/context-contracts/elixir.rs"]
mod elixir;
#[path = "fixtures/context-contracts/elm.rs"]
mod elm;
#[path = "fixtures/context-contracts/emacslisp.rs"]
mod emacslisp;
#[path = "fixtures/context-contracts/erlang.rs"]
mod erlang;
#[path = "fixtures/context-contracts/fish.rs"]
mod fish;
#[path = "fixtures/context-contracts/fortran.rs"]
mod fortran;
#[path = "fixtures/context-contracts/fsharp.rs"]
mod fsharp;
#[path = "fixtures/context-contracts/gleam.rs"]
mod gleam;
#[path = "fixtures/context-contracts/haskell.rs"]
mod haskell;
#[path = "fixtures/context-contracts/hcl.rs"]
mod hcl;
#[path = "fixtures/context-contracts/html.rs"]
mod html;
#[path = "fixtures/context-contracts/janet.rs"]
mod janet;
#[path = "fixtures/context-contracts/java.rs"]
mod java;
#[path = "fixtures/context-contracts/javascript.rs"]
mod javascript;
#[path = "fixtures/context-contracts/json.rs"]
mod json;
#[path = "fixtures/context-contracts/julia.rs"]
mod julia;
#[path = "fixtures/context-contracts/kotlin.rs"]
mod kotlin;
#[path = "fixtures/context-contracts/latex.rs"]
mod latex;
#[path = "fixtures/context-contracts/lua.rs"]
mod lua;
#[path = "fixtures/context-contracts/make.rs"]
mod make;
#[path = "fixtures/context-contracts/newick.rs"]
mod newick;
#[path = "fixtures/context-contracts/nix.rs"]
mod nix;
#[path = "fixtures/context-contracts/objc.rs"]
mod objc;
#[path = "fixtures/context-contracts/ocaml.rs"]
mod ocaml;
#[path = "fixtures/context-contracts/ocamlinterface.rs"]
mod ocamlinterface;
#[path = "fixtures/context-contracts/pascal.rs"]
mod pascal;
#[path = "fixtures/context-contracts/perl.rs"]
mod perl;
#[path = "fixtures/context-contracts/php.rs"]
mod php;
#[path = "fixtures/context-contracts/proto.rs"]
mod proto;
#[path = "fixtures/context-contracts/qml.rs"]
mod qml;
#[path = "fixtures/context-contracts/r.rs"]
mod r;
#[path = "fixtures/context-contracts/racket.rs"]
mod racket;
#[path = "fixtures/context-contracts/ruby.rs"]
mod ruby;
#[path = "fixtures/context-contracts/scala.rs"]
mod scala;
#[path = "fixtures/context-contracts/scheme.rs"]
mod scheme;
#[path = "fixtures/context-contracts/smali.rs"]
mod smali;
#[path = "fixtures/context-contracts/solidity.rs"]
mod solidity;
#[path = "fixtures/context-contracts/sql.rs"]
mod sql;
#[path = "fixtures/context-contracts/swift.rs"]
mod swift;
#[path = "fixtures/context-contracts/toml.rs"]
mod toml;
#[path = "fixtures/context-contracts/verilog.rs"]
mod verilog;
#[path = "fixtures/context-contracts/vhdl.rs"]
mod vhdl;
#[path = "fixtures/context-contracts/xml.rs"]
mod xml;
#[path = "fixtures/context-contracts/yaml.rs"]
mod yaml;
#[path = "fixtures/context-contracts/zig.rs"]
mod zig;

fn pprint_diff(path: &str, before: &str, after: &str, context_lines: u32) -> String {
    pprint_after_opening(path, before, after, context_lines, &[])
}

/// Locate a fold by its original, one-based after-source line, rather than by
/// unstable region IDs. Each action opens only that fold's own state.
enum OpenFold {
    RunStartingAt(usize),
    BodyOf(usize),
}

fn pprint_after_opening(
    path: &str,
    before: &str,
    after: &str,
    context_lines: u32,
    open: &[OpenFold],
) -> String {
    let work = tempfile::tempdir().unwrap();
    let base = work.path().join("base").join(path);
    let head = work.path().join("head").join(path);
    for source in [&base, &head] {
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
    }
    std::fs::write(&base, before).unwrap();
    std::fs::write(&head, after).unwrap();
    let config = work.path().join("config/diffr");
    std::fs::create_dir_all(&config).unwrap();
    std::fs::write(
        config.join("config.toml"),
        "[plugins.shape]\norder = ['bundled.context']\n",
    )
    .unwrap();
    let diff = get_base_command()
        .current_dir(work.path())
        .env("XDG_CONFIG_HOME", work.path().join("config"))
        .args(["--format", "ndjson", "--no-index", "-U"])
        .arg(context_lines.to_string())
        .arg("--")
        // `/` on every platform, so the printed paths match the goldens.
        .arg(format!("base/{path}"))
        .arg(format!("head/{path}"))
        .output()
        .unwrap();
    assert!(
        diff.status.success(),
        "{}",
        String::from_utf8_lossy(&diff.stderr)
    );
    let mut opened = BTreeSet::new();
    if !open.is_empty() {
        let events: Vec<Event> = String::from_utf8(diff.stdout.clone())
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let root = events
            .iter()
            .find_map(|event| match event {
                Event::File {
                    outcome:
                        Outcome::Diff {
                            diff: Diff::Text { sides, .. },
                        },
                    ..
                } => sides.rhs().map(|source| &source.root),
                _ => None,
            })
            .unwrap();
        fn collect<'a>(region: &'a Region, regions: &mut Vec<&'a Region>) {
            regions.push(region);
            for child in region.children() {
                collect(child, regions);
            }
        }
        let mut regions = Vec::new();
        collect(root, &mut regions);
        for action in open {
            let region = regions.iter().find(|region| {
                region.visibility.collapsed && !opened.contains(&region.fold_state_id) && match action {
                    OpenFold::RunStartingAt(line) => region.range.start.line as usize + 1 == *line,
                    OpenFold::BodyOf(line) => matches!(region.node, Node::Fold { syntax: Some(syntax), .. } if syntax.start.line as usize + 1 == *line),
                }
            }).expect("the requested fold starts collapsed");
            opened.insert(region.fold_state_id);
        }
    }
    let stream = work.path().join("diff.ndjson");
    std::fs::write(&stream, diff.stdout).unwrap();
    let mut printer = get_base_command();
    printer.arg("pprint").arg(stream);
    if !opened.is_empty() {
        printer.arg("--open").arg(
            opened
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    let printed = printer.output().unwrap();
    assert!(
        printed.status.success(),
        "{}",
        String::from_utf8_lossy(&printed.stderr)
    );
    String::from_utf8(printed.stdout).unwrap()
}

#[test]
fn maximum_context_width_matches_file_sized_context() {
    let before = "first = 1\nsecond = 2\nthird = 3\n\ndef unrelated():\n    prepare()\n    finish()\n\nchanged = 1\ntail = 2\nlast = 3\n";
    let after = before.replace("changed = 1", "changed = 2");
    assert_eq!(
        pprint_diff("example.py", before, &after, u32::MAX),
        pprint_diff("example.py", before, &after, 100),
    );
}

#[test]
fn every_structural_language_has_context_goldens() {
    let fixtures =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/context-contracts");
    let covered: BTreeSet<_> = std::fs::read_dir(fixtures)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "rs"))
        .map(|path| path.file_stem().unwrap().to_str().unwrap().to_owned())
        .map(|language| match language.as_str() {
            "jsx" => "javascriptjsx".to_owned(),
            "tsx" => "typescripttsx".to_owned(),
            _ => language,
        })
        .collect();
    let supported = Language::iter()
        .map(|language| format!("{language:?}").to_lowercase())
        .collect();
    assert_eq!(covered, supported);
}
