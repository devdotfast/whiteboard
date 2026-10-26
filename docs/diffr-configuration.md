# diffr configuration

diffr computes the diffs in Whiteboard. Its settings apply to every
repository, and the diffr command line uses the same settings.

## Change a setting

- In Whiteboard, open Settings, then **Tools**, then **Diff display and AI
  summaries**.
- In a terminal, run `diffr config` to open the settings screen, or
  `diffr config set <key> <value>` to change one setting.
- Edit `~/.config/diffr/config.toml`. Reopen the review after you edit it.

## Display

| Setting | What it does | Key |
| --- | --- | --- |
| Collapse unchanged lines | Keeps a few unchanged lines around each change and collapses the rest. **Context lines** sets how many. | `plugins.shape.bundled.context` |
| Collapse test bodies | Collapses the bodies of tests. | `plugins.shape.bundled.test-bodies` |
| Collapse deleted function bodies | Collapses long functions that were deleted. | `plugins.shape.bundled.deleted-bodies` |
| Collapse long removed stretches | Collapses long runs of removed lines. | `plugins.shape.bundled.removed-runs` |
| Hide files by tag | Hides generated and vendored files. See [Hidden files](configuration.md#hidden-files). | `plugins.classify.bundled.hide` |
| Hide deleted files | Hides files that were deleted. | `plugins.classify.bundled.hide_deleted` |

## AI summaries

diffr can replace large new functions and tests with short pseudocode. It
sends those bodies to the provider you pick, so summaries are off until you
turn them on.

### Turn on AI summaries

1. Open Settings, then **Tools**, then **Diff display and AI summaries**.
2. Pick a provider under **AI summaries**.
3. Check **Enable summaries** and click **Save summaries**.

**Test setup** sends a sample function and shows the summary without saving.

### Providers

| Provider | Credential |
| --- | --- |
| Codex | Codex's ChatGPT sign-in. No key needed. |
| Gemini, OpenAI, Anthropic | An API key, entered in Settings or set as `GEMINI_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. |

If Codex is signed in and no other provider has a key, Settings picks Codex.

### Codex

Sign in once with `codex login`. diffr reads `~/.codex/auth.json` (or
`$CODEX_HOME/auth.json`) on every run. Summaries count against your ChatGPT
plan.

If Codex keeps its sign-in in the system keyring, add this to
`~/.codex/config.toml` and sign in again:

```toml
cli_auth_credentials_store = "file"
```

diffr never refreshes the sign-in, so Codex's own session is untouched. The
token lasts about 10 days after Codex last ran. If it has expired, summaries
skip that run and Settings says so. Open Codex once to renew it.

### Short summaries only

A summary that is longer than two thirds of the function is dropped, and the
function stays as code. To change that, set `max_length_ratio`.

### From the command line

```toml
[plugins.shape.bundled.summarize]
enabled = true
provider = "codex"
```

`diffr config logins` prints whether the Codex sign-in is ready.
