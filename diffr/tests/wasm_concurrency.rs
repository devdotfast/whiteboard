//! End-to-end concurrency through generated WIT bindings, the host, WASIp3 and NDJSON.
//! A's HTTP response is held until B's finished file has been read from stdout.
//! One CPU worker must make progress while a callback on the shared component awaits HTTP.
use anyhow::{Context, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::Notify;

fn build_guest() -> &'static Path {
    static ARTIFACT: OnceLock<PathBuf> = OnceLock::new();
    ARTIFACT.get_or_init(|| {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let target = root.join("target/concurrent-guest-probe");
        let output = std::process::Command::new(env!("CARGO"))
            .env_remove("RUSTFLAGS")
            .env_remove("CARGO_ENCODED_RUSTFLAGS")
            .env_remove("CARGO_BUILD_TARGET")
            .current_dir(root.join("plugins/workspace"))
            .args([
                "build",
                "--locked",
                "--package",
                "concurrent-guest-probe",
                "--target-dir",
            ])
            .arg(&target)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        target.join("wasm32-wasip2/debug/concurrent_guest_probe.wasm")
    })
}

mod git_fixture;
fn commit(repo: &gix::Repository) -> String {
    git_fixture::commit(repo, "fixture")
}

fn labels(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(fields) => {
            if let Some(label) = fields.get("label").and_then(Value::as_str) {
                out.push(label.to_owned());
            }
            for value in fields.values() {
                labels(value, out);
            }
        }
        Value::Array(values) => {
            for value in values {
                labels(value, out);
            }
        }
        _ => {}
    }
}

async fn run_case(outcome: &'static str) -> Result<()> {
    let dir = tempfile::tempdir()?;
    let repo_path = dir.path().join("repo");
    let repo = gix::init(&repo_path)?;
    let base = commit(&repo);
    for name in ["a", "b"] {
        std::fs::write(repo_path.join(format!("{name}.txt")), "one\ntwo\n")?;
    }
    let head = commit(&repo);
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let endpoint = format!("http://{}", listener.local_addr()?);
    let a_received = Arc::new(Notify::new());
    let release_a = Arc::new(Notify::new());
    let server = {
        let a_received = a_received.clone();
        let release_a = release_a.clone();
        tokio::spawn(async move {
            let mut requests = Vec::new();
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().await?;
                let a_received = a_received.clone();
                let release_a = release_a.clone();
                requests.push(tokio::spawn(async move {
                    let mut header = Vec::new();
                    while !header.ends_with(b"\r\n\r\n") {
                        anyhow::ensure!(header.len() < 16384, "HTTP headers too large");
                        header.push(socket.read_u8().await?);
                    }
                    let header = String::from_utf8(header)?;
                    let is_a = header.starts_with("GET /a.txt ");
                    let text = if is_a {
                        a_received.notify_one();
                        release_a.notified().await;
                        outcome
                    } else {
                        // B may arrive first, but it cannot finish before A has started waiting.
                        a_received.notified().await;
                        "B"
                    };
                    socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len()).as_bytes()).await?;
                    socket.shutdown().await?;
                    Ok::<_, anyhow::Error>(())
                }));
            }
            for request in requests {
                request.await??;
            }
            Ok::<_, anyhow::Error>(())
        })
    };
    let home = dir.path().join("home");
    let config_home = dir.path().join("config");
    std::fs::create_dir_all(&home)?;
    std::fs::create_dir_all(config_home.join("diffr"))?;
    let plugin = dir.path().join("plugin");
    std::fs::create_dir(&plugin)?;
    std::fs::copy(build_guest(), plugin.join("plugin.wasm"))?;
    std::fs::write(
        plugin.join("plugin.toml"),
        "name='probe'\ntitle='Probe'\n[options.endpoint]\ntype='string'\ntitle='Endpoint'\n",
    )?;
    let config = format!(
        "[plugins.shape]\norder=['probe']\n[plugins.shape.probe]\npath={:?}\nendpoint={endpoint:?}\n",
        plugin.to_string_lossy()
    );
    std::fs::write(config_home.join("diffr/config.toml"), config)?;
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_diffr"))
        .args(["--repo"])
        .arg(&repo_path)
        .args([&base, &head, "--format", "ndjson", "--jobs", "1"])
        .env("HOME", &home)
        .env("XDG_CONFIG_HOME", &config_home)
        .env_remove("GIT_DIR")
        .env_remove("GEMINI_API_KEY")
        .env_remove("GOOGLE_API_KEY")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let mut stderr = child.stderr.take().unwrap();
    let errors = tokio::spawn(async move {
        let mut out = String::new();
        stderr.read_to_string(&mut out).await.unwrap();
        out
    });
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut records = Vec::new();
    let mut emitted = Vec::new();
    while let Some(line) = lines.next_line().await? {
        let record: Value = serde_json::from_str(&line)?;
        if record["type"] == "file" {
            let path = record["file"]["rhs"]["path"]
                .as_str()
                .context("file path")?;
            if emitted.is_empty() {
                assert_eq!(path, "b.txt", "A must wait for its own response");
                let mut found = Vec::new();
                labels(&record["diff"], &mut found);
                assert!(
                    found.iter().any(|s| s == "B" || s.starts_with("B:")),
                    "{found:?}"
                );
                release_a.notify_one(); // Only after the completely edited B is emitted.
            }
            emitted.push(path.to_owned());
        }
        records.push(record);
    }
    let status = child.wait().await?;
    let errors = errors.await?;
    let success = outcome == "A" || outcome == "recover";
    assert_eq!(status.success(), success, "{errors}");
    assert_eq!(records.first().unwrap()["type"], "start");
    let footer = records.last().unwrap();
    assert_eq!(footer["type"], "complete", "{records:?}; {errors}");
    assert_eq!(footer["succeeded"], if success { 2 } else { 1 });
    assert_eq!(footer["failed"], if success { 0 } else { 1 });
    assert_eq!(emitted.len(), if success { 2 } else { 1 });
    if success {
        assert_eq!(emitted, ["b.txt", "a.txt"]);
        let mut found = Vec::new();
        for record in &records {
            labels(&record["diff"], &mut found);
        }
        assert!(found.iter().any(|s| s.starts_with("A:")), "{found:?}");
        assert!(found.iter().any(|s| s.starts_with("B:")), "{found:?}");
    } else {
        assert_eq!(
            footer["aborted"]["code"], "mutation_failed",
            "{footer}; {errors}"
        );
    }
    server.await??;
    Ok(())
}

