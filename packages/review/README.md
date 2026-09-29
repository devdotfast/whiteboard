# dev.fast Whiteboard

The `@dev.fast/whiteboard` package provides the `whiteboard` CLI for headless review
authoring, sharing, and agent trace capture. It requires Node 24. An npm install
also provides `review` as an alias for `whiteboard`.
`whiteboard server` and `whiteboard trace` run without installing or starting Desktop.
Whiteboard Desktop displays the review canvas; its server owns review
discovery, session state, and presentation. Legacy reviews
published with the removed MDX toolchain have a durable UUID directory under
`${DEV_REVIEW_HOME:-~/.dev}/reviews/<uuid>/` and are imported into the JSON
store when Home lists them or when they are opened.

## Workspace packages

- `@dev.fast/whiteboard`: Node runtime, CLI, and authoring tools. Its
  production dependencies are the external libraries used by the compiled Node
  code; workspace libraries bundled by tsdown are development dependencies.
- `@dev.fast/review-canvas` ([app](app/README.md)): private browser UI, layout
  libraries, and browser tests. It builds separately and is not included in npm.
- `@dev.fast/review-desktop`: installs the Node runtime and copies the built canvas.

### Imports

Import through `@review/*` (`src`) and `@canvas/*` (`app/src`) instead of
`../` paths; keep `./` for siblings. `pnpm lint` enforces this. tsx reads the
aliases from its working directory's tsconfig, so run it from this package or
set `TSX_TSCONFIG_PATH`. `node scripts/rewrite-relative-imports.mjs` (from the
repository root) converts a branch that predates the aliases.

## Migration

To migrate stored reviews with a compatible `whiteboard` command, run:

```sh
whiteboard migrate apply
```

The command normalizes stored review schema versions, regenerates presented
artifacts, converts Jujutsu repositories and Whiteboard-managed checkouts, and
removes legacy global CLI installs and catalog entries. It reports blockers
for items that need manual correction; fix each one and run the command
again. Use `--force` to restart interrupted state.

## Usage

Start or activate Whiteboard Desktop. You can run this command outside a
repository and without a terminal:

```sh
whiteboard app launch --json
```

Reviews are authored through the JSON API: `whiteboard api` calls a tool
directly, and `whiteboard mcp` serves the same catalog over stdio MCP for a
connected agent.

To select a review, run:

```sh
whiteboard app pick
```

Use `whiteboard app pick --session <uuid>` to select a specific review. Bare
`whiteboard app` is an alias for `whiteboard app launch`.

`whiteboard info` is read-only: it lists active reviews bound to the current
worktree, or every worktree in the repository with `--all`.

Whiteboard Desktop is the primary install path for Claude Code, Codex, Cursor,
Pi, and other coding agents. On startup it detects installed agents, offers to
install the CLI and connect them over MCP, and re-syncs after each app
update. It also writes a `whiteboard` shim to `~/.local/bin` that always resolves
to the app's bundled CLI. A standalone CLI defers to the app's bundled copy
whenever Whiteboard Desktop is running.

Agent setup installs only the Whiteboard CLI and the MCP connection. Enabling
Trace capture in Settings ▸ Experimental Features also installs FFF: it
registers the standard `fff` MCP server for Claude and Codex, and installs
`npm:@ff-labs/pi-fff` for Pi. The MCP registration points FFF at
`$DEV_REVIEW_HOME/trace-search` (default `~/.dev/trace-search`). Whiteboard
accepts existing FFF integrations without changes. Silent app-update
synchronization never runs an FFF installer.

The experimental setup configures S3/R2 and enables trace capture for the machine.
Traces go to one selected store: a S3/R2 bucket, or the hosted store
selected explicitly with `whiteboard trace storage use hosted` after `whiteboard
login` and `whiteboard trace allow`. The selection, the store settings, and the
hosted consent list live in `$DEV_REVIEW_HOME/trace/config.json`; an existing
`~/.config/dev-trace` setup keeps selecting the bucket without any change.
Each agent session activates its current repository. Git receives a managed
hook dispatcher that chains the repository's prior hooks. Jujutsu receives a
repository commit-trailer template. A target repository needs no Whiteboard
files.

Trace capture hooks each agent's session lifecycle: Claude Code and Codex
through their hook settings, Pi through a managed extension, and OpenCode
through a managed `~/.config/opencode/plugins/review-trace.ts` plugin. OpenCode
keeps sessions in its own database, so `whiteboard trace sync` renders one with
`opencode export` before upload.

Use `whiteboard trace status` to inspect the machine, current repository, and your
recent hosted uploads. Use `whiteboard trace status --agent-session <id>` for one
session. Repository writers can upload and check their own upload status.
Repository admins can read transcript content. Download links expire after
five minutes. Status reports the store's publication record; it does not
repeat object integrity checks. If the server is unavailable, status reports
"not checked".
Use
`whiteboard trace enable`, `whiteboard trace disable`, or `whiteboard trace repair` only
when you need to manage the current repository manually.

For a missing registration, setup runs the equivalent commands:

```sh
curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fff/v0.11.0/install-mcp.sh | bash
claude mcp add -s user fff -- "$HOME/.local/bin/fff-mcp" "$HOME/.dev/trace-search"
codex mcp add fff -- "$HOME/.local/bin/fff-mcp" "$HOME/.dev/trace-search"
pi install npm:@ff-labs/pi-fff
```

Trace search uses this local flow:

```text
S3/R2 or hosted raw trace
  → temporary download (hosted copies are checksum-verified)
  → normalized JSONL in ~/.dev/trace-search, scoped per store
  → FFF, whiteboard trace show, Whiteboard UI, and quote validation
```

The app-managed command starts the exact macOS bundle that installed it. The
bundle does not need to be under `/Applications`. A repository or standalone
CLI uses the `dev.fast.review` macOS bundle identifier.

If `whiteboard` opens a browser or reports old options, another command shadows
the current CLI. Run `command -v whiteboard`, `whiteboard version`, and
`whiteboard --help`. Remove the legacy PATH entry, or put the app-managed
`~/.local/bin/whiteboard` command first on `PATH`.

To connect an agent by hand, run:

```sh
whiteboard connect <target>
```

for `claude`, `claude-code`, `codex`, `cursor`, `opencode`, `pi`, `omp`, or
`all`. It prints the plugin-install or MCP-registration steps for that agent;
Whiteboard Desktop runs the same steps automatically during agent setup.
