//! The plugins on the stream: hidden files, collapsed and linked regions, and
//! a run cut short by a failing plugin.
mod support;

mod git_fixture;
use gix::Repository;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::Output;
use support::get_base_command;
use tempfile::TempDir;

struct Fixture {
    dir: TempDir,
    repo: Repository,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let repo = gix::init(dir.path().join("repo")).unwrap();
        fs::create_dir_all(dir.path().join("config/diffr")).unwrap();
        Self { dir, repo }
    }

    fn write(&self, path: &str, text: &str) {
        let path = self.dir.path().join("repo").join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn remove(&self, path: &str) {
        fs::remove_file(self.dir.path().join("repo").join(path)).unwrap();
    }

    /// A file next to the global configuration file.
    fn config_file(&self, path: &str, text: &str) -> PathBuf {
        let path = self.dir.path().join("config/diffr").join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, text).unwrap();
        path
    }

    fn commit(&self) -> String {
        git_fixture::commit(&self.repo, "fixture")
    }

    fn run(&self, base: &str, head: &str) -> Output {
        self.diffr(&[base, head, "--format", "ndjson"])
    }

    fn diffr(&self, args: &[&str]) -> Output {
        get_base_command()
            .arg("--repo")
            .arg(self.dir.path().join("repo"))
            .args(args)
            .env("XDG_CONFIG_HOME", self.dir.path().join("config"))
            .env_remove("GIT_DIR")
            .env_remove("GEMINI_API_KEY")
            .env_remove("GOOGLE_API_KEY")
            .output()
            .unwrap()
    }
}

fn records(output: &Output) -> Vec<Value> {
    String::from_utf8(output.stdout.clone())
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

/// The `file` record for a path.
fn record<'a>(records: &'a [Value], path: &str) -> &'a Value {
    records
        .iter()
        .find(|record| {
            record["type"] == "file"
                && ["lhs", "rhs"]
                    .iter()
                    .any(|side| record["file"][side]["path"] == path)
        })
        .unwrap_or_else(|| panic!("no record for {path}"))
}

/// Every region on one side of a file record, parents first.
fn regions(record: &Value, side: &str) -> Vec<Value> {
    fn walk(regions: &Value, out: &mut Vec<Value>) {
        for region in regions.as_array().into_iter().flatten() {
            out.push(region.clone());
            walk(&region["children"], out);
        }
    }
    let mut out = Vec::new();
    walk(&record["diff"][side]["root"]["children"], &mut out);
    out
}

const GONE: &str = "/// Gone for good.\n/// Really.\nfn gone() -> u32 {\n    let a = 1;\n    let b = 2;\n    let c = 3;\n    let d = 4;\n    let e = 5;\n    let f = 6;\n    let g = 7;\n    let h = 8;\n    let i = 9;\n    let j = 10;\n    let k = 11;\n    a + b + c + d + e + f + g + h + i + j + k\n}\n";

#[test]
fn the_default_view_hides_links_and_collapses() {
    let fixture = Fixture::new();
    fixture.write("src/lib.rs", &format!("fn keep() {{}}\n\n{GONE}"));
    fixture.write("Cargo.lock", "# generated\n[[package]]\nname = \"a\"\n");
    let base = fixture.commit();
    fixture.write("src/lib.rs", "fn keep() {}\n");
    fixture.write("Cargo.lock", "# generated\n[[package]]\nname = \"b\"\n");
    let head = fixture.commit();
    let output = fixture.run(&base, &head);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let records = records(&output);

    let lock = record(&records, "Cargo.lock");
    assert_eq!(
        lock["diff"]["rhs"]["root"]["visibility"],
        serde_json::json!({"collapsed": true, "label": "Generated file · hidden by default"})
    );
    let start = &records[0];
    assert!(start["files"]
        .as_array()
        .unwrap()
        .iter()
        .all(|file| file.get("visibility").is_none()));

    let lib = record(&records, "src/lib.rs");
    assert!(lib["diff"]["rhs"]["root"].get("visibility").is_none());
    let lhs = regions(lib, "lhs");
    let body = lhs
        .iter()
        .find(|region| {
            region["tags"]
                .as_array()
                .is_some_and(|tags| tags.iter().any(|tag| tag == "deleted-bodies:function"))
        })
        .expect("the deleted body");
    assert_eq!(body["visibility"]["label"], "12 lines removed");
    let docstring = lhs
        .iter()
        .find(|region| {
            region["tags"]
                .as_array()
                .is_some_and(|tags| tags.iter().any(|tag| tag == "deleted-bodies:docstring"))
        })
        .expect("the docstring");
    assert_eq!(docstring["fold_state_id"], body["fold_state_id"]);
    assert_eq!(docstring["visibility"]["collapsed"], true);
}

