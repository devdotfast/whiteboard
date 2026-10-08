//! Comparison metadata, owned so it can leave the repository thread.
use super::{Comparison, FileParams, FileStatus, Operand, Result};
use gix::{
    bstr::{BString, ByteSlice},
    index::{
        entry::{Mode, Stage},
        State,
    },
    ObjectId, Repository,
};
use std::{collections::BTreeMap, io::Read as _, path::PathBuf};

#[derive(Clone, Debug)]
pub(crate) struct Entry {
    pub path: String,
    pub id: ObjectId,
    pub mode: Mode,
}

#[derive(Clone, Debug)]
pub(crate) struct Change {
    pub before: Option<Entry>,
    pub after: Option<Entry>,
    pub status: FileStatus,
}

pub(crate) struct FileStats {
    pub(crate) lines: Option<(u32, u32)>,
    pub(crate) sizes: (u64, u64),
}

pub(crate) struct Diff {
    pub(crate) changes: Vec<Change>,
}

impl Diff {
    pub(crate) fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }

    pub(crate) fn line_counts(
        &self,
        repo: &Repository,
        comparison: &Comparison,
    ) -> Result<Vec<FileStats>> {
        use gix::diff::blob::{
            pipeline::WorktreeRoots, platform::prepare_diff::Operation, ResourceKind,
        };
        let root = |operand: &Operand| {
            matches!(operand, Operand::WorkingTree)
                .then(|| repo.workdir().map(PathBuf::from))
                .flatten()
        };
        let mut cache = repo.diff_resource_cache(
            gix::diff::blob::pipeline::Mode::ToGit,
            WorktreeRoots {
                old_root: root(&comparison.before),
                new_root: root(&comparison.after),
            },
        )?;
        let mut counts = Vec::new();
        for change in &self.changes {
            let mut gitlinks: [Option<Vec<u8>>; 2] = [None, None];
            cache.filter.roots.old_root = change
                .before
                .as_ref()
                .and_then(|_| root(&comparison.before));
            cache.filter.roots.new_root =
                change.after.as_ref().and_then(|_| root(&comparison.after));
            let path = &change
                .after
                .as_ref()
                .or(change.before.as_ref())
                .ok_or("missing path")?
                .path;
            for (side, (entry, kind)) in [
                (&change.before, ResourceKind::OldOrSource),
                (&change.after, ResourceKind::NewOrDestination),
            ]
            .into_iter()
            .enumerate()
            {
                let (mut id, mut mode, path) = match entry {
                    Some(entry) => (
                        entry.id,
                        entry
                            .mode
                            .to_tree_entry_mode()
                            .ok_or("invalid entry mode")?
                            .kind(),
                        entry.path.as_bytes().as_bstr(),
                    ),
                    None => (
                        ObjectId::null(repo.object_hash()),
                        gix::objs::tree::EntryKind::Blob,
                        path.as_bytes().as_bstr(),
                    ),
                };
                if mode == gix::objs::tree::EntryKind::Commit {
                    // Git renders gitlinks as one synthetic text line, not commit objects.
                    gitlinks[side] = Some(format!("Subproject commit {id}\n").into_bytes());
                    id = ObjectId::null(repo.object_hash());
                    mode = gix::objs::tree::EntryKind::Blob;
                    if side == 0 {
                        cache.filter.roots.old_root = None;
                    } else {
                        cache.filter.roots.new_root = None;
                    }
                }
                cache.set_resource(id, mode, path, kind, repo)?;
            }
            if gitlinks.iter().any(Option::is_some) {
                use gix::diff::blob::platform::resource::{
                    ByteLinesWithoutTerminator as Lines, Data,
                };
                let (old, new) = cache.resources().ok_or("missing diff resources")?;
                let lines = if matches!(old.data, Data::Binary { .. })
                    || matches!(new.data, Data::Binary { .. })
                {
                    None
                } else {
                    let old = gitlinks[0]
                        .as_deref()
                        .unwrap_or_else(|| old.data.as_slice().unwrap_or_default());
                    let new = gitlinks[1]
                        .as_deref()
                        .unwrap_or_else(|| new.data.as_slice().unwrap_or_default());
                    let input =
                        gix::diff::blob::InternedInput::new(Lines::new(old), Lines::new(new));
                    let diff =
                        gix::diff::blob::Diff::compute(gix::diff::blob::Algorithm::Myers, &input);
                    Some((diff.count_additions(), diff.count_removals()))
                };
                let size = |data: Data<'_>| match data {
                    Data::Missing => 0,
                    Data::Buffer { buf, .. } => buf.len() as u64,
                    Data::Binary { size } => size,
                };
                counts.push(FileStats {
                    lines,
                    sizes: (size(old.data), size(new.data)),
                });
                cache.clear_resource_cache();
                continue;
            }
            let prepared = cache.prepare_diff()?;
            let lines = match prepared.operation {
                Operation::InternalDiff { algorithm } => {
                    let input = prepared.interned_input();
                    let diff = gix::diff::blob::Diff::compute(algorithm, &input);
                    Some((diff.count_additions(), diff.count_removals()))
                }
                Operation::SourceOrDestinationIsBinary => None,
                Operation::ExternalCommand { .. } => {
                    return Err("external diff commands cannot produce diff statistics".into())
                }
            };
            let size = |data: gix::diff::blob::platform::resource::Data<'_>| match data {
                gix::diff::blob::platform::resource::Data::Missing => 0,
                gix::diff::blob::platform::resource::Data::Buffer { buf, .. } => buf.len() as u64,
                gix::diff::blob::platform::resource::Data::Binary { size } => size,
            };
            counts.push(FileStats {
                lines,
                sizes: (size(prepared.old.data), size(prepared.new.data)),
            });
            cache.clear_resource_cache();
        }
        Ok(counts)
    }
}

