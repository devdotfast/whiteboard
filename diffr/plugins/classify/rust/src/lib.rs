//! The classifier: tags each changed file `generated`, `vendored`, `docs`,
//! `test`, `integration`, `e2e`, and whatever a repository adds.
//!
//! Bundled rules come first and have the lowest precedence: GitHub
//! Linguist's `generated.rb` (ported in [`generated`]), its `vendor.yml` and
//! `documentation.yml` path patterns (vendored under `linguist/` with
//! Linguist's MIT license), and diffr's own test path rules. Git attributes
//! then decide outright: `linguist-generated`, `linguist-vendored` and
//! `linguist-documentation` add or remove their tag whatever the bundled rules
//! said, and `diffr-tags=a,b` adds tags.
//!
//! A file carrying one of the `hide` tags, or deleted when `hide_deleted` is
//! set, is hidden: diffr diffs it by line, runs no shape plugin on it, and
//! shows it collapsed behind the reason, "Generated file · hidden by default".
mod generated;

use diffr_plugin_sdk::prelude::*;
use generated::Prefix;
use regex::Regex;
use serde::Deserialize;
use std::collections::BTreeSet;
use std::io::Read;
use std::sync::LazyLock;

const GENERATED: &str = "generated";
const VENDORED: &str = "vendored";
const DOCS: &str = "docs";
const TEST: &str = "test";
const INTEGRATION: &str = "integration";
const E2E: &str = "e2e";

/// How much of a file the content rules read.
const PREFIX_BYTES: usize = 8 * 1024;

/// The attributes the rules read, in the order `Attributes::from_values`
/// takes them.
const ATTRIBUTES: [&str; 4] = [
    "linguist-generated",
    "linguist-vendored",
    "linguist-documentation",
    "diffr-tags",
];

/// Linguist builds one regex from a YAML list of patterns joined with `|`
/// and matches it anywhere in the repository-relative path. The build script
/// joins them.
static VENDOR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(include_str!(concat!(env!("OUT_DIR"), "/vendor.re")))
        .expect("Linguist patterns compile")
});
static DOCUMENTATION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(include_str!(concat!(env!("OUT_DIR"), "/documentation.re")))
        .expect("Linguist patterns compile")
});

/// Directory names, anywhere in the path, that hold tests.
const TEST_DIRS: &[&str] = &[
    "tests",
    "test",
    "__tests__",
    "spec",
    "e2e",
    "cypress",
    "playwright",
];

fn is_test(path: &str) -> bool {
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    let name = parts.next_back().unwrap_or_default();
    parts.any(|dir| TEST_DIRS.contains(&dir))
        || name == "conftest.py"
        || name == "tests.rs"
        || name == "test.rs"
        || name.ends_with("_test.go")
        || name.ends_with("_test.py")
        || name.ends_with("_test.rs")
        || name.ends_with("_tests.rs")
        || (name.starts_with("test_") && name.ends_with(".py"))
        || name.contains(".test.")
        || name.contains(".spec.")
        || name.contains(".integration.")
        || name.contains(".e2e.")
}

/// `integration` or `e2e` for a test file whose path says which.
fn kind_by_path(path: &str) -> Option<&'static str> {
    let segments: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    let parts = || {
        segments
            .iter()
            .flat_map(|segment| segment.split(['.', '_', '-']))
    };
    if parts().any(|part| part == "e2e")
        || segments
            .iter()
            .any(|segment| ["cypress", "playwright"].contains(segment))
    {
        return Some(E2E);
    }
    if parts().any(|part| part == "integration") {
        return Some(INTEGRATION);
    }
    let crate_tests = path.ends_with(".rs")
        && segments[..segments.len().saturating_sub(1)]
            .iter()
            .take_while(|segment| **segment != "src")
            .any(|segment| *segment == "tests");
    crate_tests.then_some(INTEGRATION)
}

/// `integration` or `e2e` for a test file whose first lines say which.
fn kind_by_content(text: &str) -> Option<&'static str> {
    if text.contains("@playwright/test") {
        return Some(E2E);
    }
    text.lines()
        .map(str::trim)
        .filter(|line| line.starts_with("//go:build") || line.starts_with("pytestmark"))
        .flat_map(|line| line.split(|c: char| !c.is_ascii_alphanumeric()))
        .find_map(|word| match word {
            "e2e" => Some(E2E),
            "integration" => Some(INTEGRATION),
            _ => None,
        })
}

