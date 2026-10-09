//! `diffr config init`: which agents get the diffr plugin, and which provider
//! writes summaries. A person answers prompts in a terminal; an agent reads
//! the questions with `--json` and sends the answers back as JSON.
use crate::config::{self, Config};
use crate::git::Result;
use crate::install::{Agent, Record};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    fs,
    io::{self, IsTerminal, Read, Write},
    path::Path,
};

const KEY_INSTRUCTIONS: &str = "To enable pseudocode summarization, we need:
1. An API Key from a supported provider (OpenAI, Anthropic, or Gemini-API compatible)
2. This API key can also be sourced from the environment
3. Otherwise, if that's not convenient, you can grab an API key and provide it to your agent (securely).
";

/// The summarizer's options in `config schema`.
const SUMMARIZE_SCHEMA: &str =
    "/properties/plugins/properties/shape/properties/bundled/properties/summarize/properties";
const SUMMARIZE: &str = "plugins.shape.bundled.summarize";

const AGENTS_QUESTION: &str = "Which agents would you like to install the diffr plugin for?";
const SUMMARIES_QUESTION: &str = "Would you like pseudocode summaries of code?";
const PROVIDER_QUESTION: &str = "What AI provider would you like to use for summarization?";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Answers {
    agents: Vec<Agent>,
    /// Left out, summaries stay as they are.
    #[serde(default)]
    summaries: Option<Summaries>,
}

