//! What `diffr config init` installs, and `diffr upgrade` and `diffr
//! uninstall`, which update and remove it.
use crate::git::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

/// Where the plugin comes from, for Claude Code.
const MARKETPLACE: &str = "devfast";
const MARKETPLACE_SOURCE: &str = "devdotfast/whiteboard";
const PLUGIN: &str = "diffr@devfast";
const INSTALL_SCRIPT: &str = "https://install.dev.fast/diffr";
/// Where diffr comes from, for Homebrew and Cargo.
const FORMULA: &str = "devdotfast/tap/diffr";
const CRATE: &str = "diffr-cli";

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Agent {
    ClaudeCode,
}

impl Agent {
    pub(crate) const ALL: [Agent; 1] = [Agent::ClaudeCode];

    pub(crate) fn id(self) -> &'static str {
        match self {
            Agent::ClaudeCode => "claude-code",
        }
    }

    pub(crate) fn title(self) -> &'static str {
        match self {
            Agent::ClaudeCode => "Claude Code",
        }
    }

    /// The agents whose command is on PATH, which are the ones `config init`
    /// can install the plugin for.
    pub(crate) fn found() -> Vec<Agent> {
        Agent::ALL
            .into_iter()
            .filter(|agent| match agent {
                Agent::ClaudeCode => claude_path().is_some(),
            })
            .collect()
    }

    /// Why `config init` skips this agent: its command is not on PATH.
    pub(crate) fn missing(self) -> &'static str {
        match self {
            Agent::ClaudeCode => CLAUDE_MISSING,
        }
    }

    /// `step` hears what each slow command is about to do.
    pub(crate) fn install(self, step: &mut dyn FnMut(&str)) -> Result<()> {
        match self {
            Agent::ClaudeCode => {
                let list = claude(&["plugin", "marketplace", "list", "--json"])?;
                let marketplaces: Vec<Value> = serde_json::from_slice(&list)?;
                if marketplaces
                    .iter()
                    .any(|marketplace| marketplace["name"] == MARKETPLACE)
                {
                    step("Updating the devfast plugin marketplace in Claude Code");
                    claude(&["plugin", "marketplace", "update", MARKETPLACE])?;
                } else {
                    step("Adding the devfast plugin marketplace to Claude Code");
                    claude(&["plugin", "marketplace", "add", MARKETPLACE_SOURCE])?;
                }
                step("Installing the diffr plugin in Claude Code");
                claude(&["plugin", "install", PLUGIN, "--scope", "user"])?;
                Ok(())
            }
        }
    }

    fn upgrade(self, step: &mut dyn FnMut(&str)) -> Result<()> {
        match self {
            Agent::ClaudeCode => {
                step("Updating the devfast plugin marketplace in Claude Code");
                claude(&["plugin", "marketplace", "update", MARKETPLACE])?;
                step("Updating the diffr plugin in Claude Code");
                claude(&["plugin", "update", PLUGIN])?;
                Ok(())
            }
        }
    }

    pub(crate) fn remove(self, step: &mut dyn FnMut(&str)) -> Result<()> {
        match self {
            Agent::ClaudeCode => {
                step("Removing the diffr plugin from Claude Code");
                claude(&["plugin", "uninstall", PLUGIN])?;
                Ok(())
            }
        }
    }
}

/// The agents `config init` installed the plugin for, kept outside the
/// config directory so it is never synced to another machine.
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Record {
    pub(crate) agents: Vec<Agent>,
}

impl Record {
    fn path() -> Result<PathBuf> {
        let dir = match std::env::var_os("XDG_STATE_HOME") {
            Some(dir) if !dir.is_empty() => PathBuf::from(dir),
            _ => home()?.join(".local").join("state"),
        };
        Ok(dir.join("diffr").join("install.json"))
    }

    pub(crate) fn load() -> Result<Self> {
        let path = Self::path()?;
        match fs::read(&path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)
                .map_err(|error| format!("{}: {error}", path.display()))?),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(format!("{}: {error}", path.display()).into()),
        }
    }

    pub(crate) fn save(&self) -> Result<()> {
        let path = Self::path()?;
        fs::create_dir_all(path.parent().expect("the record is in a directory"))?;
        fs::write(&path, serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }
}

/// How this diffr was installed, from where its binary is.
enum Method {
    Brew,
    Cargo,
    /// install.sh, or an archive extracted by hand, into this directory.
    Script(PathBuf),
}

impl Method {
    fn find() -> Result<Self> {
        let exe = std::env::current_exe()?.canonicalize()?;
        let dir = exe
            .parent()
            .expect("an executable is in a directory")
            .to_owned();
        let parts: Vec<_> = exe.components().map(|part| part.as_os_str()).collect();
        if parts.iter().any(|part| *part == "node_modules") {
            return Err(format!(
                "{} is likely managed by Whiteboard; skipping automatic deletion for safety (remove via Whiteboard app instead)",
                exe.display()
            )
            .into());
        }
        if parts
            .windows(2)
            .any(|pair| pair[0] == "Cellar" && pair[1] == "diffr")
        {
            return Ok(Method::Brew);
        }
        let cargo = match std::env::var_os("CARGO_HOME") {
            Some(cargo) => PathBuf::from(cargo),
            None => home()?.join(".cargo"),
        };
        if cargo.join("bin").canonicalize().is_ok_and(|bin| bin == dir) {
            return Ok(Method::Cargo);
        }
        Ok(Method::Script(dir))
    }
}