/// Every bundled rule that looks at the repository-relative path alone.
fn from_path(path: &str) -> BTreeSet<&'static str> {
    let mut tags = BTreeSet::new();
    if generated::by_path(path) {
        tags.insert(GENERATED);
    }
    if VENDOR.is_match(path) {
        tags.insert(VENDORED);
    }
    if DOCUMENTATION.is_match(path) {
        tags.insert(DOCS);
    }
    if is_test(path) {
        tags.insert(TEST);
        tags.extend(kind_by_path(path));
    }
    tags
}

/// Linguist's content rules over the start of the file. A prefix cut inside
/// a UTF-8 character is read up to that character.
fn generated_by_content(path: &str, bytes: &[u8], complete: bool) -> bool {
    let text = match std::str::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) if !complete && error.error_len().is_none() => {
            std::str::from_utf8(&bytes[..error.valid_up_to()]).expect("valid up to here")
        }
        Err(_) => return false,
    };
    generated::by_content(path, &Prefix { text, complete })
}

/// The first [`PREFIX_BYTES`] of a regular file, and whether that is all of
/// it; `None` for anything else and for binary content. A working-tree file
/// has git's null object id and is read from the file system.
fn prefix(side: &FileRef) -> Result<Option<(Vec<u8>, bool)>, String> {
    if side.mode != "100644" && side.mode != "100755" {
        return Ok(None);
    }
    let mut bytes = if side.oid.chars().all(|c| c == '0') {
        let mut bytes = Vec::with_capacity(PREFIX_BYTES + 1);
        std::fs::File::open(&side.path)
            .map_err(|error| format!("{}: {error}", side.path))?
            .take(PREFIX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("{}: {error}", side.path))?;
        bytes
    } else {
        let mut blob = git::cat_file(&side.oid)?;
        blob.truncate(PREFIX_BYTES + 1);
        blob
    };
    let complete = bytes.len() <= PREFIX_BYTES;
    bytes.truncate(PREFIX_BYTES);
    if bytes.contains(&0) {
        return Ok(None);
    }
    Ok(Some((bytes, complete)))
}

/// What git attributes say about one file. `None` leaves the bundled rules
/// in charge of that tag.
struct Attributes {
    generated: Option<bool>,
    vendored: Option<bool>,
    docs: Option<bool>,
    added: Vec<String>,
}

impl Attributes {
    /// Look up the file's attributes with git's precedence.
    fn lookup(path: &str) -> Result<Self, String> {
        let names = ATTRIBUTES.map(str::to_owned);
        let values = git::check_attr(&names, path)?;
        let [generated, vendored, docs, tags] = &values[..] else {
            return Err(format!(
                "{path}: git check-attr returned {} states for {} attributes",
                values.len(),
                ATTRIBUTES.len()
            ));
        };
        Self::from_values(path, generated, vendored, docs, tags)
    }

    fn from_values(
        path: &str,
        generated: &Attribute,
        vendored: &Attribute,
        docs: &Attribute,
        tags: &Attribute,
    ) -> Result<Self, String> {
        let added = match tags {
            Attribute::Unspecified | Attribute::Unset => Vec::new(),
            Attribute::Set => {
                return Err(format!(
                    "{path}: diffr-tags needs a value, such as diffr-tags=fixture,schema"
                ))
            }
            Attribute::Value(value) => {
                parse_tags(value).map_err(|message| format!("{path}: {message}"))?
            }
        };
        Ok(Self {
            generated: linguist_flag(generated),
            vendored: linguist_flag(vendored),
            docs: linguist_flag(docs),
            added,
        })
    }

