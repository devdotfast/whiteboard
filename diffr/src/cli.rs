//! Git-style CLI input: the terminal UI, the NDJSON stream, and Git metadata.
use crate::config::{self, Config};
use crate::git::{self, Comparison, FileParams, Operand, Result};
use crate::options::DebugArgs;
use crate::plugin::{Classifier, Pipeline};
use crate::run;
use clap::{ArgGroup, Args, Parser, Subcommand, ValueEnum};
use gix::Repository;
use std::{
    ffi::OsString,
    io::{self, IsTerminal, Write},
    num::NonZeroUsize,
    path::{Component, Path, PathBuf},
};

/// The metadata outputs, named one by one in conflicts so clap's error names
/// the flag that was given rather than the whole group.
const METADATA: [&str; 5] = ["name_only", "name_status", "stat", "numstat", "shortstat"];

/// The examples after the options in `-h` and `--help`.
macro_rules! examples {
    () => {
        "Examples:\n  diffr\n  diffr --cached\n  diffr main...HEAD -- src/\n  diffr --no-index -- before.rs after.rs\n  diffr main HEAD --format ndjson\n\nUnsupported Git flags are rejected; this is not a complete git diff implementation."
    };
}

/// Structural diffs with Git-style comparison inputs
#[derive(Parser)]
#[command(
    name = env!("CARGO_BIN_NAME"),
    version,
    group(ArgGroup::new("metadata").args(METADATA)),
    group(ArgGroup::new("names").args(["name_only", "name_status"])),
    // A command name is a command only as the first argument.
    args_conflicts_with_subcommands = true,
    after_help = examples!(),
    // `--help`, not `-h`, adds the agents guide.
    after_long_help = concat!(examples!(), "\n\n", include_str!("../docs/agents.md"))
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    /// Directory in the repository to diff from; paths are relative to it
    #[arg(long, default_value = ".")]
    repo: PathBuf,
    /// Concurrent file diffs for --format ndjson; results are emitted as each finishes
    #[arg(short, long, default_value = "16")]
    jobs: NonZeroUsize,
    /// Compare the index with HEAD, or with the given revision
    #[arg(long, visible_alias = "staged")]
    cached: bool,
    /// Compare from the merge base of the given revision and the second one, or HEAD
    #[arg(long)]
    merge_base: bool,
    /// Compare two files on disk rather than Git revisions
    #[arg(long, conflicts_with_all = ["cached", "merge_base", "null"], conflicts_with_all = METADATA)]
    no_index: bool,
    /// Swap the two sides of the comparison
    #[arg(short = 'R', long)]
    reverse: bool,
    /// Exit with 1 when there are differences
    #[arg(long)]
    exit_code: bool,
    /// Print nothing; exit with 1 when there are differences
    #[arg(long)]
    quiet: bool,
    /// Print the names of changed files
    #[arg(long)]
    name_only: bool,
    /// Print the names and statuses of changed files
    #[arg(long)]
    name_status: bool,
    /// Print a diffstat
    #[arg(long)]
    stat: bool,
    /// Print added and deleted line counts for each file
    #[arg(long)]
    numstat: bool,
    /// Print the diffstat's summary line
    #[arg(long)]
    shortstat: bool,
    /// Terminate --name-only and --name-status output with NULs
    #[arg(short = 'z', long, requires = "names")]
    null: bool,
    /// Do not detect renames
    #[arg(long)]
    no_renames: bool,
    /// Detect renames, which is the default
    #[arg(short = 'M', long, conflicts_with = "no_renames")]
    find_renames: bool,
    /// Unchanged lines kept around each change; defaults to plugins.shape.bundled.context.lines
    #[arg(short = 'U', long)]
    unified: Option<u32>,
    /// Write the event stream to stdout instead of opening the terminal UI
    #[arg(long, conflicts_with = "quiet", conflicts_with_all = METADATA)]
    format: Option<Format>,
    /// Include every token's tree-sitter capture name in --format ndjson output
    #[arg(long, requires = "format", conflicts_with = "quiet", conflicts_with_all = METADATA)]
    syntax: bool,
    /// Columns for --stat; defaults to the terminal's width
    #[arg(long)]
    width: Option<usize>,
    /// Don't consider comments when diffing
    #[arg(long)]
    ignore_comments: bool,
    /// Files larger than this many bytes on either side get a line diff; defaults to diff.byte_limit
    #[arg(long)]
    byte_limit: Option<usize>,
    /// The largest AST matching graph to explore for one file; defaults to diff.graph_limit
    #[arg(long)]
    graph_limit: Option<usize>,
    /// Files with more parse errors than this get a line diff; defaults to diff.parse_error_limit
    #[arg(long)]
    parse_error_limit: Option<usize>,
    /// Revisions, then paths
    items: Vec<OsString>,
    /// Paths
    #[arg(last = true)]
    paths: Vec<OsString>,
}

