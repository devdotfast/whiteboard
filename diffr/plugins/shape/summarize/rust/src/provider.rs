//! Each model API's wire format: where a request goes, how it is
//! authenticated, and where the answer's text is.
use serde::Deserialize;
use serde_json::{json, Value};

/// What `plugin.toml` records per provider, filled in by the host.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Details {
    /// The base URL used when `endpoint` is unset.
    pub endpoint: String,
    /// The environment variables read, in order, when `api_key` is unset.
    pub key_variables: Vec<String>,
    /// Whether a custom endpoint may go without a key, as OpenAI-compatible
    /// servers such as Ollama often do.
    pub keyless_custom_endpoint: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Gemini,
    OpenAi,
    Anthropic,
}

impl Provider {
    pub fn url(self, endpoint: &str, model: &str) -> String {
        let endpoint = endpoint.trim_end_matches('/');
        match self {
            Self::Gemini => format!("{endpoint}/v1beta/models/{model}:generateContent"),
            Self::OpenAi => format!("{endpoint}/chat/completions"),
            Self::Anthropic => format!("{endpoint}/v1/messages"),
        }
    }

    pub fn headers(self, key: Option<&str>) -> Vec<(&'static str, String)> {
        let mut headers = Vec::new();
        if let Some(key) = key {
            headers.push(match self {
                Self::Gemini => ("x-goog-api-key", key.to_owned()),
                Self::OpenAi => ("authorization", format!("Bearer {key}")),
                Self::Anthropic => ("x-api-key", key.to_owned()),
            });
        }
        if self == Self::Anthropic {
            headers.push(("anthropic-version", "2023-06-01".to_owned()));
        }
        headers
    }

    /// Only Gemini gets a temperature: current reasoning models reject one.
    /// OpenAI gets no length limit either, since compatible servers name it
    /// differently; Anthropic's limit also covers thinking, so it has a floor.
    pub fn body(self, model: &str, system: &str, user: &str, max_tokens: usize) -> Value {
        match self {
            Self::Gemini => json!({
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "generationConfig": {
                    "temperature": 0,
                    "maxOutputTokens": max_tokens,
                    "thinkingConfig": {"thinkingBudget": 0},
                },
            }),
            Self::OpenAi => json!({
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            }),
            Self::Anthropic => json!({
                "model": model,
                "max_tokens": max_tokens.max(4096),
                "system": system,
                "messages": [{"role": "user", "content": user}],
            }),
        }
    }

    pub fn text(self, response: &Value) -> Option<&str> {
        match self {
            Self::Gemini => response["candidates"][0]["content"]["parts"]
                .as_array()?
                .last()?["text"]
                .as_str(),
            Self::OpenAi => response["choices"][0]["message"]["content"].as_str(),
            Self::Anthropic => response["content"]
                .as_array()?
                .iter()
                .rev()
                .find(|block| block["type"] == "text")?["text"]
                .as_str(),
        }
    }
}
