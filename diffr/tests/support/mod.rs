//! Helpers shared by the integration tests.
use std::process::Command;

fn find_runner() -> Option<String> {
    for (key, value) in std::env::vars() {
        if key.starts_with("CARGO_TARGET_") && key.ends_with("_RUNNER") && !value.is_empty() {
            return Some(value);
        }
    }
    None
}

// Sample code from
// https://github.com/assert-rs/assert_cmd/issues/139, supports
// cross-compiled binaries.
pub fn get_base_command() -> Command {
    let mut cmd;
    let path = assert_cmd::cargo_bin!("diffr");
    if let Some(runner) = find_runner() {
        let mut runner = runner.split_whitespace();
        cmd = Command::new(runner.next().unwrap());
        for arg in runner {
            cmd.arg(arg);
        }
        cmd.arg(path);
    } else {
        cmd = Command::new(path);
    }
    cmd
}