impl Cli {
    fn metadata(&self) -> bool {
        self.name_only || self.name_status || self.stat || self.numstat || self.shortstat
    }
}

#[derive(Clone, Copy, ValueEnum)]
enum Format {
    Ndjson,
}

#[derive(Subcommand)]
enum Command {
    /// Print saved NDJSON without a repository or terminal frontend
    Pprint(PprintArgs),
    /// Show, edit, or open the settings screen for diffr's configuration
    // `--help`, not `-h`, adds the plugins guide.
    #[command(after_long_help = include_str!("../docs/plugin.md"))]
    Config(ConfigArgs),
    #[command(
        hide = true,
        display_name = env!("CARGO_BIN_NAME"),
        about,
        version,
        long_version = crate::version::VERSION.as_str(),
        next_display_order = None,
        arg_required_else_help = true
    )]
    Debug(DebugArgs),
}

#[derive(Args)]
struct PprintArgs {
    /// Saved event stream; omit or use - to read stdin
    input: Option<PathBuf>,
    /// Fold-state IDs to open; descendants retain their own collapsed state
    #[arg(long, value_delimiter = ',')]
    open: Vec<u32>,
}

#[derive(Args)]
struct ConfigArgs {
    /// Initial search in the settings screen
    query: Option<String>,
    #[command(subcommand)]
    command: Option<ConfigCommand>,
}

#[derive(Subcommand)]
enum ConfigCommand {
    /// Print the configuration's JSON Schema
    Schema,
    /// Print the resolved configuration
    Show {
        #[arg(long)]
        json: bool,
        /// Do not redact the API key
        #[arg(long)]
        reveal: bool,
    },
    /// Write one key to the global configuration file
    Set {
        /// A key, or - to read a typed partial configuration as JSON from stdin
        key: String,
        value: Option<String>,
        /// Print a JSON result, including errors
        #[arg(long)]
        json: bool,
    },
    /// Choose the agents that get the diffr plugin and the summaries provider
    Init {
        /// Print the questions and the answers' schema, or apply ANSWERS
        #[arg(long)]
        json: bool,
        /// Answers as JSON: a file, or - for stdin
        #[arg(requires = "json")]
        answers: Option<PathBuf>,
    },
    /// Convert the v1 settings supported by Whiteboard to config version 2
    Migrate {
        #[arg(long)]
        json: bool,
    },
}

