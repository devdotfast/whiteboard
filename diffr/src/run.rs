//! Diff a comparison and write the record stream. Files are classified
//! first, then diffed on worker threads and written as each finishes.
use crate::config::Params;
use crate::engine::QueryConflict;
use crate::git::{self, FileError};
use crate::options::DiffOptions;
use crate::plugin::{Classifier, MutationFailed, Pipeline};
use crate::present::present;
use crate::protocol::project::{self, Inputs};
use crate::protocol::{self, Diff, Event, FileChange, Outcome, Problem, VERSION};
use crate::summary::{DiffResult, FallbackCause, FileContent, FileFormat};
use crate::tags;
use std::io::{BufWriter, Write};
use std::num::NonZeroUsize;
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use tokio::task::JoinSet;

/// The command line's choices for one run, beyond the configuration.
#[derive(Clone, Copy)]
pub(crate) struct Options {
    /// Emit every token's capture name (`--syntax`).
    pub(crate) syntax: bool,
    /// Diff without comments (`--ignore-comments`).
    pub(crate) ignore_comments: bool,
}

/// What the stream ended with: how many files it listed, whether any
/// failed, and whether a run-level failure cut it short.
pub(crate) struct Ended {
    pub(crate) files: usize,
    pub(crate) failed: bool,
    pub(crate) aborted: bool,
}

/// Tag every file before any is diffed; the start record needs the tags.
pub(crate) fn classify(
    classifier: &mut Classifier,
    listing: &mut git::Listing,
) -> anyhow::Result<()> {
    let entries: Vec<FileChange> = listing
        .files
        .iter()
        .map(|file| file.change.manifest_entry())
        .collect();
    for (file, classified) in listing.files.iter_mut().zip(classifier.classify(&entries)?) {
        file.change.tags = classified.tags;
        file.change.hidden = classified.hidden;
    }
    Ok(())
}

/// Write the start record, each file as it finishes, and the footer.
/// Records queue without bound, so a slow reader never stalls diffing.
pub(crate) fn stream(
    runtime: &tokio::runtime::Runtime,
    listing: git::Listing,
    pipeline: Pipeline,
    params: Params,
    jobs: NonZeroUsize,
    options: Options,
    output: &mut impl Write,
) -> anyhow::Result<Ended> {
    let start = Event::Start {
        version: VERSION,
        lhs: listing.lhs,
        rhs: listing.rhs,
        files: listing
            .files
            .iter()
            .map(|file| file.change.manifest_entry())
            .collect(),
    };
    let files = listing.files;
    let count = files.len();
    let shared = Arc::new(Shared {
        pool: rayon::ThreadPoolBuilder::new()
            .num_threads(jobs.get())
            .thread_name(|index| format!("diffr-worker-{index}"))
            .build()?,
        pipeline,
        diff_options: DiffOptions {
            syntax: options.syntax,
            ..params.diff.options(options.ignore_comments)
        },
        params,
    });
    let (sender, receiver) = channel();
    let worker = runtime.spawn(produce(start, files, shared, sender));
    let mut output = BufWriter::new(output);
    let result: anyhow::Result<Ended> = (|| {
        let mut ended = Ended {
            files: count,
            failed: false,
            aborted: false,
        };
        for event in &receiver {
            if let Event::Complete {
                failed, aborted, ..
            } = &event
            {
                ended.failed |= *failed > 0;
                ended.aborted = aborted.is_some();
            }
            protocol::write_record(&mut output, &event)?;
            output.flush()?;
        }
        Ok(ended)
    })();
    // Stop outstanding file tasks when output fails.
    drop(receiver);
    if result.is_err() {
        worker.abort();
    }
    let joined = runtime.block_on(worker);
    let ended = result?;
    // Aborted only when output failed, which returned above.
    joined.expect("the diff task does not panic")?;
    Ok(ended)
}

/// What every per-file task shares.
struct Shared {
    /// `jobs` threads for reading, diffing and projecting.
    pool: rayon::ThreadPool,
    pipeline: Pipeline,
    params: Params,
    diff_options: DiffOptions,
}

