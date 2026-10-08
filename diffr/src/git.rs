//! Git comparison selection and lazy source loading: the files a comparison
//! changed and where each side's bytes are.
use crate::pairing::Pairing;
use crate::protocol;
use anyhow::Context as _;
use gix::filter::plumbing::pipeline::convert::ToGitOutcome;
use gix::{index::entry::Mode, ObjectId as Oid, Repository};
mod diff;
pub(crate) use diff::Diff;
use serde::Deserialize;
use std::{
    fmt,
    io::Read as _,
    path::{Path, PathBuf},
    sync::Arc,
};

pub(crate) type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Operand {
    Revision { r#ref: String },
    Index,
    WorkingTree,
    EmptyTree,
}

impl Operand {
    pub(crate) fn revision(reference: impl Into<String>) -> Self {
        Self::Revision {
            r#ref: reference.into(),
        }
    }

    fn resolve(&self, repo: &Repository) -> Result<Self> {
        match self {
            Self::Revision { r#ref } => {
                let object = repo.rev_parse_single(r#ref.as_str())?.object()?;
                // Retain commit identity where possible, while accepting tree objects too.
                let id = match object.clone().peel_to_commit() {
                    Ok(commit) => commit.id(),
                    Err(_) => object.peel_to_tree()?.id(),
                };
                Ok(Self::revision(id.to_string()))
            }
            _ => Ok(self.clone()),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Comparison {
    pub(crate) before: Operand,
    pub(crate) after: Operand,
}

impl Comparison {
    pub(crate) fn resolve(&self, repo: &Repository) -> Result<Self> {
        Ok(Self {
            before: self.before.resolve(repo)?,
            after: self.after.resolve(repo)?,
        })
    }

    pub(crate) fn reverse(&mut self) {
        std::mem::swap(&mut self.before, &mut self.after);
    }

    pub(crate) fn diff(&self, repo: &Repository, files: &FileParams) -> Result<Diff> {
        diff::compare(repo, self, files)
    }
}

#[derive(Clone, Debug)]
pub(crate) enum FileStatus {
    Added,
    Deleted,
    Modified,
    Renamed,
    TypeChanged,
    Conflicted,
}

#[derive(Clone, Debug)]
pub(crate) struct FileChange {
    pub(crate) old_path: Option<String>,
    pub(crate) new_path: Option<String>,
    pub(crate) status: FileStatus,
    /// Sorted and deduplicated, from the classifier.
    pub(crate) tags: Vec<String>,
    /// The classifier hid the file behind this reason: it is diffed by line,
    /// not shaped, and shown collapsed.
    pub(crate) hidden: Option<String>,
    /// Git's delta sides.
    pub(crate) sides: Pairing<protocol::FileRef>,
}

impl FileChange {
    pub(crate) fn path(&self) -> &str {
        self.new_path
            .as_deref()
            .or(self.old_path.as_deref())
            .expect("changed file has a path")
    }

    /// A standalone comparison of two paths, outside any repository.
    pub(crate) fn standalone(before: &str, after: &str) -> Self {
        let file_ref = |path: &str| protocol::FileRef {
            path: path.to_owned(),
            oid: String::new(),
            mode: String::new(),
        };
        let old_path = (before != "/dev/null").then(|| before.to_owned());
        let new_path = (after != "/dev/null").then(|| after.to_owned());
        let (status, sides) = match (&old_path, &new_path) {
            (Some(old), Some(new)) => (
                FileStatus::Modified,
                Pairing::Both {
                    lhs: file_ref(old),
                    rhs: file_ref(new),
                },
            ),
            (Some(old), None) => (
                FileStatus::Deleted,
                Pairing::LeftOnly { lhs: file_ref(old) },
            ),
            (None, Some(new)) => (FileStatus::Added, Pairing::RightOnly { rhs: file_ref(new) }),
            (None, None) => panic!("a standalone comparison needs at least one path"),
        };
        Self {
            old_path,
            new_path,
            status,
            // Paths outside a repository have no attributes, and Linguist's
            // rules are written for repository-relative paths.
            tags: Vec::new(),
            hidden: None,
            sides,
        }
    }

    pub(crate) fn manifest_entry(&self) -> protocol::FileChange {
        protocol::FileChange {
            file: self.sides.clone(),
            status: match self.status {
                FileStatus::Added => protocol::FileStatus::Added,
                FileStatus::Deleted => protocol::FileStatus::Deleted,
                FileStatus::Modified => protocol::FileStatus::Modified,
                FileStatus::Renamed => protocol::FileStatus::Renamed,
                FileStatus::TypeChanged => protocol::FileStatus::TypeChanged,
                // Both sides exist; the file record carries the unmerged error.
                FileStatus::Conflicted => protocol::FileStatus::Modified,
            },
            tags: self.tags.clone(),
        }
    }
}

/// Why one file could not be diffed. Loading attaches it to the error, and
/// the stream turns it into the record's `code`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FileError {
    UnsupportedFileType,
    ReadFailed,
    NotUtf8,
    Unmerged,
}

impl FileError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::UnsupportedFileType => "unsupported_file_type",
            Self::ReadFailed => "read_failed",
            Self::NotUtf8 => "not_utf8",
            Self::Unmerged => "unmerged",
        }
    }
}

impl fmt::Display for FileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::UnsupportedFileType => {
                "structural diffs currently require regular text files (not symlinks or submodules)"
            }
            Self::ReadFailed => "could not read the source",
            Self::NotUtf8 => "the source is not valid UTF-8",
            Self::Unmerged => {
                "unmerged index entry: resolve the conflict before requesting a structural diff"
            }
        })
    }
}

