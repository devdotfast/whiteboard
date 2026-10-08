# Diffr for Pi

Tested with Pi 0.99.1. Requires Pi's fullscreen terminal renderer and `diffr` on PATH.

From `diffr/packages`, run `bun install`, then `bun run --cwd pi build`.
Launch `pi/bin/diffr-pi.mjs` (or `pi --tui-mode fullscreen -e /absolute/path/to/pi/dist/index.js`).
This preserves Pi's native editor and transcript, with Diffr alongside them by default.

- `/diffr [arguments]` opens a comparison. Arguments are passed directly to Diffr, without a shell.
- F7 focuses or opens Diffr. Escape returns to chat; clicking the pane also focuses it.
- F6 or the top bar toggles fullscreen. `/diffr-fullscreen` also opens or toggles it.
- Drag source lines, then Enter to append their references and contents to the existing draft. Nothing is submitted.
- `V` marks a file viewed, `z m` folds scopes, `z r` unfolds them, and `\\` toggles files.
- `q` in the pane or `/diffr-close` closes it and restores the host layout.

Below 100 terminal columns, Diffr uses the full screen; Escape closes it to recover chat.
Viewed marks and folds last for the current comparison. Reopening starts a new review.
`--diffr-bin /path/to/diffr` selects a binary; `--diffr-input /path/to/recording.ndjson`
opens a saved comparison for local UI testing.

Pi exposes a layout setter but no getter. `src/layout.ts` isolates the guarded compatibility
access needed to preserve its original layout and editor focus. Unknown host layouts fail
with an error instead of replacing them. Other extensions that replace the layout root may conflict.

Validated in Ghostty: default split, fullscreen toggle, native draft insertion from mouse
selection, scope fold, viewed mark, narrow files screen, and restoring chat on close.