#[test]
fn generated_bindings_component_overlaps_http_and_never_emits_partial_files() -> Result<()> {
    build_guest();
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(async {
            for outcome in ["A", "recover", "fail", "edit-error", "trap"] {
                // Ordering is enforced by the server's notifications, so this
                // only catches a hang. A CI runner compiling the component in a
                // debug build beside the other test can take over thirty seconds.
                tokio::time::timeout(Duration::from_secs(180), run_case(outcome))
                    .await
                    .with_context(|| {
                        format!("component overlap/emission case {outcome} timed out")
                    })??;
            }
            Ok(())
        })
}

/// A plugin computing without awaiting holds its own worker only: with two
/// workers, A and B compute at the same time. One worker could not overlap
/// them, since a callback that never awaits never lets another run.
#[test]
fn two_workers_compute_two_files_at_once() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let repo_path = dir.path().join("repo");
    let repo = gix::init(&repo_path)?;
    let base = commit(&repo);
    for name in ["a", "b"] {
        std::fs::write(repo_path.join(format!("{name}.txt")), "one\ntwo\n")?;
    }
    let head = commit(&repo);
    let plugin = dir.path().join("plugin");
    std::fs::create_dir(&plugin)?;
    std::fs::copy(build_guest(), plugin.join("plugin.wasm"))?;
    std::fs::write(
        plugin.join("plugin.toml"),
        "name='probe'\ntitle='Probe'\n[options.endpoint]\ntype='string'\ntitle='Endpoint'\n[options.spin_ms]\ntype='integer'\ntitle='Spin'\n",
    )?;
    let home = dir.path().join("home");
    let config_home = dir.path().join("config");
    std::fs::create_dir_all(&home)?;
    std::fs::create_dir_all(config_home.join("diffr"))?;
    std::fs::write(
        config_home.join("diffr/config.toml"),
        format!(
            "[plugins.shape]\norder=['probe']\n[plugins.shape.probe]\npath={:?}\nendpoint='http://unused'\nspin_ms=1000\n",
            plugin.to_string_lossy()
        ),
    )?;
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_diffr"))
        .args(["--repo"])
        .arg(&repo_path)
        .args([&base, &head, "--format", "ndjson", "--jobs", "2"])
        .env("HOME", &home)
        .env("XDG_CONFIG_HOME", &config_home)
        .env_remove("GIT_DIR")
        .output()?;
    let errors = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{errors}");
    let mut spans = Vec::new();
    for line in String::from_utf8(output.stdout)?.lines() {
        let record: Value = serde_json::from_str(line)?;
        if record["type"] == "file" {
            let mut found = Vec::new();
            labels(&record["diff"], &mut found);
            let label = found
                .iter()
                .find_map(|label| label.strip_prefix("spun:"))
                .context("spun label")?;
            let span: Vec<u128> = label.split(':').map(str::parse).collect::<Result<_, _>>()?;
            spans.push((span[0], span[1]));
        }
    }
    let [(a_start, a_end), (b_start, b_end)] = spans[..] else {
        panic!("two files: {spans:?}; {errors}");
    };
    assert!(
        a_start < b_end && b_start < a_end,
        "the files computed one after the other: {spans:?}"
    );
    Ok(())
}
