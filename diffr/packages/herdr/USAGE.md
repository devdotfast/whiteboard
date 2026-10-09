# Diffr for Herdr

Tested with Herdr 0.7.5, with Pi 0.99.1 as the draft recipient. Requires Bun and Diffr
on the Herdr server's PATH. Run `pnpm install` from the repository root, then register:

```sh
herdr plugin link /absolute/path/to/diffr/packages/herdr
```

From an agent pane, open Diffr through Herdr's plugin pane UI, or:

```sh
herdr plugin pane open --plugin diffr --entrypoint review --direction right --focus
```

The `review` entrypoint defaults to a real terminal split. The `fullscreen` entrypoint
starts zoomed. An explicit `--target-pane ID` binds the review to that agent pane.
F6 or the top row toggles Herdr's zoom; Escape returns to the agent. `q` closes Diffr.

Drag source lines and press Enter to paste their references and contents into the
original agent's draft. Herdr's `pane.send_input` respects the target application's
bracketed-paste mode; the plugin sends an empty key list, never an Enter key. Tested
with Pi's native multiline draft. Other agents must support bracketed paste and
report an idle or done state; their individual draft behavior has not been verified.

Before each transfer, the plugin checks the target terminal identity, detected agent,
and readiness. It refuses shell targets, replaced terminals, busy/blocked agents, and
terminal control characters. If launched from a shell, reviewing still works but
draft transfer is unavailable. Open from a detected agent to enable it.

`V` marks files viewed, `zM` folds scopes, `zR` unfolds scopes, and `\\` toggles files.
The files screen takes over a narrow pane; wide panes show a tree beside the code.
Viewed marks and folds survive zoom changes and last until the comparison closes.

Comparison options are passed as environment variables to the plugin pane:

```sh
herdr plugin pane open --plugin diffr --entrypoint review --focus \
  --env 'DIFFR_ARGS_JSON=["HEAD~1","HEAD"]'
```

`DIFFR_BIN` selects a binary. `DIFFR_INPUT` opens a saved NDJSON recording for offline
UI testing. The comparison uses the original agent pane's working directory, even
though the plugin itself starts from its package directory.

Validated in a disposable Herdr session in Ghostty: split rendering, mouse selection
to an unsent Pi paste block, focus handoff, zoom/unzoom, folding, and viewed state.
Socket tests exercise fragmented replies, API errors, and rejected draft recipients.