#[test]
fn a_failing_plugin_aborts_the_run() {
    let fixture = Fixture::new();
    fixture.config_file(
        "config.toml",
        "[plugins.shape.bundled.summarize]\nenabled = true\napi_key = 'k'\nendpoint = 'http://127.0.0.1:1'\nretries = 0\nmin_lines = 1\n",
    );
    fixture.write("keep.txt", "keep\n");
    let base = fixture.commit();
    fixture.write("new.py", "def f():\n    a()\n    b()\n");
    fixture.remove("keep.txt");
    let head = fixture.commit();
    let output = fixture.run(&base, &head);
    assert_eq!(output.status.code(), Some(2));
    let records = records(&output);
    let aborted = &records.last().unwrap()["aborted"];
    assert_eq!(aborted["code"], "mutation_failed", "{aborted}");
    assert!(aborted["message"]
        .as_str()
        .unwrap()
        .starts_with("mutation summarize: summarizer: "));
}

#[test]
fn syntax_spans_come_only_with_the_flag() {
    let fixture = Fixture::new();
    fixture.write("a.rs", "fn a() {}\n");
    let base = fixture.commit();
    fixture.write("a.rs", "fn b() {}\n");
    let head = fixture.commit();
    let plain = records(&fixture.run(&base, &head));
    assert!(record(&plain, "a.rs")["diff"]["rhs"]
        .get("syntax")
        .is_none());
    let output = fixture.diffr(&[&base, &head, "--format", "ndjson", "--syntax"]);
    let records = records(&output);
    let syntax = record(&records, "a.rs")["diff"]["rhs"]["syntax"]
        .as_array()
        .unwrap()
        .clone();
    assert!(
        syntax
            .iter()
            .any(|span| span["capture"] == "keyword" && span["start_column"] == 0),
        "{syntax:?}"
    );
}

#[test]
fn git_binary_files_stream_as_diff_records_with_side_sizes() {
    let fixture = Fixture::new();
    fixture.write("keep.txt", "unchanged\n");
    let empty = fixture.commit();
    fixture.write("plugin.wasm", "\0asm\x01\0\0\0");
    let added = fixture.commit();
    fixture.write("plugin.wasm", "\0asm\x01\0\0\0extra");
    let modified = fixture.commit();
    fixture.remove("plugin.wasm");
    let deleted = fixture.commit();
    for (base, head, expected) in [
        (
            &empty,
            &added,
            serde_json::json!({"type": "binary", "rhs": {"size": 8}}),
        ),
        (
            &added,
            &modified,
            serde_json::json!({"type": "binary", "lhs": {"size": 8}, "rhs": {"size": 13}}),
        ),
        (
            &modified,
            &deleted,
            serde_json::json!({"type": "binary", "lhs": {"size": 13}}),
        ),
    ] {
        let output = fixture.run(base, head);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let events = records(&output);
        assert_eq!(events[1]["diff"], expected);
        assert!(events[1].get("error").is_none());
        assert_eq!(events.last().unwrap()["succeeded"], 1);
        assert_eq!(events.last().unwrap()["failed"], 0);
    }
    // The working-tree source uses the same binary path as a committed blob.
    fixture.write("plugin.wasm", "\0asm");
    git_fixture::git(fixture.repo.workdir().unwrap(), &["add", "plugin.wasm"]);
    let events = records(&fixture.diffr(&[&added, "--format", "ndjson"]));
    assert_eq!(
        events[1]["diff"],
        serde_json::json!({"type": "binary", "lhs": {"size": 8}, "rhs": {"size": 4}})
    );
}

#[test]
fn working_tree_files_go_through_git_clean_filters() {
    let fixture = Fixture::new();
    git_fixture::git(
        fixture.repo.workdir().unwrap(),
        &["config", "core.autocrlf", "true"],
    );
    let lines: Vec<String> = (1..=20).map(|i| format!("doc line {i}")).collect();
    fixture.write("notes.md", &(lines.join("\n") + "\n"));
    let base = fixture.commit();
    let mut edited = lines.clone();
    edited[9] = "doc line 10 CHANGED".into();
    fixture.write("notes.md", &(edited.join("\r\n") + "\r\n"));
    let output = fixture.diffr(&[&base, "--format", "ndjson"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let records = records(&output);
    let notes = record(&records, "notes.md");
    assert_eq!(notes["diff"]["rhs"]["text"], edited.join("\n") + "\n");
    let changed: Vec<Value> = regions(notes, "rhs")
        .iter()
        .flat_map(|region| region["changed"].as_array().cloned().unwrap_or_default())
        .collect();
    assert!(changed.iter().all(|span| span["line"] == 9), "{changed:?}");
}
