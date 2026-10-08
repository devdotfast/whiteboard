mod support;

use std::io::Write;
use std::process::{Command, Stdio};
use support::get_base_command;

use assert_cmd::prelude::*;
use predicates::prelude::*;

fn debug_command() -> Command {
    let mut cmd = get_base_command();
    cmd.arg("debug");
    cmd
}

#[test]
fn list_languages() {
    let mut cmd = debug_command();

    cmd.arg("--list-languages");

    let predicate_fn = predicate::str::contains("TOML");
    cmd.assert().stdout(predicate_fn);

    let predicate_fn = predicate::str::contains("*.toml");
    cmd.assert().stdout(predicate_fn);
}

#[test]
fn dump_tree_sitter() {
    let mut cmd = debug_command();

    cmd.arg("--dump-ts").arg("sample_files/simple_1.js");
    cmd.assert().success();
}

#[test]
fn dump_syntax() {
    let mut cmd = debug_command();

    cmd.arg("--dump-syntax").arg("sample_files/simple_1.js");
    cmd.assert().success();
}

#[test]
fn a_comparison_without_format_needs_a_terminal() {
    let mut cmd = get_base_command();

    cmd.args([
        "--no-index",
        "sample_files/simple_1.js",
        "sample_files/simple_2.js",
    ]);
    cmd.assert()
        .failure()
        .code(2)
        .stderr(predicate::str::contains("--format ndjson"));
}

#[test]
fn text_output_is_gone() {
    let mut cmd = get_base_command();

    cmd.args([
        "--format",
        "text",
        "--no-index",
        "sample_files/simple_1.js",
        "sample_files/simple_2.js",
    ]);
    cmd.assert().failure();
}

#[test]
fn a_summarizer_without_a_key_still_diffs() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("diffr/config.toml");
    std::fs::create_dir_all(config.parent().unwrap()).unwrap();
    std::fs::write(
        &config,
        "[plugins.shape.bundled.summarize]\nenabled = true\n",
    )
    .unwrap();
    let mut cmd = get_base_command();

    cmd.args([
        "--no-index",
        "sample_files/simple_1.js",
        "sample_files/simple_2.js",
        "--format",
        "ndjson",
    ])
    .env("XDG_CONFIG_HOME", dir.path())
    .env_remove("GEMINI_API_KEY")
    .env_remove("GOOGLE_API_KEY");
    cmd.assert().success().stderr(predicate::str::contains(
        "summarize: off for this run: no API key",
    ));
}

#[test]
fn config_ui_requires_a_terminal() {
    let mut cmd = get_base_command();
    cmd.arg("config");
    cmd.assert()
        .failure()
        .code(2)
        .stderr(predicate::str::contains("terminal UI needs a terminal"));
}

/// Invalid flag combinations are rejected while parsing, before the terminal
/// UI would launch.
#[test]
fn invalid_flag_combinations_are_rejected_before_the_terminal_ui() {
    for (args, message) in [
        (&["-z"][..], "<--name-only|--name-status>"),
        (&["--jobs", "0"], "invalid value '0' for '--jobs <JOBS>'"),
        (&["--syntax"], "--format <FORMAT>"),
        (
            &["--format", "ndjson", "--stat"],
            "cannot be used with '--stat'",
        ),
        (&["--syntax", "--stat"], "cannot be used with '--stat'"),
        (
            &["--no-index", "--cached", "a", "b"],
            "cannot be used with '--cached'",
        ),
    ] {
        get_base_command()
            .args(args)
            .assert()
            .failure()
            .code(2)
            .stderr(predicate::str::contains(message));
    }
}

#[test]
fn a_malformed_override_is_a_clap_error() {
    debug_command()
        .args(["--override=*.c:Nope", "--list-languages"])
        .assert()
        .failure()
        .code(2)
        .stderr(predicate::str::contains(
            "invalid value '*.c:Nope' for '--override <GLOB:NAME>': no such language 'Nope'",
        ));
}

#[test]
fn a_malformed_numbered_override_names_its_variable() {
    debug_command()
        .arg("--list-languages")
        .env("DFT_OVERRIDE_2", "bad")
        .assert()
        .failure()
        .code(2)
        .stderr(predicate::str::contains(
            "invalid value 'bad' for DFT_OVERRIDE_2: expected GLOB:LANG_NAME",
        ));
}

#[test]
fn debug_needs_exactly_one_action() {
    debug_command()
        .arg("--ignore-comments")
        .assert()
        .failure()
        .code(2)
        .stderr(predicate::str::contains(
            "the following required arguments were not provided",
        ));
    debug_command()
        .args(["--list-languages", "--dump-ts", "sample_files/simple_1.js"])
        .assert()
        .failure()
        .code(2)
        .stderr(predicate::str::contains("cannot be used with"));
}

