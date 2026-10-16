# Connect your agent

Whiteboard connects to your coding agent through
[MCP](https://modelcontextprotocol.io/), so any agent that supports MCP can
create whiteboards. Whiteboard sets up Claude Code, Codex, Cursor, OpenCode, Pi,
oh-my-pi, and Copilot CLI for you; see [Other agents](#other-agents) for the
rest.

Keep Whiteboard open and
[install the `whiteboard` command](quick-start.md#install-the-whiteboard-command)
before setup.

## Connect from Whiteboard

The first time you open Whiteboard, the **Install Whiteboard** screen lists the
agents on your machine. Check the ones you use and select **Install**. To
connect an agent later, open Settings and use **Agents**.

## Connect from a terminal

List the agents on this machine and whether each is connected:

```sh
whiteboard connect --detect
```

Connect one agent, or `all`, the same way Whiteboard does:

```sh
whiteboard connect --yes claude
```

Without `--yes`, `whiteboard connect <agent>` prints the setup steps instead.
You can run them yourself or paste them into your agent. The agent names are
`claude`, `codex`, `cursor`, `opencode`, `pi`, `omp`, and `copilot`.

## Set up by hand

These are the steps that `whiteboard connect` runs for the most common agents.

### Claude Code

Install the plugin on macOS or Linux:

```sh
claude plugin marketplace add devdotfast/whiteboard
claude plugin install whiteboard@devfast --scope user
```

On Windows, add MCP directly:

```powershell
claude mcp add --scope user --transport stdio whiteboard -- cmd /d /c whiteboard mcp
```

See the [Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

### Codex

Install the plugin:

```sh
codex plugin marketplace add devdotfast/whiteboard
codex plugin add whiteboard@devfast
```

See the [Codex MCP guide](https://developers.openai.com/codex/extend/mcp).

### OpenCode v2

On macOS or Linux, add Whiteboard for all your projects:

```sh
opencode mcp add whiteboard --global -- sh -c 'exec "$HOME/.local/bin/whiteboard" mcp'
```

On Windows:

```powershell
opencode mcp add whiteboard --global -- cmd /d /c whiteboard mcp
```

See the [OpenCode v2 MCP guide](https://opencode.ai/v2/docs/mcp-servers).

### Copilot CLI

Install the plugin on macOS or Linux:

```sh
copilot plugin marketplace add devdotfast/whiteboard
copilot plugin install whiteboard@devfast
```

On Windows, add MCP directly:

```powershell
copilot mcp add whiteboard -- cmd /d /c whiteboard mcp
```

## Test the connection

Restart your agent after setup. Run `/mcp` in Claude Code or Codex, or `/mcps`
in OpenCode, to see the connection. Then ask your agent:

```text
Call session_get_instructions on the Whiteboard server to confirm the connection.
```

## Ask

**Ask** lets you question a review from inside Whiteboard, and runs an agent
to answer. It works with Claude Code, Codex, Cursor (through `cursor-agent`),
OpenCode, and Pi, using the sign-ins already on your machine. Other agents can
create whiteboards but cannot answer in Ask.

## Other agents

For any other agent, add a local MCP server that runs `whiteboard mcp`. The format
depends on your agent. This example is OpenCode v2's config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "whiteboard": {
        "type": "local",
        "command": ["sh", "-c", "exec \"$HOME/.local/bin/whiteboard\" mcp"]
      }
    }
  }
}
```