/// `diffr upgrade`: the newest release, the way this diffr was installed,
/// then each recorded agent's plugin.
pub(crate) fn upgrade() -> Result<i32> {
    match Method::find()? {
        Method::Brew => run(Command::new("brew").args(["upgrade", FORMULA]))?,
        Method::Cargo => run(Command::new("cargo").args(["install", "--locked", CRATE]))?,
        Method::Script(dir) => {
            if cfg!(windows) {
                return Err("diffr upgrade runs install.sh, which supports macOS and Linux".into());
            }
            let script = host(Command::new("curl").args(["-fsSL", INSTALL_SCRIPT]))?;
            let mut sh = Command::new("sh")
                .arg("-s")
                .env("DIFFR_INSTALL_DIR", dir)
                .stdin(Stdio::piped())
                .spawn()
                .map_err(|error| format!("could not run sh: {error}"))?;
            sh.stdin
                .take()
                .expect("stdin is piped")
                .write_all(&script)?;
            let status = sh.wait()?;
            if !status.success() {
                return Err(format!("install.sh failed ({status})").into());
            }
        }
    }
    for agent in Record::load()?.agents {
        agent.upgrade(&mut |message| eprintln!("{message}"))?;
    }
    Ok(0)
}

/// `diffr uninstall`: remove each recorded agent's plugin, the record, and
/// diffr, the way it was installed. The config directory stays: Whiteboard
/// reads it too.
pub(crate) fn uninstall() -> Result<i32> {
    let method = Method::find()?;
    let mut record = Record::load()?;
    while let Some(agent) = record.agents.first().copied() {
        agent.remove(&mut |message| eprintln!("{message}"))?;
        record.agents.remove(0);
        record.save()?;
    }
    let path = Record::path()?;
    let state = path.parent().expect("the record is in a directory");
    gone(state, fs::remove_dir_all(state))?;
    match method {
        Method::Brew => run(Command::new("brew").args(["uninstall", FORMULA]))?,
        Method::Cargo => run(Command::new("cargo").args(["uninstall", CRATE]))?,
        Method::Script(dir) => {
            for name in ["diffr", "diffr-tui"] {
                let binary = dir.join(format!("{name}{}", std::env::consts::EXE_SUFFIX));
                gone(&binary, fs::remove_file(&binary))?;
            }
            eprintln!("Removed diffr from {}", dir.display());
        }
    }
    Ok(0)
}

/// The result of removing `path`; one that was already gone is fine.
fn gone(path: &Path, removal: io::Result<()>) -> Result<()> {
    match removal {
        Err(error) if error.kind() != io::ErrorKind::NotFound => {
            Err(format!("{}: {error}", path.display()).into())
        }
        _ => Ok(()),
    }
}

pub(crate) fn home() -> Result<PathBuf> {
    Ok(dirs::home_dir().ok_or("no home directory for this user")?)
}

const CLAUDE_MISSING: &str = "Claude Code's `claude` command is not on your PATH. Install \
     Claude Code (https://code.claude.com/docs/en/setup), or open a new terminal if you just \
     did, then run `diffr config init`.";

/// Where `claude` is on PATH, found the way `Command::new("claude")` finds it.
fn claude_path() -> Option<PathBuf> {
    let name = format!("claude{}", std::env::consts::EXE_SUFFIX);
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|dir| dir.join(&name))
        .find(|path| path.is_file())
}

fn claude(args: &[&str]) -> Result<Vec<u8>> {
    let Some(path) = claude_path() else {
        return Err(CLAUDE_MISSING.into());
    };
    host(Command::new(path).args(args))
}

/// Run a host command. Its output is kept, so prompts and `--json` stay
/// clean, and shown only when it fails.
fn host(command: &mut Command) -> Result<Vec<u8>> {
    let output = command
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("could not run {}: {error}", describe(command)))?;
    if !output.status.success() {
        return Err(format!(
            "{} failed ({}):\n{}{}",
            describe(command),
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    Ok(output.stdout)
}

/// Run a package manager where the person sees its progress.
fn run(command: &mut Command) -> Result<()> {
    let status = command
        .stdin(Stdio::null())
        .status()
        .map_err(|error| format!("could not run {}: {error}", describe(command)))?;
    if !status.success() {
        return Err(format!("{} failed ({status})", describe(command)).into());
    }
    Ok(())
}

fn describe(command: &Command) -> String {
    std::iter::once(command.get_program())
        .chain(command.get_args())
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ")
}
