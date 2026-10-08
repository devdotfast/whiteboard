# Diffr for OpenCode

Requires OpenCode **2.0.25**. V2 provides the native `session.panel` extension API:
chat and Diffr occupy separate columns, with a draggable divider and a host-owned
fullscreen mode. V1's fixed 42-column sidebar cannot provide this layout.

Run `bun install` from `diffr/packages`. Add the package directory to `plugins` in
`opencode.json` (the server tool) and `cli.json` (the terminal UI):

```json
{
  "plugins": [{
    "package": "/absolute/path/to/diffr/packages/opencode",
    "options": { "binary": "/path/to/diffr", "args": ["HEAD~1", "HEAD"] }
  }]
}
```

OpenCode resolves local `server.ts` and `tui.tsx` entrypoints. Package exports also
provide the server and `./tui` entrypoints for package loading. The host compiles
Solid JSX; do not bundle another OpenTUI renderer. Set `input` to an NDJSON recording
instead of `binary`/`args` for local UI testing.

- Open a chat session, then run `/diffr` or press F7.
- Diffr takes half the available width by default. Drag the host divider to resize.
- F6, the top bar, or `/diffr-fullscreen` switches between split and fullscreen.
- Drag code and press Enter or click **Add to chat** to append it to the unsent draft.
- `V` marks a file viewed; `zM` folds scopes; `zR` unfolds them; `\\` opens files.
- Escape returns to chat. In fullscreen, it hides the panel. F7 restores the review.
- `q` or `/diffr-close` disposes the comparison. Reopening then starts a new review.

Folds and viewed marks survive presentation changes and hiding the fullscreen panel.
At 80 available columns or fewer, OpenCode forces fullscreen. Add to chat then hides
the review and focuses the existing draft, without submitting it.

V2 currently has no public draft helper. The adapter captures the focused native
`TextareaRenderable` when opening and uses its public `gotoBufferEnd`/`insertText`
methods. It does not read private host fields or search the render tree. Transfer
refuses a destroyed editor or another session; if no editor was focused, focus the
chat draft, close Diffr, and reopen it. This boundary needs retesting when upgrading
the host. Opening from the home screen requests that the user first open a session.

## Model tool

The model calls `diffr_open({args: [...]})` through OpenCode's native tool API.
No separate MCP process is required. The server emits a namespaced plugin RPC event;
only a terminal showing the same session in the same canonical directory can claim
its temporary private Unix reply socket. Success means a valid comparison started.
Errors, cancellation, or a 20-second missing-terminal timeout reach the model.

In split mode, a model-triggered open returns keyboard focus to chat. A narrow
terminal's forced fullscreen necessarily takes focus. This implementation requires
the server and TUI on the same macOS/Linux machine; remote attachment and Windows
are not supported by the reply socket transport.

## Validation

`bun run typecheck` and `bun run test` cover socket routing and real OpenTUI
mouse-selection → draft insertion, including fullscreen return and preserved draft
text. Ghostty testing uses OpenCode 2.0.25 and an isolated local model provider.
