//! What `diffr config init` installs for each agent, and the record of it.
use crate::git::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs, io,
    path::PathBuf,
    process::{Command, Stdio},
};

/// Where the plugin comes from, for Claude Code.
const MARKETPLACE: &str = "devfast";
const MARKETPLACE_SOURCE: &str = "devdotfast/whiteboard";
const PLUGIN: &str = "diffr@devfast";

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

    pub(crate) fn detected(self) -> Result<bool> {
        let home = home()?;
        Ok(match self {
            Agent::ClaudeCode => home.join(".claude").is_dir(),
        })
    }

    pub(crate) fn install(self) -> Result<()> {
        match self {
            Agent::ClaudeCode => {
                let list = claude(&["plugin", "marketplace", "list", "--json"])?;
                let marketplaces: Vec<Value> = serde_json::from_slice(&list)?;
                if marketplaces
                    .iter()
                    .any(|marketplace| marketplace["name"] == MARKETPLACE)
                {
                    claude(&["plugin", "marketplace", "update", MARKETPLACE])?;
                } else {
                    claude(&["plugin", "marketplace", "add", MARKETPLACE_SOURCE])?;
                }
                claude(&["plugin", "install", PLUGIN, "--scope", "user"])?;
                Ok(())
            }
        }
    }

    pub(crate) fn remove(self) -> Result<()> {
        match self {
            Agent::ClaudeCode => {
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

pub(crate) fn home() -> Result<PathBuf> {
    Ok(dirs::home_dir().ok_or("no home directory for this user")?)
}

fn claude(args: &[&str]) -> Result<Vec<u8>> {
    host(Command::new("claude").args(args))
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

fn describe(command: &Command) -> String {
    std::iter::once(command.get_program())
        .chain(command.get_args())
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ")
}
