//! Git is the independent oracle for comparison enumeration and line counts.
mod git_fixture;
mod support;

use git_fixture::{commit, git};
use std::{
    fs,
    io::Write,
    path::Path,
    process::{Output, Stdio},
};

fn diffr(path: &Path, args: &[&str]) -> Output {
    support::get_base_command()
        .arg("--repo")
        .arg(path)
        .args(args)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env("HOME", path.parent().unwrap())
        .env("XDG_CONFIG_HOME", path.parent().unwrap().join("config"))
        .output()
        .unwrap()
}

fn text(output: Output) -> String {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn statuses(text: &str) -> Vec<String> {
    text.lines()
        .map(|line| {
            let (status, paths) = line.split_once('\t').unwrap();
            // diffr's name-status prints R, not Git's R<similarity>.
            format!("{}\t{paths}", &status[..1])
        })
        .collect()
}

#[test]
fn invalid_revision_range_is_rejected_before_the_terminal_ui() {
    let dir = tempfile::tempdir().unwrap();
    let repo = gix::init(dir.path()).unwrap();
    commit(&repo, "base");
    commit(&repo, "head");

    let output = diffr(dir.path(), &["HEAD^2..HEAD"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        stderr.contains("unknown revision or path \"HEAD^2..HEAD\""),
        "{stderr}"
    );

    let output = diffr(dir.path(), &["HEAD^..HEAD"]);
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("terminal UI needs a terminal"), "{stderr}");
}

#[test]
fn revisions_index_worktree_reverse_paths_and_stats_match_git() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    let repo = gix::init(&root).unwrap();
    fs::create_dir(root.join("sub")).unwrap();
    fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
    fs::write(root.join("sub/old.txt"), "retained\n").unwrap();
    let base = commit(&repo, "base");
    fs::write(root.join("a.txt"), "one\nthree\n").unwrap();
    fs::rename(root.join("sub/old.txt"), root.join("sub/new.txt")).unwrap();
    let head = commit(&repo, "head");
    fs::write(root.join("a.txt"), "staged\n").unwrap();
    fs::write(root.join("b.txt"), "new staged file\n").unwrap();
    git(&root, &["add", "-A"]);
    // The staged change to a.txt is completely reverted in the worktree.
    fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
    fs::write(root.join("b.txt"), "new worktree file\n").unwrap();
    fs::write(root.join("untracked.txt"), "not in this diff\n").unwrap();
    for args in [
        vec![],
        vec![base.as_str()],
        vec![base.as_str(), head.as_str()],
        vec!["--cached"],
        vec!["--cached", base.as_str()],
        vec!["-R", base.as_str()],
        vec![head.as_str(), base.as_str()],
        vec![base.as_str(), head.as_str(), "--", "sub"],
        vec!["--no-renames", base.as_str(), head.as_str()],
    ] {
        for mode in ["--name-status", "--numstat", "--shortstat"] {
            // diffr keeps libgit2's uncompressed rename path in numstat.
            let expected = git(&root, &[vec!["diff", mode], args.clone()].concat())
                .replace("sub/{old.txt => new.txt}", "sub/old.txt => sub/new.txt")
                .replace("sub/{new.txt => old.txt}", "sub/new.txt => sub/old.txt");
            let actual = text(diffr(&root, &[vec![mode], args.clone()].concat()));
            if mode == "--name-status" {
                assert_eq!(statuses(&actual), statuses(&expected), "{mode} {args:?}");
            } else {
                assert_eq!(actual, expected, "{mode} {args:?}");
            }
        }
    }
}

#[test]
fn unborn_index_and_binary_additions_work() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    gix::init(&root).unwrap();
    fs::write(root.join("binary.dat"), b"one\0two").unwrap();
    git(&root, &["add", "-A"]);
    assert_eq!(
        text(diffr(&root, &["--cached", "--name-status"])),
        "A\tbinary.dat"
    );
    assert_eq!(
        text(diffr(&root, &["--cached", "--numstat"])),
        "-\t-\tbinary.dat"
    );
}

#[test]
fn unmerged_is_a_file_error_and_other_files_finish() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    let repo = gix::init(&root).unwrap();
    fs::write(root.join("conflict.txt"), "base\n").unwrap();
    fs::write(root.join("other.txt"), "base\n").unwrap();
    let base = commit(&repo, "base");
    let id = git(&root, &["rev-parse", &format!("{base}:conflict.txt")]);
    let mut child = std::process::Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["update-index", "--index-info"])
        .env_remove("GIT_DIR")
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    writeln!(input, "0 {}\tconflict.txt", "0".repeat(40)).unwrap();
    for stage in 1..=3 {
        writeln!(input, "100644 {id} {stage}\tconflict.txt").unwrap();
    }
    drop(input);
    assert!(child.wait().unwrap().success());
    fs::write(root.join("other.txt"), "changed\n").unwrap();
    let output = diffr(&root, &["--format", "ndjson", "--jobs", "1"]);
    assert_eq!(
        output.status.code(),
        Some(2),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let events: Vec<serde_json::Value> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert!(
        events
            .iter()
            .any(|event| event["error"]["code"] == "unmerged"),
        "{events:?}"
    );
    assert!(events
        .iter()
        .any(|event| event["file"]["rhs"]["path"] == "other.txt" && event.get("diff").is_some()));
    assert_eq!(events.last().unwrap()["failed"], 1);
    assert!(events.last().unwrap().get("aborted").is_none());
}

