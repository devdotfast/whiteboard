# diffr configuration

diffr computes Whiteboard's diffs. Its settings apply to every repository and
to the diffr command line.

## Change a setting

- In Whiteboard: Settings → **Tools** → **Diff display and AI summaries**.
- In a terminal: `diffr config`, or `diffr config set <key> <value>`.
- In `~/.config/diffr/config.toml`. Reopen the review after you edit it.

## Display

| Setting                          | Key                                     |
| -------------------------------- | --------------------------------------- |
| Collapse unchanged lines         | `plugins.shape.bundled.context`         |
| Collapse test bodies             | `plugins.shape.bundled.test-bodies`     |
| Collapse deleted function bodies | `plugins.shape.bundled.deleted-bodies`  |
| Collapse long removed stretches  | `plugins.shape.bundled.removed-runs`    |
| Hide files by tag                | `plugins.classify.bundled.hide`         |
| Hide deleted files               | `plugins.classify.bundled.hide_deleted` |

Hide files by tag defaults to generated and vendored files. To override it for
one path, see [Hidden files](configuration.md#hidden-files).

## AI summaries

diffr can replace large new functions and tests with short pseudocode. It
sends that code to the provider you pick, so summaries are off by default.

To turn them on, check **Enable summaries**, pick a provider, and click
**Save summaries**. **Test setup** tries the provider on sample code without
saving.

| Provider                  | Credential                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Codex                     | Codex's ChatGPT sign-in. Counts against your ChatGPT plan.                            |
| Gemini, OpenAI, Anthropic | An API key in Settings, or `GEMINI_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. |

Summaries longer than two thirds of the function are dropped. Set
`max_length_ratio` to change that.

From the command line:

```toml
[plugins.shape.bundled.summarize]
enabled = true
provider = "codex"
```

### Codex

Run `codex login` once. diffr reads `~/.codex/auth.json` (or
`$CODEX_HOME/auth.json`). If Codex stores its sign-in in
the system keyring, add `cli_auth_credentials_store = "file"` to
`~/.codex/config.toml` and sign in again.

diffr renews the sign-in with the `codex` command, so keep `codex` on PATH.
`diffr config logins` shows
whether the sign-in is ready.
