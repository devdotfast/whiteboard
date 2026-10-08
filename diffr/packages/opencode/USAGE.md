# Diffr for OpenCode

Tested with OpenCode 1.18.32 (its v1 TUI plugin API). Install workspace dependencies
with `bun install` from `diffr/packages`, then add an absolute source path to your
OpenCode `tui.json` plugin array:

```json
{
  "plugin": ["/absolute/path/to/diffr/packages/opencode/src/index.tsx"]
}
```

OpenCode compiles the Solid component using its own renderer. Do not bundle a second
OpenTUI renderer into the host. The development versions match OpenCode 1.18.32.

- `/diffr` opens the working-tree comparison in the native session sidebar.
- Click the pane or use `/diffr-focus` to focus its keyboard controls.
- F6, the top bar, or `/diffr-fullscreen` toggles a full-screen overlay.
- Drag source lines and press Enter to append their references and contents to the
  existing native draft. This never submits the prompt.
- `V` toggles viewed state, `zM` folds scopes, `zR` unfolds them, `\\` opens files.
- Escape returns focus to chat. `q` or `/diffr-close` closes the comparison.

The supported sidebar is fixed at 42 terminal columns, with about 37 available to
Diffr. Its comparison occupies half the terminal height to leave room for native
sidebar content. Use `h`/`l` to pan, or full screen for wider code. When OpenCode hides
the sidebar (including small terminals), Diffr falls back to the full-screen overlay.
An adjustable chat/diff split needs additional host layout support.

Comparisons are bound to the session that opened them. Draft transfer refuses a
different session. Opening from the home screen creates an empty local session.
Viewed marks and folds survive split/fullscreen changes and reset on reopening.

Plugin tuple options select a binary, arguments, or a saved test recording:

```json
{
  "plugin": [["/absolute/path/to/opencode/src/index.tsx", {
    "binary": "/path/to/diffr",
    "args": ["HEAD~1", "HEAD"]
  }]]
}
```

Set `input` instead to an NDJSON recording for local UI testing.
