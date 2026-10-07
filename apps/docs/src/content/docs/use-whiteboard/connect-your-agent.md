---
title: Connect your agent
slug: agents
description: Connect Claude Code, Codex, or OpenCode to Whiteboard.
---

Whiteboard connects to your agent through
[MCP](https://modelcontextprotocol.io/). Whiteboard provides first-class support
for:

- [Claude Code](#claude-code)
- [Codex](#codex)
- [OpenCode v2](#opencode-v2)

Keep Whiteboard open and [enable the command](/installation/#enable-the-command)
before setup.

## Claude Code

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

## Codex

Install the plugin:

```sh
codex plugin marketplace add devdotfast/whiteboard
codex plugin add whiteboard@devfast
```

See the [Codex MCP guide](https://developers.openai.com/codex/extend/mcp).

## OpenCode v2

On macOS or Linux, add Whiteboard for all your projects:

```sh
opencode mcp add whiteboard --global -- sh -c 'exec "$HOME/.local/bin/whiteboard" mcp'
```

On Windows:

```powershell
opencode mcp add whiteboard --global -- cmd /d /c whiteboard mcp
```

See the [OpenCode v2 MCP guide](https://opencode.ai/v2/docs/mcp-servers).

## Test the connection

Restart your agent after setup. Run `/mcp` in Claude Code or Codex, or `/mcps`
in OpenCode to see the connection. Ask your agent:

```text
Call session_get_instructions on the Whiteboard server to confirm the connection.
```

## Manual setup

Add Whiteboard to your agent's MCP configuration. The format depends on your
agent. This example uses OpenCode v2:

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