/// `"off"`, or `{"provider": "<id>"}`.
#[derive(Deserialize, Serialize)]
#[serde(untagged)]
enum Summaries {
    Off(Off),
    On(On),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Off {
    Off,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct On {
    provider: String,
}

impl Summaries {
    fn provider(&self) -> Option<&str> {
        match self {
            Summaries::Off(_) => None,
            Summaries::On(on) => Some(&on.provider),
        }
    }
}

/// What the questions need: the current answers and the providers.
struct State {
    record: Record,
    config: Config,
    /// Each provider's id, title and key variables, from the schema.
    providers: Vec<(String, String, Vec<String>)>,
}

impl State {
    fn load() -> Result<Self> {
        let schema = Config::schema();
        let options = schema
            .pointer(SUMMARIZE_SCHEMA)
            .expect("the schema has the summarizer's options");
        let ids = options["provider"]["enum"]
            .as_array()
            .expect("providers are an enum");
        let titles = options["provider"]["x-enum-titles"]
            .as_array()
            .expect("providers have titles");
        let details = &options["provider_details"]["x-default-by"]["values"];
        let providers = ids
            .iter()
            .zip(titles)
            .map(|(id, title)| {
                let id = id.as_str().expect("a provider is a string");
                let variables = details[id]["key_variables"]
                    .as_array()
                    .expect("a provider has key variables")
                    .iter()
                    .map(|variable| {
                        variable
                            .as_str()
                            .expect("a variable is a string")
                            .to_owned()
                    })
                    .collect();
                (
                    id.to_owned(),
                    title.as_str().expect("a title is a string").to_owned(),
                    variables,
                )
            })
            .collect();
        Ok(Self {
            record: Record::load()?,
            config: Config::load()?,
            providers,
        })
    }

    fn summarize(&self) -> &Map<String, Value> {
        &self.config.plugins.shape.entries["bundled.summarize"].options
    }

    fn agents(&self) -> Result<Vec<Agent>> {
        let mut agents = Vec::new();
        for agent in Agent::ALL {
            if self.record.agents.contains(&agent) || agent.detected()? {
                agents.push(agent);
            }
        }
        Ok(agents)
    }

    fn on(&self) -> bool {
        self.config
            .plugins
            .shape
            .enabled()
            .any(|(name, _)| name == "bundled.summarize")
    }

    /// The saved provider when summaries are on; otherwise the first with a
    /// key, or the saved one.
    fn provider(&self) -> String {
        let saved = self.summarize()["provider"]
            .as_str()
            .expect("provider is a string");
        if self.on() {
            return saved.to_owned();
        }
        self.providers
            .iter()
            .map(|(id, _, _)| id.as_str())
            .find(|id| self.has_key(id))
            .unwrap_or(saved)
            .to_owned()
    }

    fn variables(&self, provider: &str) -> &[String] {
        &self
            .providers
            .iter()
            .find(|(id, _, _)| id == provider)
            .expect("the provider is in the schema")
            .2
    }

    /// Whether the summarizer has a key for `provider`: the saved one, which
    /// belongs to the saved provider, or one in the environment.
    fn has_key(&self, provider: &str) -> bool {
        let saved = self.summarize()["provider"] == provider
            && self
                .summarize()
                .get("api_key")
                .and_then(Value::as_str)
                .is_some_and(|key| !key.is_empty());
        saved
            || self
                .variables(provider)
                .iter()
                .any(|variable| std::env::var_os(variable).is_some_and(|value| !value.is_empty()))
    }
}

pub(crate) fn run(json: bool, answers: Option<&Path>) -> Result<i32> {
    let state = State::load()?;
    match (json, answers) {
        (true, None) => {
            let mut stdout = io::stdout().lock();
            serde_json::to_writer_pretty(&mut stdout, &questions(&state)?)?;
            stdout.write_all(b"\n")?;
            Ok(0)
        }
        (true, Some(path)) => {
            let result = read_answers(path).and_then(|answers| {
                apply(&state, &answers, None, &mut |_| {})?;
                Ok(outcome(&state, &answers))
            });
            let mut stdout = io::stdout().lock();
            let (value, code) = match result {
                Ok(value) => (value, 0),
                Err(error) => (json!({ "error": { "message": error.to_string() } }), 2),
            };
            serde_json::to_writer(&mut stdout, &value)?;
            stdout.write_all(b"\n")?;
            Ok(code)
        }
        (false, _) => {
            if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
                return Err(
                    "diffr config init is designed for interactive (human) use via terminals; agents and other headless clients should use diffr config init --json"
                        .into(),
                );
            }
            prompt(&state)
        }
    }
}

fn questions(state: &State) -> Result<Value> {
    let mut agents = Vec::new();
    for agent in Agent::ALL {
        agents.push(
            json!({ "value": agent.id(), "label": agent.title(), "detected": agent.detected()? }),
        );
    }
    let providers: Vec<Value> = state
        .providers
        .iter()
        .map(|(id, title, _)| json!({ "value": id, "label": title, "has_key": state.has_key(id) }))
        .collect();
    let ids = |options: &[Value]| -> Vec<Value> {
        options
            .iter()
            .map(|option| option["value"].clone())
            .collect()
    };
    Ok(json!({
        "questions": [
            {
                "id": "agents",
                "question": AGENTS_QUESTION,
                "multi_select": true,
                "options": agents,
                "default": state.agents()?.iter().map(|agent| agent.id()).collect::<Vec<_>>(),
            },
            {
                "id": "summaries",
                "question": SUMMARIES_QUESTION,
                "multi_select": false,
                "optional": true,
                "options": [{ "value": true, "label": "Yes" }, { "value": false, "label": "No" }],
                "default": state.on(),
            },
            {
                "id": "provider",
                "question": PROVIDER_QUESTION,
                "multi_select": false,
                "ask_if": { "summaries": true },
                "options": providers,
                "default": state.provider(),
            },
        ],
        "schema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "required": ["agents"],
            "additionalProperties": false,
            "properties": {
                "agents": { "type": "array", "uniqueItems": true, "items": { "enum": ids(&agents) } },
                "summaries": {
                    "oneOf": [
                        { "const": "off" },
                        {
                            "type": "object",
                            "required": ["provider"],
                            "additionalProperties": false,
                            "properties": { "provider": { "enum": ids(&providers) } },
                        },
                    ],
                },
            },
        },
        "key_instructions": KEY_INSTRUCTIONS,
    }))
}

fn read_answers(path: &Path) -> Result<Answers> {
    let mut text = Vec::new();
    if path == Path::new("-") {
        io::stdin().lock().read_to_end(&mut text)?;
    } else {
        text = fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;
    }
    Ok(serde_json::from_slice(&text)?)
}