#[test]
fn filtered_worktree_reversion_is_not_reported_as_a_change() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    let repo = gix::init(&root).unwrap();
    fs::write(root.join(".gitattributes"), "*.txt text eol=crlf\n").unwrap();
    fs::write(root.join("a.txt"), "base\n").unwrap();
    let base = commit(&repo, "base");
    fs::write(root.join("a.txt"), "staged\n").unwrap();
    git(&root, &["add", "a.txt"]);
    fs::write(root.join("a.txt"), "base\r\n").unwrap();
    assert_eq!(text(diffr(&root, &[&base, "--name-status"])), "");
    assert_eq!(
        text(diffr(&root, &[&base, "--shortstat"])),
        "0 files changed, 0 insertions(+), 0 deletions(-)"
    );
}

#[cfg(unix)]
#[test]
fn symlinks_and_type_changes_remain_in_the_manifest() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    let repo = gix::init(&root).unwrap();
    fs::write(root.join("file"), "regular\n").unwrap();
    let base = commit(&repo, "base");
    fs::remove_file(root.join("file")).unwrap();
    std::os::unix::fs::symlink("target", root.join("file")).unwrap();
    assert_eq!(text(diffr(&root, &[&base, "--name-status"])), "T\tfile");
    let output = diffr(&root, &[&base, "--format", "ndjson"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8(output.stdout)
        .unwrap()
        .contains("unsupported_file_type"));
}

#[test]
fn three_dot_uses_the_merge_base() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    let repo = gix::init(&root).unwrap();
    fs::write(root.join("a.txt"), "base\n").unwrap();
    let base = commit(&repo, "base");
    git(&root, &["checkout", "-b", "left"]);
    fs::write(root.join("left.txt"), "left\n").unwrap();
    commit(&repo, "left");
    git(&root, &["checkout", "-b", "right", &base]);
    fs::write(root.join("right.txt"), "right\n").unwrap();
    commit(&repo, "right");
    let expected = git(&root, &["diff", "--name-status", "left...right"]);
    assert_eq!(
        text(diffr(&root, &["--name-status", "left...right"])),
        expected
    );
}

#[test]
fn intent_to_add_is_only_a_worktree_addition() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    let repo = gix::init(&root).unwrap();
    commit(&repo, "empty");
    fs::write(root.join("new.txt"), "new\n").unwrap();
    git(&root, &["add", "-N", "new.txt"]);
    assert_eq!(text(diffr(&root, &["--cached", "--name-status"])), "");
    assert_eq!(text(diffr(&root, &["--name-status"])), "A\tnew.txt");
}

#[test]
fn gitlinks_have_metadata_but_no_structural_diff() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    let repo = gix::init(&root).unwrap();
    fs::write(root.join("seed.txt"), "one\ntwo\nthree\n").unwrap();
    let base = commit(&repo, "base");
    git(
        &root,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("160000,{base},module"),
        ],
    );
    assert_eq!(
        text(diffr(&root, &["--cached", "--numstat"])),
        "1\t0\tmodule"
    );
    let output = diffr(&root, &["--cached", "--format", "ndjson"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8(output.stdout)
        .unwrap()
        .contains("unsupported_file_type"));
    git(&root, &["commit", "-qm", "gitlink"]);
    fs::write(root.join("module"), "one\ntwo\nthree\n").unwrap();
    git(&root, &["add", "module"]);
    assert_eq!(
        text(diffr(&root, &["--cached", "--numstat"])),
        "3\t1\tmodule"
    );
}

#[test]
fn commit_shorthands_compare_a_commit_with_its_parent_as_git_does() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    let repo = gix::init(&root).unwrap();
    fs::write(root.join("a.txt"), "base\n").unwrap();
    commit(&repo, "base");
    fs::write(root.join("b.txt"), "head\n").unwrap();
    commit(&repo, "head");
    // A dirty working tree, so reading `HEAD^!` as `HEAD^` against the working tree would show.
    fs::write(root.join("a.txt"), "dirty\n").unwrap();
    for spec in ["HEAD^!", "HEAD^-", "HEAD^-1"] {
        let expected = git(&root, &["diff", "--name-status", spec]);
        assert_eq!(expected, "A\tb.txt", "{spec}");
        assert_eq!(
            text(diffr(&root, &["--name-status", spec])),
            expected,
            "{spec}"
        );
    }
}

#[test]
fn every_parent_of_a_commit_is_not_one_comparison() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    let repo = gix::init(&root).unwrap();
    commit(&repo, "base");
    commit(&repo, "head");
    let output = diffr(&root, &["--name-status", "HEAD^@"]);
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        stderr.contains("\"HEAD^@\" names every parent of a commit"),
        "{stderr}"
    );
}

#[test]
fn a_merge_has_no_one_parent_to_compare_with() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    let repo = gix::init(&root).unwrap();
    commit(&repo, "base");
    git(&root, &["checkout", "-q", "-b", "side"]);
    fs::write(root.join("side.txt"), "side\n").unwrap();
    commit(&repo, "side");
    git(&root, &["checkout", "-q", "-"]);
    fs::write(root.join("main.txt"), "main\n").unwrap();
    commit(&repo, "main");
    git(&root, &["merge", "--no-edit", "-q", "side"]);
    let output = diffr(&root, &["--name-status", "HEAD^!"]);
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        stderr.contains("\"HEAD^!\" is a merge with 2 parents"),
        "{stderr}"
    );
    // Naming the parent, as the message says, is one comparison again.
    let expected = git(&root, &["diff", "--name-status", "HEAD^2", "HEAD"]);
    assert_eq!(
        text(diffr(&root, &["--name-status", "HEAD^2", "HEAD"])),
        expected
    );
}