pub(crate) fn run(runtime: &tokio::runtime::Runtime) -> Result<i32> {
    let frontend_args: Vec<OsString> = std::env::args_os().skip(1).collect();
    // Git treats an argument before `--` as a revision even when a file shares
    // its name, so a bare trailing `--` still matters.
    let has_separator = frontend_args.iter().any(|arg| arg == "--");
    let args = Cli::parse();
    match &args.command {
        Some(Command::Pprint(args)) => return run_pprint(args),
        Some(Command::Config(config)) => return run_config(config),
        Some(Command::Debug(debug)) => {
            crate::run_debug(debug.mode(), &Config::default().compile()?);
            return Ok(0);
        }
        None => {}
    }
    let metadata_or_quiet = args.quiet || args.metadata();
    let interactive = args.format.is_none() && !metadata_or_quiet;
    if interactive && args.no_index {
        return launch_tui(&frontend_args, true);
    }
    if args.no_index {
        return no_index(
            runtime,
            &args,
            args.items.iter().chain(&args.paths).cloned().collect(),
        );
    }
    let location = std::fs::canonicalize(&args.repo)?;
    let repo = gix::discover(&location)?;
    let workspace = repo.workdir().unwrap_or(repo.git_dir());
    let (comparison, paths) = select(&repo, &location, &args, has_separator)?;
    if interactive {
        // Reject invalid revisions before the UI takes over the terminal.
        comparison.resolve(&repo)?;
        return launch_tui(&frontend_args, true);
    }
    let files = FileParams {
        paths,
        // `-M` conflicts with `--no-renames`; renames are on by default.
        renames: args.find_renames || !args.no_renames,
    };
    if metadata_or_quiet {
        let diff = comparison.resolve(&repo)?.diff(&repo, &files)?;
        let changed = !diff.is_empty();
        if !args.quiet {
            let width = args
                .width
                .unwrap_or_else(crate::options::detect_terminal_width);
            print_metadata(&repo, &comparison, &diff, &args, width)?;
        }
        return Ok(i32::from(changed && (args.exit_code || args.quiet)));
    }
    let config = args.config()?;
    let params = config.compile()?;
    let mut classifier =
        Classifier::from_config(&config, workspace).map_err(|error| format!("{error:#}"))?;
    let mut listing = git::list(workspace, comparison, &files)?;
    run::classify(&mut classifier, &mut listing).map_err(|error| format!("{error:#}"))?;
    let pipeline = Pipeline::from_config(&config, workspace, args.jobs)
        .map_err(|error| format!("{error:#}"))?;
    let ended = run::stream(
        runtime,
        listing,
        pipeline,
        params,
        args.jobs,
        args.options(),
        &mut io::stdout().lock(),
    )
    .map_err(|error| format!("{error:#}"))?;
    Ok(if ended.failed || ended.aborted {
        2
    } else {
        i32::from(ended.files > 0 && args.exit_code)
    })
}

