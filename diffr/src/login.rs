//! Agent sign-ins used in place of an API key. The agent refreshes them
//! itself, so its own session is untouched.
use base64::Engine;
use serde_json::{json, Map, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

const REFRESH_MARGIN_MS: u64 = 5 * 60 * 1000;

pub(crate) const LOGINS: [&str; 1] = ["codex"];

/// Fill `api_key` from the provider's `login` when no key is set.
pub(crate) fn fill(name: &str, options: &mut Map<String, Value>) {
    let details = options.get("provider_details");
    let Some(login) = details.and_then(|details| details.get("login")?.as_str()) else {
        return;
    };
    let set = |key: &str| !key.is_empty();
    let in_environment = details
        .and_then(|details| details.get("key_variables")?.as_array())
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .any(|variable| std::env::var(variable).is_ok_and(|key| set(&key)));
    let in_options = options
        .get("api_key")
        .and_then(Value::as_str)
        .is_some_and(set);
    if in_options || in_environment {
        return;
    }
    match token(login) {
        Ok(token) => {
            options.insert("api_key".into(), token.into());
        }
        Err(why) => eprintln!("plugins.shape.{name}: off for this run: {why}"),
    }
}

pub(crate) fn status() -> Value {
    LOGINS
        .iter()
        .map(|login| {
            let state = match token(login) {
                Ok(_) => json!({ "ready": true }),
                Err(why) => json!({ "ready": false, "message": why }),
            };
            (login.to_string(), state)
        })
        .collect::<Map<_, _>>()
        .into()
}

pub(crate) fn token(login: &str) -> Result<String, String> {
    match login {
        "codex" => codex(),
        _ => Err(format!("unknown sign-in {login}")),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as u64)
}

fn home(variable: &str, default: &str) -> Option<PathBuf> {
    std::env::var_os(variable)
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(default)))
}

fn codex() -> Result<String, String> {
    let path = home("CODEX_HOME", ".codex")
        .ok_or("no home directory for this user")?
        .join("auth.json");
    let token = codex_token(&path)?;
    if expiry_ms(&token).is_none_or(|at| at > now_ms() + REFRESH_MARGIN_MS) {
        return Ok(token);
    }
    refresh_codex();
    let token = codex_token(&path)?;
    if expiry_ms(&token).is_some_and(|at| at <= now_ms()) {
        return Err("the Codex sign-in expired: run `codex login`, and keep `codex` on PATH so diffr can renew it".into());
    }
    Ok(token)
}

fn codex_token(path: &Path) -> Result<String, String> {
    let saved = std::fs::read_to_string(path).map_err(|_| {
        format!(
            "no Codex sign-in found in {}: run `codex login`, with cli_auth_credentials_store = \"file\" if Codex keeps it in the system keyring",
            path.display()
        )
    })?;
    let saved: Value =
        serde_json::from_str(&saved).map_err(|_| "the Codex sign-in is unreadable")?;
    saved["tokens"]["access_token"]
        .as_str()
        .map(str::to_owned)
        .ok_or("Codex is not signed in with ChatGPT: run `codex login`, or use the OpenAI provider with an API key".into())
}

fn refresh_codex() -> Option<()> {
    let mut child = Command::new("codex")
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    for request in [
        json!({ "id": 1, "method": "initialize", "params": { "clientInfo": { "name": "diffr", "version": env!("CARGO_PKG_VERSION") } } }),
        json!({ "method": "initialized" }),
        json!({ "id": 2, "method": "account/read", "params": { "refreshToken": true } }),
    ] {
        writeln!(stdin, "{request}").ok()?;
    }
    // Codex exits without answering once stdin closes.
    BufReader::new(child.stdout.take()?)
        .lines()
        .map_while(Result::ok)
        .any(|line| serde_json::from_str::<Value>(&line).is_ok_and(|reply| reply["id"] == 2));
    drop(stdin);
    child.wait().ok().map(drop)
}

/// A JWT's `exp`, in milliseconds.
fn expiry_ms(token: &str) -> Option<u64> {
    let payload = token.split('.').nth(1)?;
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    let claims: Value = serde_json::from_slice(&payload).ok()?;
    claims["exp"].as_u64().map(|exp| exp * 1000)
}
