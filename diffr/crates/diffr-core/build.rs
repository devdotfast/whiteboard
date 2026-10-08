// Clippy errors in this file should not stop build errors being
// reported elsewhere.
// https://github.com/rust-lang/rust-clippy/issues/9534
#![warn(clippy::all)]
// Has false positives on else if chains that sometimes have the same
// body for readability.
#![allow(clippy::if_same_then_else)]

use std::path::PathBuf;

/// Embed the component, manifest and queries from every bundled shape plugin
/// folder under `plugins/shape/`, the language queries in `src/parse/queries/`,
/// and the classifier in `plugins/classify/`.
fn main() {
    let root = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    println!("cargo:rerun-if-changed={}", root.join("plugins").display());
    let mut files = String::from("const FILES: &[(&str, &str)] = &[\n");
    let mut components = String::from("const COMPONENTS: &[(&str, &[u8])] = &[\n");
    embed_queries(&root.join("src/parse/queries"), "core/queries", &mut files);
    embed_queries(
        &root.join("plugins/shape/shared/queries"),
        "shared/queries",
        &mut files,
    );
    let mut folders: Vec<_> = std::fs::read_dir(root.join("plugins/shape"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|folder| folder.join("plugin.toml").is_file())
        .collect();
    folders.sort();
    for folder in folders {
        let plugin_manifest = folder.join("plugin.toml");
        let description: toml::Value = std::fs::read_to_string(&plugin_manifest)
            .expect("a plugin has plugin.toml")
            .parse()
            .unwrap();
        let name = description["name"].as_str().expect("plugin name");
        println!("cargo:rerun-if-changed={}", plugin_manifest.display());
        files.push_str(&format!(
            "    ({:?}, include_str!({:?})),\n",
            format!("{name}/plugin.toml"),
            plugin_manifest
        ));
        embed_queries(
            &folder.join("queries"),
            &format!("{name}/queries"),
            &mut files,
        );
        let wasm = folder.join("plugin.wasm");
        println!("cargo:rerun-if-changed={}", wasm.display());
        components.push_str(&format!("    ({name:?}, include_bytes!({wasm:?})),\n"));
    }
    files.push_str("];\n");
    components.push_str("];\n");
    files.push_str(&components);
    let classifier = root.join("plugins/classify");
    for file in ["plugin.toml", "plugin.wasm"] {
        println!("cargo:rerun-if-changed={}", classifier.join(file).display());
    }
    files.push_str(&format!(
        "const CLASSIFIER_MANIFEST: &str = include_str!({:?});\nconst CLASSIFIER_COMPONENT: &[u8] = include_bytes!({:?});\n",
        classifier.join("plugin.toml"),
        classifier.join("plugin.wasm"),
    ));
    std::fs::write(
        PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("bundled_assets.rs"),
        files,
    )
    .unwrap();
}

/// Embed query assets without maintaining a second file list in the host.
fn embed_queries(directory: &std::path::Path, prefix: &str, code: &mut String) {
    if !directory.exists() {
        println!(
            "cargo:rerun-if-changed={}",
            directory.parent().unwrap().display()
        );
        return;
    }
    println!("cargo:rerun-if-changed={}", directory.display());
    let mut entries: Vec<_> = std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        let name = format!("{prefix}/{}", path.file_name().unwrap().to_str().unwrap());
        if path.is_dir() {
            embed_queries(&path, &name, code);
        } else if path.extension().is_some_and(|extension| extension == "scm") {
            code.push_str(&format!("    ({name:?}, include_str!({path:?})),\n"));
        }
    }
}
