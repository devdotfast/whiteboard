//! WASM component plugins: the bundled plugins built as components shape
//! files exactly as the same source compiled into diffr does, and the
//! fixtures example classifies, reads a file, runs git and moves regions.
mod support;

mod git_fixture;
use gix::Repository;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Once;
use support::get_base_command;
use tempfile::TempDir;

/// Build every guest plugin into its folder's `plugin.wasm`, once per test
/// run.
fn build_plugins() {
    static BUILD: Once = Once::new();
    BUILD.call_once(|| {
        let output = Command::new(env!("CARGO"))
            .current_dir(root())
            .args([
                "run",
                "--locked",
                "--package",
                "xtask",
                "--",
                "build-plugins",
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "building the WASM plugins failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    });
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// A repository with a working tree, a home directory, and a config
/// directory.
struct Fixture {
    dir: TempDir,
    repo: Repository,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let repo = gix::init(dir.path().join("repo")).unwrap();
        fs::create_dir_all(dir.path().join("home/.config")).unwrap();
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

    fn commit(&self, message: &str) -> String {
        git_fixture::commit(&self.repo, message)
    }

    /// A global config file holding `text`, under a config home of its own.
    fn config(&self, name: &str, text: &str) -> PathBuf {
        let path = self.dir.path().join(name).join("diffr/config.toml");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, text).unwrap();
        path
    }

    /// Diff `base` to `head` with `config` as the global config file.
    fn run(&self, config: &Path, base: &str, head: &str) -> Output {
        let config_home = config.parent().unwrap().parent().unwrap();
        get_base_command()
            .arg("--repo")
            .arg(self.dir.path().join("repo"))
            .args([base, head, "--format", "ndjson"])
            .env("HOME", self.dir.path().join("home"))
            .env("XDG_CONFIG_HOME", config_home)
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

fn path_of(file: &Value) -> &str {
    file.get("rhs").or_else(|| file.get("lhs")).unwrap()["path"]
        .as_str()
        .unwrap()
}

/// The start record, the file records sorted by path (they arrive in
/// completion order), and the complete record.
fn sorted(output: &Output) -> (Value, Vec<Value>, Value) {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let mut records = records(output);
    let complete = records.pop().unwrap();
    let start = records.remove(0);
    records.sort_by(|a, b| path_of(&a["file"]).cmp(path_of(&b["file"])));
    (start, records, complete)
}

fn walk<'a>(regions: &'a Value, out: &mut Vec<&'a Value>) {
    for region in regions.as_array().into_iter().flatten() {
        out.push(region);
        walk(&region["children"], out);
    }
}

#[test]
fn bundled_and_external_components_produce_identical_files() {
    build_plugins();
    let fixture = Fixture::new();
    let body = |name: &str| {
        format!("def {name}():\n    a = 1\n    b = 2\n    c = 3\n    return a + b + c\n\n")
    };
    let rust_test = |name: &str| {
        format!("    /// Checks {name}.\n    /// Really.\n    #[test]\n    fn {name}() {{\n        let a = 1;\n        let b = 2;\n        assert_eq!(a + b, 3);\n    }}\n\n")
    };
    fixture.write(
        "src/removed.py",
        &format!("{}{}{}keep = 1\n", body("a"), body("b"), body("c")),
    );
    fixture.write(
        "src/lib.rs",
        &format!(
            "/// Adds.\n/// Twice.\npub fn add(a: u32) -> u32 {{\n    let b = a;\n    let c = b;\n    c + c\n}}\n\npub fn keep() -> u32 {{\n    1\n}}\n\n#[cfg(test)]\nmod tests {{\n{}{}}}\n",
            rust_test("one"),
            rust_test("two")
        ),
    );
    fixture.write(
        "tests/test_things.py",
        &format!(
            "def test_one():\n    assert 1\n    assert 2\n    assert 3\n\n\ndef test_two():\n    assert 1\n    assert 2\n    assert 3\n\n{}",
            body("helper")
        ),
    );
    fixture.write(
        "web/a.test.ts",
        "it('adds', () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n\nit('subtracts', () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n",
    );
    fixture.write("src/gone.go", "package a\n\n// Gone.\n// Really.\nfunc Gone() int {\n\ta := 1\n\tb := 2\n\treturn a + b\n}\n");
    let settings = |value: u32| {
        let lines: String = (0..20).map(|i| format!("setting_{i} = {i}\n")).collect();
        format!("{lines}changed = {value}\n")
    };
    fixture.write("src/settings.py", &settings(1));
    let base = fixture.commit("base\n");
    fixture.write("src/settings.py", &settings(2));
    fixture.write("src/removed.py", "keep = 1\n");
    fixture.write(
        "src/lib.rs",
        &format!(
            "pub fn keep() -> u32 {{\n    2\n}}\n\n#[cfg(test)]\nmod tests {{\n{}{}}}\n",
            rust_test("one").replace("a + b", "b + a"),
            rust_test("three")
        ),
    );
    fixture.write(
        "tests/test_things.py",
        "def test_one():\n    assert 1\n    assert 2\n    assert 4\n\n\ndef test_three():\n    assert 1\n    assert 2\n    assert 3\n",
    );
    fixture.write(
        "web/a.test.ts",
        "it('adds', () => {\n  expect(1).toBe(1);\n  expect(3).toBe(3);\n});\n",
    );
    fixture.remove("src/gone.go");
    fixture.write(
        "src/new.rs",
        "#[test]\nfn new() {\n    a();\n    b();\n    c();\n}\n",
    );
    let head = fixture.commit("head\n");

    let options = "[plugins.shape.bundled.deleted-bodies]\nmin_lines = 3\n[plugins.shape.bundled.test-bodies]\nmin_lines = 2\n";
    let bundled = fixture.config("bundled", options);
    let plugin = |name: &str| {
        root()
            .join("plugins/shape")
            .join(name)
            .display()
            .to_string()
    };
    // Every bundled plugin from its folder, and the classifier; the summarizer is off.
    let wasm = fixture.config(
        "wasm",
        &format!(
            "[plugins.classify.classify]\npath = {:?}\n[plugins.shape]\norder = ['deleted-bodies', 'test-bodies', 'removed-runs', 'context']\n[plugins.shape.context]\npath = {:?}\n[plugins.shape.deleted-bodies]\npath = {:?}\nmin_lines = 3\n[plugins.shape.test-bodies]\npath = {:?}\nmin_lines = 2\n[plugins.shape.removed-runs]\npath = {:?}\n",
            root().join("plugins/classify").display().to_string(),
            plugin("context"),
            plugin("deleted-bodies"),
            plugin("test-bodies"),
            plugin("removed-runs")
        ),
    );

    let bundled = sorted(&fixture.run(&bundled, &base, &head));
    let wasm = sorted(&fixture.run(&wasm, &base, &head));
    assert_eq!(bundled.1.len(), 7);
    // The runs shape something, so that equal streams mean something.
    let mut collapsed = Vec::new();
    for record in &bundled.1 {
        for side in ["lhs", "rhs"] {
            let mut regions = Vec::new();
            walk(&record["diff"][side]["root"]["children"], &mut regions);
            collapsed.extend(
                regions
                    .into_iter()
                    .filter(|region| region["visibility"]["collapsed"] == true)
                    .filter_map(|region| region["visibility"]["label"].as_str()),
            );
        }
    }
    assert!(collapsed
        .iter()
        .any(|label| label.ends_with(" unchanged lines")));
    for label in ["test body", "test module", "4 lines removed"] {
        assert!(collapsed.contains(&label), "{label}: {collapsed:?}");
    }
    assert_eq!(bundled, wasm);
}
