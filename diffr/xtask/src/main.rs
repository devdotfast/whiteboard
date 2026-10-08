//! Repository build and installation tasks.
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

fn cargo() -> Command {
    Command::new(std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into()))
}

fn run(command: &mut Command, description: &str) -> Result<()> {
    let status = command.status().with_context(|| description.to_owned())?;
    anyhow::ensure!(status.success(), "{description} failed ({status})");
    Ok(())
}

fn install(root: &Path, with_cli: bool) -> Result<()> {
    let mut args = std::env::args_os().skip(2);
    let destination = match args.next() {
        Some(flag) if flag == "--root" => {
            PathBuf::from(args.next().context("--root needs a directory")?)
        }
        Some(_) => bail!("usage: cargo xtask install[-tui] [--root <directory>]"),
        None => std::env::var_os("CARGO_INSTALL_ROOT")
            .or_else(|| std::env::var_os("CARGO_HOME"))
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                    .map(|home| PathBuf::from(home).join(".cargo"))
            })
            .context("Cannot determine install directory; pass --root <directory>")?,
    };
    anyhow::ensure!(args.next().is_none(), "unexpected install argument");
    let destination = std::path::absolute(destination)?;
    let bun = std::env::var_os("DIFFR_BUN").unwrap_or_else(|| "bun".into());
    let version = Command::new(&bun).arg("--version").output()
        .context("Bun was not found or could not be run. Install Bun (https://bun.sh) and put it on PATH, or set DIFFR_BUN to its executable. Bun is only needed during installation.")?;
    anyhow::ensure!(
        version.status.success(),
        "Bun --version failed; check your Bun installation"
    );
    run(
        Command::new(&bun)
            .current_dir(root.join("tui"))
            .args(["install", "--frozen-lockfile"]),
        "Installing TUI dependencies",
    )?;
    let artifact = root
        .join("target/tui")
        .join(format!("diffr-tui{}", std::env::consts::EXE_SUFFIX));
    std::fs::create_dir_all(artifact.parent().unwrap())?;
    run(
        Command::new(&bun)
            .current_dir(root.join("tui"))
            .args([
                "build",
                "--compile",
                "--define",
                if cfg!(target_env = "musl") {
                    "process.env.OPENTUI_LIBC=\"musl\""
                } else {
                    "process.env.OPENTUI_LIBC=\"glibc\""
                },
                "packages/hunk/src/main.tsx",
                "--outfile",
            ])
            .arg(&artifact),
        "Compiling diffr-tui",
    )?;
    if with_cli {
        run(
            cargo()
                .current_dir(root)
                .args(["install", "--path", ".", "--locked", "--timings", "--root"])
                .arg(&destination),
            "Installing diffr",
        )?;
    }
    let bin = destination.join("bin");
    std::fs::create_dir_all(&bin)?;
    let installed = bin.join(artifact.file_name().unwrap());
    // Copy then rename so a failed copy cannot truncate the installed executable.
    let staged = bin.join(format!(
        ".diffr-tui-{}{}",
        std::process::id(),
        std::env::consts::EXE_SUFFIX
    ));
    std::fs::copy(&artifact, &staged)?;
    std::fs::rename(&staged, &installed)
        .with_context(|| format!("installing {}", installed.display()))?;
    eprintln!(
        "Installed {}. Ensure {} is on PATH. Bun is not needed at runtime.",
        installed.display(),
        bin.display()
    );
    Ok(())
}