impl std::error::Error for FileError {}

impl From<&Operand> for protocol::Snapshot {
    fn from(operand: &Operand) -> Self {
        match operand {
            Operand::Revision { r#ref } => Self::Revision { rev: r#ref.clone() },
            Operand::Index => Self::Index,
            Operand::WorkingTree => Self::WorkingTree,
            Operand::EmptyTree => Self::EmptyTree,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct FileParams {
    /// Repository-relative paths or wildcard patterns; empty selects all changed files.
    pub(crate) paths: Vec<String>,
    pub(crate) renames: bool,
}

impl Default for FileParams {
    fn default() -> Self {
        Self {
            paths: Vec::new(),
            renames: true,
        }
    }
}

/// Where one side's bytes come from.
#[derive(Clone)]
pub(crate) enum Source {
    Absent,
    Blob {
        repo: Arc<gix::ThreadSafeRepository>,
        id: Oid,
        mode: Mode,
    },
    /// A working-tree file, by its repository-relative path: read through
    /// Git's clean filters.
    WorkingFile {
        repo: Arc<gix::ThreadSafeRepository>,
        path: String,
        mode: Mode,
    },
    /// A `--no-index` path, read as it is.
    File {
        path: PathBuf,
        mode: Mode,
    },
}

impl Source {
    fn from_entry(
        entry: Option<&diff::Entry>,
        operand: &Operand,
        repo: &Repository,
        shared: &Arc<gix::ThreadSafeRepository>,
    ) -> Result<Self> {
        let Some(entry) = entry else {
            return Ok(Self::Absent);
        };
        if matches!(operand, Operand::WorkingTree) {
            if repo.workdir().is_none() {
                return Err("working-tree comparison requires a working tree".into());
            }
            return Ok(Self::WorkingFile {
                repo: shared.clone(),
                path: entry.path.clone(),
                mode: entry.mode,
            });
        }
        Ok(Self::Blob {
            repo: shared.clone(),
            id: entry.id,
            mode: entry.mode,
        })
    }

    /// The side's bytes.
    fn read(&self) -> anyhow::Result<Vec<u8>> {
        let mode = match self {
            Self::Absent => return Ok(Vec::new()),
            Self::Blob { mode, .. } | Self::WorkingFile { mode, .. } | Self::File { mode, .. } => {
                mode
            }
        };
        if !matches!(*mode, Mode::FILE | Mode::FILE_EXECUTABLE) {
            return Err(FileError::UnsupportedFileType.into());
        }
        let bytes = match self {
            Self::Absent => unreachable!("handled above"),
            Self::Blob { repo, id, .. } => {
                repo.to_thread_local()
                    .find_blob(*id)
                    .context(FileError::ReadFailed)?
                    .detach()
                    .data
            }
            Self::WorkingFile { repo, path, .. } => {
                clean(&repo.to_thread_local(), path).context(FileError::ReadFailed)?
            }
            Self::File { path, .. } => std::fs::read(path).context(FileError::ReadFailed)?,
        };
        Ok(bytes)
    }
}

/// A working-tree file as Git would store it: through the clean filters
/// (`core.autocrlf`, `eol`, `ident`, filter drivers) its attributes select,
/// as `git diff` reads it.
fn clean(repo: &Repository, path: &str) -> anyhow::Result<Vec<u8>> {
    let workdir = repo
        .workdir()
        .context("working-tree comparison requires a working tree")?;
    let file = std::fs::File::open(workdir.join(path))?;
    let (mut pipeline, index) = repo.filter_pipeline(None)?;
    let mut bytes = Vec::new();
    match pipeline.convert_to_git(file, Path::new(path), &index)? {
        ToGitOutcome::Unchanged(mut file) => {
            file.read_to_end(&mut bytes)?;
        }
        ToGitOutcome::Process(mut output) => {
            output.read_to_end(&mut bytes)?;
        }
        ToGitOutcome::Buffer(buffer) => bytes.extend_from_slice(buffer),
    }
    Ok(bytes)
}

/// One changed file: its manifest entry, and where each side's bytes come
/// from.
pub(crate) struct File {
    pub(crate) change: FileChange,
    before: Source,
    after: Source,
}

impl File {
    /// Both sides' bytes. The error carries a [`FileError`].
    pub(crate) fn read(&self) -> anyhow::Result<(Vec<u8>, Vec<u8>)> {
        if matches!(self.change.status, FileStatus::Conflicted) {
            return Err(FileError::Unmerged.into());
        }
        Ok((self.before.read()?, self.after.read()?))
    }
}

/// What a comparison changed: the two sides and every file, in Git's
/// order.
pub(crate) struct Listing {
    pub(crate) lhs: protocol::Snapshot,
    pub(crate) rhs: protocol::Snapshot,
    pub(crate) files: Vec<File>,
}

/// A standalone comparison of two paths on disk, outside any repository;
/// `/dev/null` is an absent side.
pub(crate) fn standalone(before: &str, after: &str) -> Listing {
    let source = |path: &str| {
        if path == "/dev/null" {
            Source::Absent
        } else {
            Source::File {
                path: PathBuf::from(path),
                mode: Mode::FILE,
            }
        }
    };
    Listing {
        lhs: protocol::Snapshot::Path {
            path: before.to_owned(),
        },
        rhs: protocol::Snapshot::Path {
            path: after.to_owned(),
        },
        files: vec![File {
            change: FileChange::standalone(before, after),
            before: source(before),
            after: source(after),
        }],
    }
}

/// List the comparison's changed files and where their bytes are.
pub(crate) fn list(
    workspace: &Path,
    comparison: Comparison,
    files: &FileParams,
) -> Result<Listing> {
    let repo = gix::open(workspace)?;
    let comparison = comparison.resolve(&repo)?;
    let diff = comparison.diff(&repo, files)?;
    // Each blob read makes its own thread-local view of this one handle.
    let shared = Arc::new(repo.clone().into_sync());
    let mut listed = Vec::new();
    for delta in &diff.changes {
        let old_path = delta.before.as_ref().map(|entry| entry.path.clone());
        let new_path = delta.after.as_ref().map(|entry| entry.path.clone());
        // A working-tree side names no stored blob, so it carries the
        // null id, as `git diff --raw` writes it.
        let file_ref = |entry: &diff::Entry, operand: &Operand| protocol::FileRef {
            path: entry.path.clone(),
            oid: match operand {
                Operand::WorkingTree => gix::ObjectId::null(repo.object_hash()).to_string(),
                _ => entry.id.to_string(),
            },
            mode: format!("{:o}", entry.mode.bits()),
        };
        let (lhs, rhs) = (&comparison.before, &comparison.after);
        let sides = match (&delta.before, &delta.after) {
            (Some(old), Some(new)) => Pairing::Both {
                lhs: file_ref(old, lhs),
                rhs: file_ref(new, rhs),
            },
            (Some(old), None) => Pairing::LeftOnly {
                lhs: file_ref(old, lhs),
            },
            (None, Some(new)) => Pairing::RightOnly {
                rhs: file_ref(new, rhs),
            },
            (None, None) => unreachable!("a change has a path"),
        };
        listed.push(File {
            change: FileChange {
                old_path,
                new_path,
                status: delta.status.clone(),
                tags: Vec::new(),
                hidden: None,
                sides,
            },
            before: Source::from_entry(delta.before.as_ref(), &comparison.before, &repo, &shared)?,
            after: Source::from_entry(delta.after.as_ref(), &comparison.after, &repo, &shared)?,
        });
    }
    Ok(Listing {
        lhs: protocol::Snapshot::from(&comparison.before),
        rhs: protocol::Snapshot::from(&comparison.after),
        files: listed,
    })
}
