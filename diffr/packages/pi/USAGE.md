# Diffr for Pi

Tested with Pi 0.99.1 and 1.1.0. Use `diffr` on PATH and Pi's fullscreen terminal renderer for mouse input.
From `diffr/packages`, run `bun install`, then `bun run --cwd pi build`.
Launch `pi/bin/diffr-pi.mjs` (or `pi --tui-mode fullscreen -e /absolute/path/to/pi/dist/index.js`).

- `/diffr [arguments]` opens a floating panel at the right. Arguments go directly to Diffr, without a shell.
- The model can call `diffr_open({args: [...]})`. It opens without taking keyboard focus and acknowledges a valid comparison start. Pi registers this tool through its native extension API; no separate MCP process is needed.
- F7 focuses or reopens the panel. Escape returns to chat; a fullscreen overlay hides until F7.
- F6 or the top bar toggles fullscreen. `/diffr-fullscreen` also opens or toggles it.
- Drag source lines, then Enter to append references and contents to the current draft. Nothing is submitted.
- `V` marks a file viewed, `zM` folds scopes, `zR` unfolds them, and `\\` toggles files.
- `q` in the pane or `/diffr-close` closes it. Session changes also close it.

The panel covers part of the chat; it does not resize the native transcript into a left column.
Pi's public `ctx.ui.custom()` overlay API owns placement and focus. No private layout fields are used.
The panel leaves the bottom quarter of the terminal available for the draft. Fullscreen shows only Diffr.
Viewed marks and folds survive view switches, but reopening starts a new comparison.
`--diffr-bin /path/to/diffr` selects a binary; `--diffr-input /path/to/recording.ndjson` opens a saved comparison.