fn index(repo: &Repository, operand: &Operand) -> Result<State> {
    let mut state: State = match operand {
        Operand::Revision { r#ref } => {
            let tree = repo
                .rev_parse_single(r#ref.as_str())?
                .object()?
                .peel_to_tree()?;
            repo.index_from_tree(&tree.id)?.into()
        }
        Operand::EmptyTree => State::new(repo.object_hash()),
        Operand::Index | Operand::WorkingTree => (**repo.index_or_empty()?).clone().into(),
    };
    if matches!(operand, Operand::Index) {
        state.remove_entries(|_, _, entry| {
            entry
                .flags
                .contains(gix::index::entry::Flags::INTENT_TO_ADD)
        });
    }
    Ok(state)
}

/// Materialize only changed worktree entries into metadata, without writing Git's index
/// or object database. Untracked paths are deliberately excluded, as for `git diff`.
fn worktree(repo: &Repository, state: &mut State) -> Result<()> {
    use gix::status::{
        index_worktree::Item,
        plumbing::index_as_worktree::{Change, EntryStatus},
    };
    let root = repo
        .workdir()
        .ok_or("working-tree comparison requires a working tree")?;
    let mut removed = Vec::new();
    let (mut filter, filter_index) = repo.filter_pipeline(None)?;
    for item in repo
        .status(gix::progress::Discard)?
        .untracked_files(gix::status::UntrackedFiles::None)
        .index_worktree_options_mut(|options| options.thread_limit = Some(1))
        .into_index_worktree_iter(Vec::new())?
    {
        let Item::Modification {
            entry_index,
            rela_path: relative_path,
            status,
            ..
        } = item?
        else {
            continue;
        };
        let entry = &mut state.entries_mut()[entry_index];
        match status {
            EntryStatus::Change(Change::Removed) => {
                removed.push(entry_index);
                continue;
            }
            EntryStatus::Change(Change::Type { worktree_mode }) => entry.mode = worktree_mode,
            EntryStatus::Change(Change::Modification {
                executable_bit_changed,
                ..
            }) => {
                if executable_bit_changed {
                    entry.mode = if entry.mode == Mode::FILE_EXECUTABLE {
                        Mode::FILE
                    } else {
                        Mode::FILE_EXECUTABLE
                    };
                }
            }
            EntryStatus::Change(Change::SubmoduleModification(_)) => {
                entry.id = ObjectId::null(repo.object_hash());
                continue;
            }
            EntryStatus::IntentToAdd => {
                entry.flags.remove(gix::index::entry::Flags::INTENT_TO_ADD);
            }
            EntryStatus::Conflict { .. } | EntryStatus::NeedsUpdate(_) => continue,
        }
        let path = root.join(gix::path::from_bstr(relative_path.as_bstr()));
        let bytes = if entry.mode == Mode::SYMLINK {
            gix::path::into_bstr(std::fs::read_link(path)?)
                .into_owned()
                .to_vec()
        } else {
            let relative = gix::path::from_bstr(relative_path.as_bstr());
            let mut bytes = Vec::new();
            filter
                .convert_to_git(std::fs::File::open(path)?, &relative, &filter_index)?
                .read_to_end(&mut bytes)?;
            bytes
        };
        entry.id = gix::objs::compute_hash(repo.object_hash(), gix::objs::Kind::Blob, &bytes)?;
    }
    removed.sort_unstable();
    state.remove_entries(|index, _, _| removed.binary_search(&index).is_ok());
    Ok(())
}

pub(super) fn compare(
    repo: &Repository,
    comparison: &Comparison,
    files: &FileParams,
) -> Result<Diff> {
    use gix::diff::index::ChangeRef;
    if matches!(
        (&comparison.before, &comparison.after),
        (Operand::Index, Operand::Index) | (Operand::WorkingTree, Operand::WorkingTree)
    ) {
        return Err(
            "compare two revisions, a revision and index/worktree, or index and worktree".into(),
        );
    }
    for path in &files.paths {
        if path.starts_with(':') {
            return Err(
                "magic pathspecs are not supported yet; use paths or wildcard patterns".into(),
            );
        }
    }
    let mut before = index(repo, &comparison.before)?;
    let mut after = index(repo, &comparison.after)?;
    if matches!(comparison.before, Operand::WorkingTree) {
        worktree(repo, &mut before)?;
    }
    if matches!(comparison.after, Operand::WorkingTree) {
        worktree(repo, &mut after)?;
    }
    // A conflict remains a per-file error instead of preventing unrelated files from diffing.
    let mut conflicts = BTreeMap::new();
    for state in [&before, &after] {
        for entry in state
            .entries()
            .iter()
            .filter(|entry| entry.stage() != Stage::Unconflicted)
        {
            conflicts
                .entry(entry.path(state).to_owned())
                .or_insert((entry.id, entry.mode));
        }
    }
    before.remove_entries(|_, path, _| conflicts.contains_key(path));
    after.remove_entries(|_, path, _| conflicts.contains_key(path));
    let paths: Vec<BString> = files
        .paths
        .iter()
        .map(|path| path.as_str().into())
        .collect();
    let pathspec = repo.pathspec(
        false,
        paths,
        false,
        &after,
        gix::worktree::stack::state::attributes::Source::WorktreeThenIdMapping,
    )?;
    let (mut search, _) = pathspec.into_parts();
    let root = |operand: &Operand| -> Option<PathBuf> {
        matches!(operand, Operand::WorkingTree)
            .then(|| repo.workdir().map(PathBuf::from))
            .flatten()
    };
    let mut cache = repo.diff_resource_cache(
        gix::diff::blob::pipeline::Mode::ToGit,
        gix::diff::blob::pipeline::WorktreeRoots {
            old_root: root(&comparison.before),
            new_root: root(&comparison.after),
        },
    )?;
    let mut raw = Vec::new();
    gix::diff::index(
        &before,
        &after,
        |change| {
            raw.push(change.into_owned());
            Ok(std::ops::ControlFlow::Continue(()))
        },
        files.renames.then_some(gix::diff::index::RewriteOptions {
            resource_cache: &mut cache,
            find: repo,
            rewrites: Default::default(),
        }),
        &mut search,
        &mut |_, _, _, _| false,
    )?;
    let entry = |path: &gix::bstr::BStr, id: &gix::hash::oid, mode: Mode| -> Result<Entry> {
        Ok(Entry {
            path: path
                .to_str()
                .map_err(|_| "non-UTF-8 Git paths are unsupported")?
                .to_owned(),
            id: id.to_owned(),
            mode,
        })
    };
    let mut changes = Vec::new();
    for change in raw {
        let (before, after, status) = match change {
            ChangeRef::Addition {
                location,
                id,
                entry_mode,
                ..
            } => (
                None,
                Some(entry(&location, &id, entry_mode)?),
                FileStatus::Added,
            ),
            ChangeRef::Deletion {
                location,
                id,
                entry_mode,
                ..
            } => (
                Some(entry(&location, &id, entry_mode)?),
                None,
                FileStatus::Deleted,
            ),
            ChangeRef::Modification {
                location,
                previous_id,
                previous_entry_mode,
                id,
                entry_mode,
                ..
            } => {
                let status =
                    if previous_entry_mode.bits() & 0o170000 != entry_mode.bits() & 0o170000 {
                        FileStatus::TypeChanged
                    } else {
                        FileStatus::Modified
                    };
                (
                    Some(entry(&location, &previous_id, previous_entry_mode)?),
                    Some(entry(&location, &id, entry_mode)?),
                    status,
                )
            }
            ChangeRef::Rewrite {
                source_location,
                source_id,
                source_entry_mode,
                location,
                id,
                entry_mode,
                ..
            } => (
                Some(entry(&source_location, &source_id, source_entry_mode)?),
                Some(entry(&location, &id, entry_mode)?),
                FileStatus::Renamed,
            ),
        };
        changes.push(Change {
            before,
            after,
            status,
        });
    }
    for (path, (id, mode)) in conflicts {
        if search
            .pattern_matching_relative_path(path.as_bstr(), Some(false), &mut |_, _, _, _| false)
            .is_some_and(|m| !m.is_excluded())
        {
            let entry = entry(path.as_bstr(), &id, mode)?;
            changes.push(Change {
                before: Some(entry.clone()),
                after: Some(entry),
                status: FileStatus::Conflicted,
            });
        }
    }
    changes.sort_by(|a, b| {
        a.after
            .as_ref()
            .or(a.before.as_ref())
            .map(|e| &e.path)
            .cmp(&b.after.as_ref().or(b.before.as_ref()).map(|e| &e.path))
    });
    Ok(Diff { changes })
}