fn select(
    repo: &Repository,
    location: &Path,
    args: &Cli,
    has_separator: bool,
) -> Result<(Comparison, Vec<String>)> {
    let mut revisions = Vec::new();
    let mut paths = Vec::new();
    for item in &args.items {
        let text = item
            .to_str()
            .ok_or("non-UTF-8 revision/path arguments are unsupported")?;
        let is_rev = repo.rev_parse(text).is_ok();
        let is_path = location.join(item).exists();
        if is_rev && is_path && !has_separator {
            return Err(
                format!("ambiguous revision and path {text:?}; use -- to separate them").into(),
            );
        }
        if is_rev && paths.is_empty() {
            revisions.push(text.to_owned());
        } else if is_rev {
            return Err("revisions must precede paths; use -- to separate them".into());
        } else if is_path {
            paths.push(item.clone());
        } else {
            return Err(
                format!("unknown revision or path {text:?}; use -- before pathspecs").into(),
            );
        }
    }
    paths.extend(args.paths.iter().cloned());
    // Match canonical path forms, including Windows verbatim path prefixes.
    let root = std::fs::canonicalize(repo.workdir().unwrap_or(repo.git_dir()))?;
    let prefix = location.strip_prefix(&root)?;
    let paths = paths
        .into_iter()
        .map(|path| normalize_path(prefix, &path))
        .collect::<Result<Vec<_>>>()?;
    let cached = args.cached;
    let mut comparison = match revisions.as_slice() {
        [] if cached => Comparison {
            before: if repo.head()?.is_unborn() {
                Operand::EmptyTree
            } else {
                Operand::revision("HEAD")
            },
            after: Operand::Index,
        },
        [] => Comparison {
            before: Operand::Index,
            after: Operand::WorkingTree,
        },
        [range] if range.contains("..") => {
            if cached {
                return Err("--cached takes one revision, not a range".into());
            }
            let (a, b, merge) = if let Some((a, b)) = range.split_once("...") {
                (a, b, true)
            } else {
                let (a, b) = range.split_once("..").unwrap();
                (a, b, false)
            };
            let a = if a.is_empty() { "HEAD" } else { a };
            let b = if b.is_empty() { "HEAD" } else { b };
            Comparison {
                before: if merge {
                    merge_base(repo, a, b)?
                } else {
                    Operand::revision(a)
                },
                after: Operand::revision(b),
            }
        }
        [rev] => Comparison {
            before: Operand::revision(rev),
            after: if cached {
                Operand::Index
            } else {
                Operand::WorkingTree
            },
        },
        [a, b] if !cached => Comparison {
            before: Operand::revision(a),
            after: Operand::revision(b),
        },
        _ => return Err("expected at most two revisions (--cached takes at most one)".into()),
    };
    if args.merge_base {
        let a = revisions
            .first()
            .ok_or("--merge-base requires a revision")?;
        if a.contains("..") {
            return Err("do not combine --merge-base with a range".into());
        }
        comparison.before = merge_base(
            repo,
            a,
            revisions.get(1).map(String::as_str).unwrap_or("HEAD"),
        )?;
    }
    if args.reverse {
        comparison.reverse();
    }
    Ok((comparison, paths))
}

fn merge_base(repo: &Repository, a: &str, b: &str) -> Result<Operand> {
    let a = repo.rev_parse_single(a)?.object()?.peel_to_commit()?.id();
    let b = repo.rev_parse_single(b)?.object()?.peel_to_commit()?.id();
    Ok(Operand::revision(repo.merge_base(a, b)?.to_string()))
}

fn normalize_path(prefix: &Path, path: &std::ffi::OsStr) -> Result<String> {
    if path.to_string_lossy().starts_with(':') {
        return Err("Git magic pathspecs are not supported".into());
    }
    let mut normalized = PathBuf::new();
    for part in prefix.join(path).components() {
        match part {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir if normalized.pop() => {}
            _ => return Err("pathspec must stay inside the repository".into()),
        }
    }
    Ok(normalized.to_str().ok_or("non-UTF-8 pathspec")?.to_owned())
}

