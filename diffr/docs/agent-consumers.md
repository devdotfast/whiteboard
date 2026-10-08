# Agent consumer scope and verification

Research and local verification: October 8, 2026. The implementations build on the
completed Claude Code consumer at `c6a55e961`, including its selection-to-draft work.

## Feasibility and delivered scope

All three hosts can reuse the Claude consumer's diff behavior. The main differences
are their layout APIs and how a selection reaches the native prompt.

| Host | Default display | Full screen | Draft handoff | Main constraint |
| --- | --- | --- | --- | --- |
| Pi 0.99.1 | Native transcript/editor beside Diffr | Replace the layout root temporarily | `ctx.ui.pasteToEditor` | Requires Pi fullscreen mode; reading its prior layout and focus uses a guarded compatibility shim |
| OpenCode 1.18.32 | Native session sidebar | Supported top-level overlay slot | `client.tui.appendPrompt` | Sidebar is fixed at 42 columns; about 37 remain for code |
| Herdr 0.7.5 | Real terminal split beside the agent | Zoom the same pane | `pane.send_input`, text only | Requires a detected, idle agent that handles bracketed paste |

Each consumer supports mouse source selection, adding selected ranges and code to an
unsent draft, syntax folds, file navigation, and viewed marks. Narrow panes use the
dedicated files screen. Wide panes can show the tree beside the code. Split/fullscreen
changes preserve review state. Reopening a comparison resets that state.

Claude's native named prompt chips are host-specific. Pi uses its native paste block;
OpenCode receives text in its native draft; Herdr pastes into the target agent. All use
the same references, version labels, and selected source/patch content as Claude.

The five review layers are:

1. `@diffr/consumer`: the existing pane, frame protocol, paint helpers, pointer/key
   handling, and a shared comparison subprocess owner. Claude keeps thin reexports.
2. `@diffr/pi`: layout lifecycle, input translation, draft insertion, and a launcher
   that chooses Pi's fullscreen renderer.
3. `@diffr/opencode`: Solid text rendering, sidebar and overlay slots, focus handling,
   and session-bound draft insertion.
4. `@diffr/herdr`: plugin manifest, terminal renderer, local socket client, zoom/focus,
   and checks on the original draft recipient.
5. CI coverage and these research/verification notes.

## Research decisions