/// The start record, each file's record as it finishes, then the footer. A
/// run-level failure stops the files and is reported in the footer.
async fn produce(
    start: Event,
    files: Vec<git::File>,
    shared: Arc<Shared>,
    sender: Sender<Event>,
) -> anyhow::Result<()> {
    sender.send(start)?;
    let mut pending = JoinSet::new();
    for file in files {
        pending.spawn(record(file, shared.clone()));
    }
    let (mut succeeded, mut failed) = (0, 0);
    let mut aborted = None;
    while let Some(record) = pending.join_next().await {
        let record = match record.expect("a file task does not panic") {
            Ok(record) => record,
            Err(error) => {
                failed += 1;
                aborted = Some(wire_error(&error));
                break;
            }
        };
        if let Event::File { outcome, .. } = &record {
            match outcome {
                Outcome::Diff { .. } => succeeded += 1,
                Outcome::Error { .. } => failed += 1,
            }
        }
        sender.send(record)?;
    }
    sender.send(Event::Complete {
        succeeded,
        failed,
        aborted,
    })?;
    Ok(())
}

/// One file's record. Its own failure is the record's error outcome; `Err` is
/// a run-level failure.
async fn record(file: git::File, shared: Arc<Shared>) -> anyhow::Result<Event> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let change = file.change.clone();
    let projecting = shared.clone();
    shared.pool.spawn(move || {
        let _ = send.send(project(&file, &projecting));
    });
    let outcome = match receive.await.expect("Rayon task returns its result") {
        Ok(diff) => {
            let entry = change.manifest_entry();
            let diff = present(change.hidden.as_deref(), diff, async |sides| {
                shared.pipeline.run(&entry, sides).await
            })
            .await?;
            Outcome::Diff { diff }
        }
        Err(error) => Outcome::Error {
            error: wire_error(&error),
        },
    };
    Ok(Event::File {
        file: change.sides,
        outcome,
    })
}

/// Read, diff and project one file: the blocking work. A fold query conflict
/// fails this file alone.
fn project(file: &git::File, shared: &Shared) -> anyhow::Result<Diff> {
    let (before, after) = file.read()?;
    let sizes = (before.len() as u64, after.len() as u64);
    // A binary file is a successful, size-only record.
    let result = if before.contains(&0) || after.contains(&0) {
        DiffResult {
            file_format: FileFormat::Binary,
            lhs_src: FileContent::Binary,
            rhs_src: FileContent::Binary,
            lhs_positions: vec![],
            rhs_positions: vec![],
            lhs_folds: vec![],
            rhs_folds: vec![],
            lhs_highlights: vec![],
            rhs_highlights: vec![],
        }
    } else {
        let before = std::str::from_utf8(&before).map_err(|_| FileError::NotUtf8)?;
        let after = std::str::from_utf8(&after).map_err(|_| FileError::NotUtf8)?;
        let change = &file.change;
        let options = DiffOptions {
            by_line: if change.tags.iter().any(|tag| tag == tags::GENERATED) {
                Some(FallbackCause::Generated)
            } else if change.hidden.is_some() {
                Some(FallbackCause::Hidden)
            } else {
                None
            },
            ..shared.diff_options.clone()
        };
        DiffResult::from_sources_with_options(
            change.path(),
            before,
            after,
            &shared.params,
            &options,
        )?
    };
    Ok(project::diff(
        &result,
        Inputs {
            file: &file.change.sides,
            sizes,
        },
    ))
}

/// The wire record for an error, with the code of its typed cause;
/// unclassified errors are `internal`.
fn wire_error(error: &anyhow::Error) -> Problem {
    let code = if let Some(kind) = error.downcast_ref::<FileError>() {
        kind.code()
    } else if error.downcast_ref::<QueryConflict>().is_some() {
        "query_conflict"
    } else if error.downcast_ref::<MutationFailed>().is_some() {
        "mutation_failed"
    } else {
        "internal"
    };
    Problem {
        code: code.to_owned(),
        message: format!("{error:#}"),
    }
}