fn print_metadata(
    repo: &Repository,
    comparison: &Comparison,
    diff: &crate::git::Diff,
    args: &Cli,
    width: usize,
) -> Result<()> {
    use crate::git::FileStatus;
    let mut stdout = io::stdout().lock();
    if args.name_only || args.name_status {
        let separator: &[u8] = if args.null { b"\0" } else { b"\t" };
        let terminator: &[u8] = if args.null { b"\0" } else { b"\n" };
        for change in &diff.changes {
            if args.name_status {
                write!(
                    stdout,
                    "{}",
                    match change.status {
                        FileStatus::Added => 'A',
                        FileStatus::Deleted => 'D',
                        FileStatus::Renamed => 'R',
                        FileStatus::TypeChanged => 'T',
                        FileStatus::Conflicted => 'U',
                        FileStatus::Modified => 'M',
                    }
                )?;
                stdout.write_all(separator)?;
                if matches!(change.status, FileStatus::Renamed) {
                    stdout.write_all(
                        change
                            .before
                            .as_ref()
                            .ok_or("missing old path")?
                            .path
                            .as_bytes(),
                    )?;
                    stdout.write_all(separator)?;
                }
            }
            stdout.write_all(
                change
                    .after
                    .as_ref()
                    .or(change.before.as_ref())
                    .ok_or("missing path")?
                    .path
                    .as_bytes(),
            )?;
            stdout.write_all(terminator)?;
        }
        return Ok(());
    }
    let counts = diff.line_counts(repo, comparison)?;
    let names: Vec<_> = diff
        .changes
        .iter()
        .map(|change| -> Result<String> {
            let entry = change
                .after
                .as_ref()
                .or(change.before.as_ref())
                .ok_or("missing path")?;
            if !matches!(change.status, FileStatus::Renamed) {
                return Ok(entry.path.clone());
            }
            let old = &change.before.as_ref().ok_or("missing old path")?.path;
            if !args.numstat {
                let common = old
                    .bytes()
                    .zip(entry.path.bytes())
                    .take_while(|(a, b)| a == b)
                    .count();
                if let Some(slash) = old.as_bytes()[..common].iter().rposition(|b| *b == b'/') {
                    let prefix = slash + 1;
                    return Ok(format!(
                        "{}{{{} => {}}}",
                        &old[..prefix],
                        &old[prefix..],
                        &entry.path[prefix..]
                    ));
                }
            }
            Ok(format!("{old} => {}", entry.path))
        })
        .collect::<Result<_>>()?;
    let name_width = names.iter().map(String::len).max().unwrap_or(0);
    let maximum = counts
        .iter()
        .filter_map(|stats| stats.lines)
        .map(|(a, d)| a + d)
        .max()
        .unwrap_or(0) as usize;
    let digits = maximum.to_string().len();
    // Preserve the previous stat formatter's shared column widths and graph scale.
    let mut scale = width;
    if scale > 0 {
        if scale > name_width + digits + 5 {
            scale -= name_width + digits + 5;
        }
        scale = scale.max(7);
    }
    if scale > maximum {
        scale = 0;
    }
    let (mut added, mut removed) = (0, 0);
    for (name, stats) in names.iter().zip(&counts) {
        if let Some((a, d)) = stats.lines {
            added += a;
            removed += d;
        }
        if args.numstat {
            match stats.lines {
                Some((a, d)) => write!(stdout, "{a}\t{d}\t")?,
                None => write!(stdout, "-\t-\t")?,
            }
            writeln!(stdout, "{name}")?;
        } else if !args.shortstat {
            write!(stdout, " {name}{} | ", " ".repeat(name_width - name.len()))?;
            match stats.lines {
                Some((a, d)) => {
                    let total = (a + d) as usize;
                    write!(stdout, "{total:>digits$}")?;
                    if total > 0 {
                        let (plus, minus) = if scale == 0 {
                            (a as usize, d as usize)
                        } else {
                            let bars = (total * scale + maximum / 2) / maximum;
                            let plus = bars * a as usize / total;
                            (plus.max(1), (bars - plus).max(1))
                        };
                        write!(stdout, " {}{}", "+".repeat(plus), "-".repeat(minus))?;
                    }
                    writeln!(stdout)?;
                }
                None => writeln!(stdout, "Bin {} -> {} bytes", stats.sizes.0, stats.sizes.1)?,
            }
        }
    }
    if !args.numstat {
        let n = diff.changes.len();
        write!(stdout, " {n} file{} changed", if n == 1 { "" } else { "s" })?;
        if added > 0 || removed == 0 {
            write!(
                stdout,
                ", {added} insertion{}(+)",
                if added == 1 { "" } else { "s" }
            )?;
        }
        if removed > 0 || added == 0 {
            write!(
                stdout,
                ", {removed} deletion{}(-)",
                if removed == 1 { "" } else { "s" }
            )?;
        }
        writeln!(stdout)?;
    }
    Ok(())
}