    /// Apply these attributes over the bundled tags, sorted and deduplicated.
    fn resolve(&self, bundled: BTreeSet<&'static str>) -> Vec<String> {
        let mut tags: BTreeSet<String> = bundled.into_iter().map(str::to_owned).collect();
        for (tag, flag) in [
            (GENERATED, self.generated),
            (VENDORED, self.vendored),
            (DOCS, self.docs),
        ] {
            match flag {
                Some(true) => {
                    tags.insert(tag.to_owned());
                }
                Some(false) => {
                    tags.remove(tag);
                }
                None => {}
            }
        }
        tags.extend(self.added.iter().cloned());
        tags.into_iter().collect()
    }
}

/// Linguist's reading of a boolean attribute: unspecified has no opinion,
/// unset or the string `false` is false, and anything else is true.
fn linguist_flag(value: &Attribute) -> Option<bool> {
    match value {
        Attribute::Unspecified => None,
        Attribute::Unset => Some(false),
        Attribute::Value(value) if value == "false" => Some(false),
        Attribute::Set | Attribute::Value(_) => Some(true),
    }
}

/// A tag is lowercase ASCII letters, digits, `-` and `_`, starting with a
/// letter or digit.
fn is_tag(tag: &str) -> bool {
    tag.chars()
        .next()
        .is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit())
        && tag
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// `a,b`: each one a tag.
fn parse_tags(value: &str) -> Result<Vec<String>, String> {
    value
        .split(',')
        .map(|tag| {
            if is_tag(tag) {
                Ok(tag.to_owned())
            } else {
                Err(format!(
                    "diffr-tags={value}: {tag:?} is not a tag; use lowercase letters, digits, '-' and '_', separated by commas"
                ))
            }
        })
        .collect()
}

fn tag(name: String) -> Tag {
    match name.as_str() {
        GENERATED => Tag::Generated,
        VENDORED => Tag::Vendored,
        DOCS => Tag::Docs,
        TEST => Tag::Test,
        _ => Tag::Custom(name),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Options {
    /// Tags that hide a file; the first listed one it carries names the reason.
    hide: Vec<String>,
    /// Hide files deleted outright, whatever their tags.
    hide_deleted: bool,
}

pub struct Classify {
    options: Options,
}

impl Classify {
    /// Why the file starts hidden: "Deleted file · hidden by default", or
    /// the first `hide` tag it carries, capitalized.
    fn hidden(&self, file: &FileEntry, tags: &BTreeSet<String>) -> Option<String> {
        let what = if self.options.hide_deleted && file.status == FileStatus::Deleted {
            "Deleted".to_owned()
        } else {
            capitalized(self.options.hide.iter().find(|tag| tags.contains(*tag))?)
        };
        Some(format!("{what} file · hidden by default"))
    }
}

fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

impl ClassifierGuest for Classify {
    type Classifier = Self;
}

impl GuestClassifier for Classify {
    fn new(options: String) -> Result<Self, String> {
        let options: Options =
            serde_json::from_str(&options).map_err(|e| format!("invalid options: {e}"))?;
        Ok(Self { options })
    }

    fn classify(&self, file: FileEntry) -> Result<Classification, String> {
        // The side the file is shown by: the after side, or the before side
        // for a deletion.
        let side = match &file.file {
            FileSides::Both((_, rhs)) | FileSides::RightOnly(rhs) => rhs,
            FileSides::LeftOnly(lhs) => lhs,
        };
        let path = side.path.as_str();
        let attributes = Attributes::lookup(path)?;
        let mut bundled = from_path(path);
        // Content is read only when it could change the answer.
        if attributes.generated.is_none()
            && !bundled.contains(GENERATED)
            && generated::needs_content(path)
        {
            if let Some((bytes, complete)) = prefix(side)? {
                if generated_by_content(path, &bytes, complete) {
                    bundled.insert(GENERATED);
                }
            }
        }
        if bundled.contains(TEST) && !bundled.contains(INTEGRATION) && !bundled.contains(E2E) {
            if let Some((bytes, _)) = prefix(side)? {
                bundled.extend(kind_by_content(&String::from_utf8_lossy(&bytes)));
            }
        }
        let tags: BTreeSet<String> = attributes.resolve(bundled).into_iter().collect();
        Ok(Classification {
            hidden: self.hidden(&file, &tags),
            tags: tags.into_iter().map(tag).collect(),
        })
    }
}

export_classifier!(Classify);