fn build_plugins(root: &Path) -> Result<()> {
    let output = cargo()
        .current_dir(root.join("plugins/workspace"))
        .args(["metadata", "--format-version", "1", "--no-deps", "--locked"])
        .output()?;
    anyhow::ensure!(
        output.status.success(),
        "cargo metadata failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let metadata: Value = serde_json::from_slice(&output.stdout)?;
    let members = metadata["workspace_members"]
        .as_array()
        .context("workspace members")?;
    let built = cargo()
        // Host coverage/target flags must not change the component build.
        .env_remove("RUSTFLAGS")
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .env_remove("CARGO_BUILD_TARGET")
        .current_dir(root.join("plugins/workspace"))
        .args([
            "build",
            "--locked",
            "--release",
            "--workspace",
            "--message-format=json",
        ])
        .output()?;
    anyhow::ensure!(
        built.status.success(),
        "building plugins failed:\n{}\n{}",
        String::from_utf8_lossy(&built.stderr),
        String::from_utf8_lossy(&built.stdout)
    );
    for package in metadata["packages"]
        .as_array()
        .context("workspace packages")?
    {
        if !members.contains(&package["id"]) {
            continue;
        }
        let name = package["name"].as_str().context("package name")?;
        let folder = Path::new(package["manifest_path"].as_str().context("manifest path")?)
            .parent()
            .context("Rust package directory")?
            .parent()
            .context("plugin folder")?;
        // Test-only components have no installable plugin folder.
        if !folder.join("plugin.toml").is_file() {
            continue;
        }
        let artifact = wasm_artifact(&built.stdout, &package["id"])?;
        eprintln!("Built plugin {name}");
        std::fs::copy(&artifact, folder.join("plugin.wasm"))
            .with_context(|| format!("copying {}", artifact.display()))?;
    }
    Ok(())
}

fn wasm_artifact(output: &[u8], package_id: &Value) -> Result<PathBuf> {
    for line in output
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let message: Value = serde_json::from_slice(line)?;
        if message["reason"] != "compiler-artifact" || &message["package_id"] != package_id {
            continue;
        }
        for filename in message["filenames"].as_array().into_iter().flatten() {
            if let Some(path) = filename.as_str().map(PathBuf::from) {
                if path
                    .extension()
                    .is_some_and(|extension| extension == "wasm")
                {
                    return Ok(path);
                }
            }
        }
    }
    bail!("Cargo did not report a WASM artifact for {package_id}")
}

/// Build diffr-core for `wasm32-unknown-unknown`, the target a browser runs.
///
/// tree-sitter-language ships the libc headers tree-sitter and the grammars
/// compile against there; grammar crates that do not add them get them from
/// `CFLAGS`. Its libc sources (`wasm-src`) are a scanner heap for
/// tree-sitter's own wasm runtime, so they are replaced by
/// `crates/diffr-core/wasm/src`, with `malloc` and friends from Rust (see
/// diffr-core's `wasm_libc.rs`). `crates/diffr-core/wasm` also fills what a
/// few scanners use beyond those headers. macOS's `ar` writes no index a
/// wasm linker reads, so the archives are made with rustup's `llvm-ar`.
fn build_core_wasm(root: &Path) -> Result<()> {
    wasm_cargo(
        root,
        &["build", "--locked", "--release", "--package", "diffr-core"],
    )
}