fn no_index(runtime: &tokio::runtime::Runtime, args: &Cli, paths: Vec<OsString>) -> Result<i32> {
    if paths.len() != 2 {
        return Err("--no-index requires two file paths".into());
    }
    let mut paths = paths;
    if args.reverse {
        paths.swap(0, 1);
    }
    let read = |path: &OsString| -> Result<Vec<u8>> {
        if path == "/dev/null" {
            return Ok(Vec::new());
        }
        Ok(std::fs::read(path)?)
    };
    let changed = read(&paths[0])? != read(&paths[1])?;
    if args.quiet {
        return Ok(i32::from(changed));
    }
    // Paths outside a repository have no attributes, and Linguist's rules
    // are written for repository-relative paths, so they are not classified.
    let config = args.config()?;
    let params = config.compile()?;
    let pipeline = Pipeline::from_config(&config, &std::env::current_dir()?, args.jobs)
        .map_err(|error| format!("{error:#}"))?;
    let ended = run::stream(
        runtime,
        git::standalone(&paths[0].to_string_lossy(), &paths[1].to_string_lossy()),
        pipeline,
        params,
        args.jobs,
        args.options(),
        &mut io::stdout().lock(),
    )
    .map_err(|error| format!("{error:#}"))?;
    Ok(if ended.failed || ended.aborted {
        2
    } else {
        i32::from(changed && args.exit_code)
    })
}

impl Cli {
    /// The configuration file with this run's flags merged in: `-U` is the
    /// context plugin's `lines`, and the limit flags are `[diff]`.
    fn config(&self) -> Result<Config> {
        let mut config = Config::load()?;
        if let Some(unified) = self.unified {
            if let Some(entry) = config.plugins.shape.entries.get_mut("bundled.context") {
                entry
                    .options
                    .insert("lines".into(), serde_json::Value::from(unified));
            }
        }
        if let Some(limit) = self.byte_limit {
            config.diff.byte_limit = limit;
        }
        if let Some(limit) = self.graph_limit {
            config.diff.graph_limit = limit;
        }
        if let Some(limit) = self.parse_error_limit {
            config.diff.parse_error_limit = limit;
        }
        Ok(config)
    }

    fn options(&self) -> run::Options {
        run::Options {
            syntax: self.syntax,
            ignore_comments: self.ignore_comments,
        }
    }
}

/// `diffr config`: settings, schema, resolved values and edits.
fn run_config(config: &ConfigArgs) -> Result<i32> {
    let mut stdout = io::stdout().lock();
    match &config.command {
        Some(ConfigCommand::Schema) => {
            serde_json::to_writer_pretty(&mut stdout, &Config::schema())?;
            stdout.write_all(b"\n")?;
        }
        Some(ConfigCommand::Show { json, reveal }) => {
            let config = Config::load()?;
            if *json {
                serde_json::to_writer_pretty(&mut stdout, &config::store::show(&config, *reveal))?;
                stdout.write_all(b"\n")?;
            } else {
                stdout.write_all(
                    toml::to_string_pretty(&config::store::redacted(&config, *reveal))?.as_bytes(),
                )?;
            }
        }
        Some(ConfigCommand::Set { key, value, json }) => {
            match (key.as_str(), value) {
                ("-", Some(_)) => return Err("config set - takes no VALUE".into()),
                (key, None) if key != "-" => {
                    return Err(format!("config set {key} needs a VALUE").into())
                }
                _ => {}
            }
            let result = (|| -> Result<serde_json::Value> {
                let path = config::global_path()?;
                let changed = match value {
                    None => {
                        let patch: serde_json::Value = serde_json::from_reader(io::stdin().lock())?;
                        config::store::patch(&path, &patch)?
                    }
                    Some(value) => config::store::set(&path, key, value)?,
                };
                Ok(serde_json::json!({ "changed": changed }))
            })();
            return config_result(&mut stdout, result, *json);
        }
        Some(ConfigCommand::Init { json, answers }) => {
            return crate::init::run(*json, answers.as_deref())
        }
        Some(ConfigCommand::Migrate { json }) => {
            let result = config::global_path()
                .and_then(|path| config::migrate::migrate(&path))
                .map(|migration| serde_json::to_value(migration).expect("migration serializes"));
            return config_result(&mut stdout, result.map_err(Into::into), *json);
        }
        None => {
            let mut frontend = vec![OsString::from("--settings")];
            if let Some(query) = &config.query {
                frontend.push(query.into());
            }
            return launch_tui(&frontend, false);
        }
    }
    Ok(0)
}