#[test]
fn config_migration_and_typed_batch_set() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("diffr/config.toml");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(
        &file,
        "version = 1\n[plugins.bundled.summarize]\ninstances = 3\nsystem_prompt = 'My prompt'\n",
    )
    .unwrap();
    let mut command = get_base_command();
    command
        .env("XDG_CONFIG_HOME", dir.path())
        .args(["config", "migrate", "--json"]);
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["changed"], true);
    assert!(result["dropped"]
        .as_array()
        .unwrap()
        .contains(&serde_json::json!("plugins.bundled.summarize.instances")));

    let original = std::fs::read_to_string(&file).unwrap();
    for (patch, success) in [
        (
            r#"{"plugins":{"shape":{"bundled":{"summarize":{"provider":"openai","api_key":"new-key","model":"new-model"}}}}}"#,
            true,
        ),
        (
            r#"{"plugins":{"shape":{"bundled":{"context":{"lines":-1},"summarize":{"api_key":"private-key"}}}}}"#,
            false,
        ),
    ] {
        let before = std::fs::read_to_string(&file).unwrap();
        let mut command = get_base_command();
        let mut child = command
            .env("XDG_CONFIG_HOME", dir.path())
            .args(["config", "set", "-", "--json"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(patch.as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert_eq!(output.status.success(), success);
        let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert!(!String::from_utf8_lossy(&output.stdout).contains("private-key"));
        if success {
            assert_eq!(result["changed"], true);
        } else {
            assert_eq!(std::fs::read_to_string(&file).unwrap(), before);
            assert!(result["error"]["repair_prompt"].is_string());
        }
    }
    assert!(original.contains("My prompt"));
    assert!(std::fs::read_to_string(file).unwrap().contains("My prompt"));
}

#[test]
fn diffr_config_dir_takes_the_place_of_xdg_config_home() {
    let work = tempfile::tempdir().unwrap();
    let own = work.path().join("own");
    let xdg = work.path().join("xdg");
    let output = get_base_command()
        .env("DIFFR_CONFIG_DIR", &own)
        .env("XDG_CONFIG_HOME", &xdg)
        .args(["config", "set", "diff.byte_limit", "1234"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let written = std::fs::read_to_string(own.join("config.toml")).unwrap();
    assert!(written.contains("byte_limit = 1234"), "{written}");
    assert!(!xdg.exists());
}

#[test]
fn pprint_reads_a_file_or_stdin_without_a_frontend() {
    let work = tempfile::tempdir().unwrap();
    let config = work.path().join("config/diffr");
    std::fs::create_dir_all(&config).unwrap();
    std::fs::write(
        config.join("config.toml"),
        "[plugins.shape]\norder = ['bundled.context']\n",
    )
    .unwrap();
    let mut diff = get_base_command();
    let output = diff
        .env("XDG_CONFIG_HOME", work.path().join("config"))
        .args([
            "--format",
            "ndjson",
            "--no-index",
            "sample_files/simple_1.js",
            "sample_files/simple_2.js",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let input = work.path().join("diff.ndjson");
    std::fs::write(&input, &output.stdout).unwrap();
    let printer = || {
        let mut cmd = get_base_command();
        cmd.env("DIFFR_TUI_ENTRY", "missing-tui-entry")
            .env("DIFFR_BUN", "missing-bun");
        cmd.arg("pprint");
        cmd
    };
    let printed = printer().arg(&input).output().unwrap();
    assert!(
        printed.status.success(),
        "{}",
        String::from_utf8_lossy(&printed.stderr)
    );
    let text = String::from_utf8(printed.stdout.clone()).unwrap();
    assert!(
        text.contains("sample_files/simple_1.js → sample_files/simple_2.js"),
        "{text}"
    );
    assert!(text.contains("base → head"), "{text}");
    assert!(!text.contains('\u{1b}'));
    let mut stdin = printer()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    stdin
        .stdin
        .take()
        .unwrap()
        .write_all(&output.stdout)
        .unwrap();
    let stdin = stdin.wait_with_output().unwrap();
    assert!(
        stdin.status.success(),
        "{}",
        String::from_utf8_lossy(&stdin.stderr)
    );
    assert_eq!(stdin.stdout, printed.stdout);
    printer()
        .arg(&input)
        .args(["--open", "4294967295"])
        .assert()
        .failure()
        .code(2)
        .stderr(predicate::str::contains("unknown fold states"));
    std::fs::write(
        &input,
        output.stdout.split(|byte| *byte == b'\n').next().unwrap(),
    )
    .unwrap();
    printer()
        .arg(&input)
        .assert()
        .failure()
        .code(2)
        .stderr(predicate::str::contains("incomplete diff stream"));
}

#[test]
fn long_help_ends_with_a_guide_and_short_help_does_not() {
    for (args, guide) in [
        (&["--help"][..], "# Using diffr from an agent"),
        (&["config", "--help"][..], "# Plugin Architecture"),
    ] {
        get_base_command()
            .args(args)
            .assert()
            .success()
            .stdout(predicate::str::contains(guide));
        let short: Vec<_> = args.iter().map(|arg| arg.replace("--help", "-h")).collect();
        get_base_command()
            .args(&short)
            .assert()
            .success()
            .stdout(predicate::str::contains(guide).not());
    }
}
