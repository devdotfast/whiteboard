//! Join each vendored Linguist pattern list into one regex at build time, as
//! Linguist does, so the component carries the pattern rather than a YAML
//! parser.
use std::path::PathBuf;

fn main() {
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("cargo sets OUT_DIR"));
    for name in ["vendor", "documentation"] {
        let source = format!("src/linguist/{name}.yml");
        println!("cargo:rerun-if-changed={source}");
        let yaml = std::fs::read_to_string(&source).expect("the vendored list is readable");
        let patterns: Vec<String> =
            serde_yaml_ng::from_str(&yaml).expect("the vendored list is a YAML list of strings");
        std::fs::write(out.join(format!("{name}.re")), patterns.join("|"))
            .expect("OUT_DIR is writable");
    }
}