fn config_result(
    stdout: &mut impl Write,
    result: Result<serde_json::Value>,
    json: bool,
) -> Result<i32> {
    match result {
        Ok(value) => {
            if json {
                serde_json::to_writer(stdout.by_ref(), &value)?;
                stdout.write_all(b"\n")?;
            }
            Ok(0)
        }
        Err(error) if json => {
            let message = error.to_string();
            let file = config::global_path().ok();
            let failure = serde_json::json!({ "error": {
                "message": message,
                "path": file,
                "repair_prompt": format!("diffr could not update my config. The original file was kept.\nConfig file: {}\nProblem: {message}\nRead the config, fix the reported problem, and retry the command. Preserve my settings, custom prompts, and credentials. Do not print credentials or reset the config.", file.as_ref().map(|path| path.display().to_string()).unwrap_or_default())
            }});
            serde_json::to_writer(stdout.by_ref(), &failure)?;
            stdout.write_all(b"\n")?;
            Ok(2)
        }
        Err(error) => Err(error),
    }
}

/// `comparison` passes the arguments after `--` as the comparison to open;
/// otherwise they are frontend flags such as `--settings`.
fn launch_tui(args: &[OsString], comparison: bool) -> Result<i32> {
    if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
        let alternative = if comparison {
            "--format ndjson"
        } else {
            "config show/set"
        };
        return Err(format!(
            "diffr's terminal UI needs a terminal; use {alternative} for non-interactive use"
        )
        .into());
    }
    let mut command = if let Some(entry) = std::env::var_os("DIFFR_TUI_ENTRY") {
        let bun = std::env::var_os("DIFFR_BUN").unwrap_or_else(|| "bun".into());
        let mut command = std::process::Command::new(bun);
        command.arg("run").arg(entry);
        command
    } else {
        let sibling = std::env::current_exe()?
            .with_file_name(format!("diffr-tui{}", std::env::consts::EXE_SUFFIX));
        std::process::Command::new(if sibling.is_file() {
            sibling
        } else {
            PathBuf::from("diffr-tui")
        })
    };
    if comparison {
        command
            .arg("--diffr")
            .arg(std::env::current_exe()?)
            .arg("--")
            .args(args);
    } else {
        // `bun run main.tsx --settings --diffr <exe> [query]`
        command
            .arg(&args[0])
            .arg("--diffr")
            .arg(std::env::current_exe()?)
            .args(&args[1..]);
    }
    // Unix exec replaces this process, so signals to diffr's PID reach the TUI
    // directly. std has no portable exec; other platforms spawn and wait.
    #[cfg(unix)]
    let result: io::Result<i32> = {
        use std::os::unix::process::CommandExt;
        Err(command.exec())
    };
    #[cfg(not(unix))]
    let result = command.status().map(|status| status.code().unwrap_or(2));

    result.map_err(|error| format!("Could not launch terminal frontend: {error}.").into())
}

fn run_pprint(args: &PprintArgs) -> Result<i32> {
    let input: Box<dyn io::BufRead> = match &args.input {
        Some(path) if path != Path::new("-") => {
            Box::new(io::BufReader::new(std::fs::File::open(path)?))
        }
        _ => Box::new(io::stdin().lock()),
    };
    crate::pprint::run(input, &mut io::stdout().lock(), &args.open)
        .map_err(|error| format!("{error:#}"))?;
    Ok(0)
}