/// Install and remove plugins to match the chosen agents, then save the
/// summaries choice. The first failure stops the run, before the config
/// changes.
/// `step` hears each slow step as it starts.
fn apply(
    state: &State,
    answers: &Answers,
    key: Option<String>,
    step: &mut dyn FnMut(&str),
) -> Result<()> {
    let mut summarize = Map::new();
    match &answers.summaries {
        None => {}
        Some(Summaries::Off(_)) => {
            summarize.insert("enabled".into(), false.into());
        }
        Some(Summaries::On(On { provider })) => {
            if !state.providers.iter().any(|(id, _, _)| id == provider) {
                return Err(format!("no supported AI provider named '{provider}'").into());
            }
            summarize.insert("enabled".into(), true.into());
            summarize.insert("provider".into(), provider.clone().into());
            if let Some(key) = key {
                summarize.insert("api_key".into(), key.into());
            }
        }
    }

    let mut record = Record::load()?;
    for agent in Agent::ALL {
        let chosen = answers.agents.contains(&agent);
        let installed = record.agents.contains(&agent);
        if chosen {
            agent.install(step)?;
            if !installed {
                record.agents.push(agent);
            }
        } else if installed {
            agent.remove(step)?;
            record.agents.retain(|other| *other != agent);
        }
        record.save()?;
    }
    if !summarize.is_empty() {
        let patch = json!({ "plugins": { "shape": { "bundled": { "summarize": summarize } } } });
        step("Saving your settings");
        config::store::patch(&config::global_path()?, &patch)?;
    }
    Ok(())
}

fn outcome(state: &State, answers: &Answers) -> Value {
    let provider = answers.summaries.as_ref().and_then(Summaries::provider);
    let key = provider.map(|provider| {
        json!({
            "present": state.has_key(provider),
            "config_key": format!("{SUMMARIZE}.api_key"),
            "variables": state.variables(provider),
            "instructions": KEY_INSTRUCTIONS,
        })
    });
    json!({
        "agents": answers.agents.iter().map(|agent| agent.id()).collect::<Vec<_>>(),
        "summaries": answers.summaries,
        "key": key,
    })
}

fn prompt(state: &State) -> Result<i32> {
    cliclack::intro("diffr")?;
    let mut agents = cliclack::multiselect(AGENTS_QUESTION)
        .initial_values(state.agents()?)
        .required(false);
    for agent in Agent::ALL {
        let hint = if agent.detected()? { "found" } else { "" };
        agents = agents.item(agent, agent.title(), hint);
    }
    let agents = agents.interact()?;

    let on = cliclack::confirm(SUMMARIES_QUESTION)
        .initial_value(state.on())
        .interact()?;
    let (summaries, key) = if on {
        let mut providers = cliclack::select(PROVIDER_QUESTION).initial_value(state.provider());
        for (id, title, _) in &state.providers {
            let hint = if state.has_key(id) {
                "envvar detected"
            } else {
                ""
            };
            providers = providers.item(id.clone(), title, hint);
        }
        let provider = providers.interact()?;
        // A key in the environment or the config is enough; otherwise one is required.
        let key = if state.has_key(&provider) {
            None
        } else {
            let (_, title, _) = state
                .providers
                .iter()
                .find(|(id, _, _)| *id == provider)
                .expect("the provider is in the schema");
            Some(
                cliclack::password(format!("{title} API key"))
                    .mask('▪')
                    .interact()?,
            )
        };
        (Summaries::On(On { provider }), key)
    } else {
        (Summaries::Off(Off::Off), None)
    };

    let answers = Answers {
        agents,
        summaries: Some(summaries),
    };
    // Each step gets a spinner, ticked off when the next one starts.
    let mut current: Option<(cliclack::ProgressBar, String)> = None;
    let applied = apply(state, &answers, key, &mut |message| {
        if let Some((spinner, done)) = current.take() {
            spinner.stop(done);
        }
        let spinner = cliclack::spinner();
        spinner.start(message);
        current = Some((spinner, message.to_owned()));
    });
    match (applied, current) {
        (Ok(()), Some((spinner, done))) => spinner.stop(done),
        (Ok(()), None) => {}
        // The spinner shows the error, so it is not printed again.
        (Err(error), Some((spinner, _))) => {
            spinner.error(&error);
            return Ok(2);
        }
        (Err(error), None) => return Err(error),
    }
    cliclack::outro("diffr is ready to use! Hope you enjoy some beautiful diffs")?;
    Ok(0)
}