/// Run cargo with `args` for `wasm32-unknown-unknown`, set up as
/// [`build_core_wasm`] describes.
fn wasm_cargo(root: &Path, args: &[&str]) -> Result<()> {
    let target = "wasm32-unknown-unknown";
    let output = cargo()
        .current_dir(root)
        .args(["metadata", "--format-version", "1", "--locked"])
        .output()?;
    anyhow::ensure!(
        output.status.success(),
        "cargo metadata failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let metadata: Value = serde_json::from_slice(&output.stdout)?;
    let language = metadata["packages"]
        .as_array()
        .context("packages")?
        .iter()
        .find(|package| package["name"] == "tree-sitter-language")
        .context("tree-sitter-language is not a dependency")?;
    let headers = Path::new(
        language["manifest_path"]
            .as_str()
            .context("manifest path")?,
    )
    .parent()
    .context("tree-sitter-language directory")?
    .join("wasm/include");
    let compat = root.join("crates/diffr-core/wasm");
    let libc = compat.join("src");
    // Grammar build scripts rerun when CFLAGS change, not when a header they
    // include does, so the shims' hash is part of the flags.
    let mut hasher = std::hash::DefaultHasher::new();
    for file in [
        "compat.h",
        "include/sys/types.h",
        "include/wchar.h",
        "src/stdio.c",
        "src/stdlib.c",
        "src/string.c",
    ] {
        std::hash::Hash::hash(&std::fs::read(compat.join(file))?, &mut hasher);
    }
    let cflags = format!(
        "-I{} -I{} -include {} -DDIFFR_WASM_COMPAT={:x}",
        headers.display(),
        compat.join("include").display(),
        compat.join("compat.h").display(),
        std::hash::Hasher::finish(&hasher)
    );
    run(
        cargo()
            .current_dir(root)
            .args(args)
            .args(["--target", target, "--config"])
            .arg(format!(
                "target.{target}.tree-sitter-language.wasm-headers={:?}",
                headers.display().to_string()
            ))
            .arg("--config")
            .arg(format!(
                "target.{target}.tree-sitter-language.wasm-src={:?}",
                libc.display().to_string()
            ))
            .env("AR_wasm32_unknown_unknown", llvm_ar()?)
            .env("CFLAGS_wasm32_unknown_unknown", cflags),
        "Running cargo for wasm32-unknown-unknown (needs `rustup target add wasm32-unknown-unknown` and clang)",
    )
}

/// Build diffr-web for the browser and generate its bindings into `out_dir`
/// (by default `target/diffr-web`), where a page imports them. Needs
/// `cargo install wasm-bindgen-cli` at the crate's wasm-bindgen version.
fn build_web(root: &Path, out_dir: &Path) -> Result<()> {
    wasm_cargo(
        root,
        &["build", "--locked", "--release", "--package", "diffr-web"],
    )?;
    run(
        Command::new("wasm-bindgen")
            .current_dir(root)
            .args(["--target", "web", "--out-dir"])
            .arg(out_dir)
            .arg("target/wasm32-unknown-unknown/release/diffr_web.wasm"),
        "Running wasm-bindgen (install it with `cargo install wasm-bindgen-cli --version 0.2.129`)",
    )
}

/// rustup's `llvm-ar`, from the `llvm-tools` component.
fn llvm_ar() -> Result<PathBuf> {
    let rustc = |args: &[&str]| -> Result<String> {
        let output = Command::new("rustc").args(args).output()?;
        anyhow::ensure!(output.status.success(), "rustc {args:?} failed");
        Ok(String::from_utf8(output.stdout)?.trim().to_owned())
    };
    let sysroot = rustc(&["--print", "sysroot"])?;
    let host = rustc(&["-vV"])?
        .lines()
        .find_map(|line| line.strip_prefix("host: ").map(str::to_owned))
        .context("rustc -vV names no host")?;
    let ar = Path::new(&sysroot)
        .join("lib/rustlib")
        .join(host)
        .join("bin")
        .join(format!("llvm-ar{}", std::env::consts::EXE_SUFFIX));
    anyhow::ensure!(
        ar.is_file(),
        "{} not found; install it with `rustup component add llvm-tools`",
        ar.display()
    );
    Ok(ar)
}

fn main() -> Result<()> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let task = std::env::args().nth(1).unwrap_or_default();
    match task.as_str() {
        "install" => install(root, true),
        "install-tui" => install(root, false),
        "build-plugins" => build_plugins(root),
        "build-core-wasm" => build_core_wasm(root),
        "build-web" => {
            let out_dir = match std::env::args().nth(2).as_deref() {
                Some("--out-dir") => PathBuf::from(
                    std::env::args()
                        .nth(3)
                        .context("--out-dir needs a directory")?,
                ),
                Some(other) => bail!("unexpected argument {other}"),
                None => root.join("target/diffr-web"),
            };
            build_web(root, &out_dir)
        }
        "wasm" => {
            let args: Vec<String> = std::env::args().skip(2).collect();
            wasm_cargo(root, &args.iter().map(String::as_str).collect::<Vec<_>>())
        }
        "test-plugins" => {
            build_plugins(root)?;
            let status = cargo()
                .current_dir(root)
                .args([
                    "test",
                    "--locked",
                    "--bin",
                    "diffr",
                    "--test",
                    "wasm",
                    "--test",
                    "wasm_concurrency",
                ])
                .status()?;
            anyhow::ensure!(status.success(), "plugin tests failed");
            Ok(())
        }
        _ => bail!("usage: cargo xtask <install|install-tui|build-plugins|build-core-wasm|build-web [--out-dir DIR]|wasm|test-plugins>"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selects_the_reported_artifact_for_the_requested_package() {
        let output =
            br#"{"reason":"compiler-artifact","package_id":"other","filenames":["other.wasm"]}
{"reason":"compiler-artifact","package_id":"mine","filenames":["some/custom_name.wasm"]}
"#;
        assert_eq!(
            wasm_artifact(output, &Value::from("mine")).unwrap(),
            PathBuf::from("some/custom_name.wasm")
        );
        assert!(wasm_artifact(output, &Value::from("missing")).is_err());
    }
}