Pi's extension API exposes the real editor, arbitrary TUI components, and viewport
layout composition. Its public layout setter lacks a corresponding getter and focus
getter. The adapter therefore isolates the small compatibility access, checks the
shape before mounting, and restores only a root it still owns. Regular scrolling
mode cannot provide the same mouse-driven split interaction. See the official
[extension documentation](https://pi.dev/docs/latest/extensions),
[TUI documentation](https://pi.dev/docs/latest/tui), and
[TUI implementation](https://github.com/earendil-works/pi/blob/main/packages/tui/src/tui.ts).
The installed 0.99.1 declarations and implementation were checked directly.

OpenCode's installed release uses the v1 TUI plugin module, not the newer v2 plugin
examples. Its supported `sidebar_content` and `app` slots preserve the native chat
and keep the prompt mounted during fullscreen review. A custom route would unmount
the prompt and introduce an avoidable delivery race. The sidebar width is a host
constraint; an adjustable split needs an upstream layout API. See the pinned
[plugin specification](https://github.com/anomalyco/opencode/blob/v1.18.32/packages/opencode/specs/tui-plugins.md),
[public types](https://github.com/anomalyco/opencode/blob/v1.18.32/packages/plugin/src/tui.ts),
and [sidebar implementation](https://github.com/anomalyco/opencode/blob/v1.18.32/packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx).

OpenCode ships OpenTUI 0.4.5 with Solid, while Diffr's standalone TUI uses OpenTUI
0.5.6 with React. The adapter renders shared frame data through the host's JSX text
spans. Passing locally constructed styled-text objects across that boundary failed
in the real run; avoiding renderer object identity assumptions fixes it.

Herdr already exposes split and zoomed plugin panes and provides the originating
pane context plus a local socket. Its text-only `pane.send_input` honors bracketed
paste. `agent.prompt` would submit, and raw `pane.send_text` would not provide the
same paste behavior. The adapter rechecks terminal identity, agent, and readiness
before sending, and supplies no submission keys. See the pinned
[plugin schema](https://github.com/herdrdev/herdr/blob/v0.7.5/src/api/schema/plugins.rs),
[pane handlers](https://github.com/herdrdev/herdr/blob/v0.7.5/src/app/api/panes.rs), and
[input encoding](https://github.com/herdrdev/herdr/blob/v0.7.5/src/app/api_helpers.rs).

## Verification

Computer use was available and permitted for Ghostty. Tests ran in a dedicated tab,
with temporary host configuration and no provider credentials. No model prompts were
submitted. The Claude agent's tab and the user's other terminal tab were preserved.

| Check | Evidence |
| --- | --- |
| Pi split + fullscreen | Real shared pane beside native Pi editor; F6 toggled fullscreen; F7 refocused the pane |
| Pi selected source | Drag and Enter inserted an unsent native paste block with the selected reference and code |
| Pi navigation | Scope fold, viewed mark, dedicated files screen, and restoration of chat layout exercised |
| OpenCode rendering | Real syntax-colored frame rendered through host text spans; narrow status bar remained visible |
| OpenCode selected source | Cross-row drag produced `new/migrate.ts:L5-R9` and its patch in the native unsent draft |
| OpenCode layout/state | Fullscreen overlay, viewed toggle, and `zM` scope fold exercised while preserving the draft |
| Herdr handoff | Real split beside an offline Pi agent; selection became an unsent 14-line paste block and focus returned to the same idle agent |
| Herdr layout/state | Zoom/unzoom, scope folding, and a `1/1 viewed` mark exercised |
| Live producer | Installed Diffr 0.1.16 compared two files with syntax NDJSON: one file, no errors, a 24-row frame |
| Automated tests | Shared viewer, standalone TUI, Claude pane and plugin, consumer lifecycle/input, Pi keys, and Herdr socket/recipient tests passed |
| Compilation | Viewer, TUI, Claude, consumer, Pi, OpenCode, and Herdr typechecks passed; Pi and Claude bundles built |

The tests found and fixed conflicting Pi shortcuts, cross-renderer styled-text
objects, OpenCode drag termination when crossing child rows, narrow pane height,
relative recording paths, and subprocess errors hidden by incomplete-stream errors.
Shifted terminal symbols use the actual typed character, so Kitty's base-key names
do not turn `?` into `/`.

## Remaining release work

These are source-workspace integrations with usage instructions in each package's
`USAGE.md`. They are ready for review as draft PRs, not published extension releases.

- **Pi compatibility:** smoke-test the current upstream release and other extensions
  that replace the layout root; pursue a public getter or supported sidebar API.
- **OpenCode layout:** decide whether the fixed native sidebar is sufficient. A wider
  adjustable split requires upstream support or a maintained host modification.
- **Herdr recipient coverage:** repeat the draft test with each additional agent.
  Only Pi was exercised end to end; readiness detection and bracketed-paste handling
  vary by agent. The socket's check and send are separate requests.
- **Packaging:** choose publishing names, release/version policy, installation UX,
  and the supported host version matrix. Existing private workspace packages were
  preserved as the development distribution model.
- **Longer-term review state:** disk persistence of viewed marks, automatic diff
  refresh, and migration of selection ranges across changing diffs are separate work.

For planning, allow roughly 1–2 additional engineering days for publishing and a
small host-version smoke-test matrix, plus 1–3 days to broaden Herdr recipient
coverage. An adjustable OpenCode split is an upstream-dependent effort; a prototype
may take 2–5 days, with maintenance cost depending on the API agreed with the host.
These are estimates for the remaining work, not claims of verified compatibility.
