//! `diffr config init`: which agents get the diffr plugin, and which provider
//! writes summaries. A person answers prompts in a terminal; an agent reads
//! the questions with `--json` and sends the answers back as JSON.
use crate::config::{self, Config};
use crate::git::Result;
use crate::install::{Agent, Record};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{
    fs,
    io::{self, IsTerminal, Read, Write},
    path::Path,
};

// TODO(sid): how the person sets the summaries key without the agent.
const KEY_INSTRUCTIONS: &str = "TODO";

/// The summarizer's options in `config schema`.
const SUMMARIZE_SCHEMA: &str =
    "/properties/plugins/properties/shape/properties/bundled/properties/summarize/properties";
const SUMMARIZE: &str = "plugins.shape.bundled.summarize";
const OFF: &str = "off";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Answers {
    agents: Vec<Agent>,
    /// A provider, or `off`.
    summaries: String,
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

    fn summaries(&self) -> String {
        let on = self
            .config
            .plugins
            .shape
            .enabled()
            .any(|(name, _)| name == "bundled.summarize");
        if on {
            self.summarize()["provider"]
                .as_str()
                .expect("provider is a string")
                .to_owned()
        } else {
            self.providers
                .iter()
                .map(|(id, _, _)| id)
                .find(|id| self.has_key(id))
                .map_or_else(|| OFF.to_owned(), Clone::clone)
        }
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
                apply(&state, &answers, None)?;
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
                    "diffr config init needs a terminal; diffr config init --json prints its questions"
                        .into(),
                );
            }
            prompt(&state)?;
            Ok(0)
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
    let mut providers: Vec<Value> = state
        .providers
        .iter()
        .map(|(id, title, _)| json!({ "value": id, "label": title, "has_key": state.has_key(id) }))
        .collect();
    providers.push(json!({ "value": OFF, "label": "Off" }));
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
                "question": "Which agents should get the diffr plugin?",
                "multi_select": true,
                "options": agents,
                "default": state.agents()?.iter().map(|agent| agent.id()).collect::<Vec<_>>(),
            },
            {
                "id": "summaries",
                "question": "Which provider should write summaries?",
                "multi_select": false,
                "options": providers,
                "default": state.summaries(),
            },
        ],
        "schema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "required": ["agents", "summaries"],
            "additionalProperties": false,
            "properties": {
                "agents": { "type": "array", "uniqueItems": true, "items": { "enum": ids(&agents) } },
                "summaries": { "enum": ids(&providers) },
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
fn apply(state: &State, answers: &Answers, key: Option<String>) -> Result<()> {
    let mut summarize = Map::new();
    if answers.summaries == OFF {
        summarize.insert("enabled".into(), false.into());
    } else {
        if !state
            .providers
            .iter()
            .any(|(id, _, _)| *id == answers.summaries)
        {
            return Err(format!("no summaries provider named '{}'", answers.summaries).into());
        }
        summarize.insert("enabled".into(), true.into());
        summarize.insert("provider".into(), answers.summaries.clone().into());
        if let Some(key) = key {
            summarize.insert("api_key".into(), key.into());
        }
    }
    let patch = json!({ "plugins": { "shape": { "bundled": { "summarize": summarize } } } });

    let mut record = Record::load()?;
    for agent in Agent::ALL {
        let chosen = answers.agents.contains(&agent);
        let installed = record.agents.contains(&agent);
        if chosen {
            agent.install()?;
            if !installed {
                record.agents.push(agent);
            }
        } else if installed {
            agent.remove()?;
            record.agents.retain(|other| *other != agent);
        }
        record.save()?;
    }
    config::store::patch(&config::global_path()?, &patch)?;
    Ok(())
}

fn outcome(state: &State, answers: &Answers) -> Value {
    let key = (answers.summaries != OFF).then(|| {
        json!({
            "present": state.has_key(&answers.summaries),
            "config_key": format!("{SUMMARIZE}.api_key"),
            "variables": state.variables(&answers.summaries),
            "instructions": KEY_INSTRUCTIONS,
        })
    });
    json!({
        "agents": answers.agents.iter().map(|agent| agent.id()).collect::<Vec<_>>(),
        "summaries": answers.summaries,
        "key": key,
    })
}

fn prompt(state: &State) -> Result<()> {
    cliclack::intro("diffr")?;
    let mut agents = cliclack::multiselect("Which agents should get the diffr plugin?")
        .initial_values(state.agents()?)
        .required(false);
    for agent in Agent::ALL {
        let hint = if agent.detected()? { "found" } else { "" };
        agents = agents.item(agent, agent.title(), hint);
    }
    let agents = agents.interact()?;

    let mut summaries =
        cliclack::select("Which provider should write summaries?").initial_value(state.summaries());
    for (id, title, _) in &state.providers {
        let hint = if state.has_key(id) { "key found" } else { "" };
        summaries = summaries.item(id.clone(), title, hint);
    }
    let summaries = summaries.item(OFF.to_owned(), "Off", "").interact()?;

    let key = if summaries != OFF && !state.has_key(&summaries) {
        let key = cliclack::password(format!(
            "API key (or leave blank and set {})",
            state.variables(&summaries).join(" or ")
        ))
        .mask('▪')
        .allow_empty()
        .interact()?;
        (!key.is_empty()).then_some(key)
    } else {
        None
    };

    let answers = Answers { agents, summaries };
    let spinner = cliclack::spinner();
    spinner.start("Saving");
    match apply(state, &answers, key) {
        Ok(()) => spinner.stop("Saved"),
        Err(error) => {
            spinner.error(&error);
            return Err(error);
        }
    }
    cliclack::outro("diffr is ready")?;
    Ok(())
}
