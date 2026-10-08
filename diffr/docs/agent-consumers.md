# Agent consumer scope and verification

Research and local verification: October 8, 2026. The implementations build on the
completed Claude Code consumer at `c6a55e961`, including its selection-to-draft work.

## Feasibility and delivered scope

All three hosts can reuse the Claude consumer's diff behavior. The main differences
are their layout APIs and how a selection reaches the native prompt.

| Host | Default display | Full screen | Draft handoff | Main constraint |
| --- | --- | --- | --- | --- |
| Pi 0.99.1 / 1.1.0 | Public floating panel at the right | Public fullscreen overlay | `ctx.ui.pasteToEditor` | Panel covers chat; true transcript resizing needs an upstream API. Fullscreen runtime enables mouse input. |
| OpenCode 2.0.25 | Native resizable session panel | Host-managed fullscreen | Public focused `TextareaRenderable.insertText` | V2 required; local server/TUI; no high-level draft API |
| Herdr 0.7.5 | Real terminal split beside the agent | Zoom the same pane | `pane.send_input`, text only | Requires a detected, idle agent that handles bracketed paste |

Each consumer supports mouse source selection, adding selected ranges and code to an
unsent draft, syntax folds, file navigation, and viewed marks. Narrow panes use the
dedicated files screen. Wide panes can show the tree beside the code. Split/fullscreen
changes preserve review state. Reopening a comparison resets that state.

Claude's native named prompt chips are host-specific. Pi uses its native paste block;
OpenCode receives text in its native draft; Herdr pastes into the target agent. All use
the same model context: full base/head revision IDs (or explicit staged, working-tree,
path, or empty-tree identities), followed by a standard Git patch with blob IDs when
available and numbered selected hunks. L/R range names remain UI labels and Claude
anchors; they are not the model-facing format. A null blob ID denotes unstored
working-tree content, not a commit SHA.

The five review layers are:

1. `@diffr/consumer`: the existing pane, frame protocol, paint helpers, pointer/key
   handling, and a shared comparison subprocess owner. Claude keeps thin reexports.
2. `@diffr/pi`: layout lifecycle, input translation, draft insertion, and a launcher
   that chooses Pi's fullscreen renderer.
3. `@diffr/opencode`: Solid text rendering, the native session panel, focus handling,
   and session-bound draft insertion.
4. `@diffr/herdr`: plugin manifest, terminal renderer, local socket client, zoom/focus,
   and checks on the original draft recipient.
5. CI coverage and these research/verification notes.

## Research decisions

Pi uses the public `ctx.ui.custom()` overlay lifecycle and `OverlayHandle` focus
controls. The earlier prototype read private layout and focus fields; that code is
removed. Public overlays support floating and fullscreen review, but do not resize
the native transcript into a left column. A true split needs an upstream mount API
or an external terminal split. See the official
[extension documentation](https://pi.dev/docs/latest/extensions),
[TUI documentation](https://pi.dev/docs/latest/tui), and
[upstream layout request](https://github.com/earendil-works/pi/issues/9238).
Public types were checked through 1.1.0; no supported native split mount API was found.
The system Pi installation was upgraded from 0.99.1 to 1.1.0 for smoke testing.

Pi and OpenCode register `diffr_open` through their native extension tool APIs.
These are model-callable tools, not standalone MCP servers. Pi calls the shared
comparison owner in process. OpenCode's server emits the namespaced `diffr.open`
plugin RPC event; its terminal plugin claims a private reply socket only when
its visible session and canonical directory match. One terminal can claim each
request. The server reports the terminal's acknowledgement or error, with a bounded
timeout. This OpenCode transport supports local macOS/Linux, not a remote server
or Windows. Herdr's model-tool decision remains separate.

OpenCode v1.18.32 has a fixed 42-column session sidebar. A larger overlay covers
the transcript, which the user rejected. **V2.0.25 ships the required native
`session.panel` API.** Its host owns a draggable divider, defaults to half the
available width, and preserves mounted review content across fullscreen changes.
At 80 available columns or fewer, it forces fullscreen. See the official
[session-panel API](https://opencode.ai/v2/docs/build/plugins/cli/#session-panels),
[pinned host layout](https://github.com/anomalyco/opencode/blob/v2.0.25/packages/tui/src/component/session-frame.tsx),
and [v1 sidebar](https://github.com/anomalyco/opencode/blob/v1.18.32/packages/tui/src/routes/session/sidebar.tsx).

V2 has no public draft-insertion helper. The adapter captures the native focused
OpenTUI `TextareaRenderable`, then uses its public `gotoBufferEnd` and `insertText`
methods. No private fields or render-tree lookup are used. Transfers reject another
session or a destroyed/missing editor. Fullscreen transfer hides the panel and
focuses the unchanged native composer; reopening preserves review state. This
lower-level editor boundary needs retesting on host upgrades.

OpenCode uses Solid with OpenTUI 0.5.8; the standalone Diffr TUI uses React with
0.5.6. Each renderer remains isolated. The adapter renders shared frame segments
using the host's text elements, without passing renderer-specific styled objects.

Herdr already exposes split and zoomed plugin panes and provides the originating
pane context plus a local socket. Its text-only `pane.send_input` honors bracketed
paste. `agent.prompt` would submit, and raw `pane.send_text` would not provide the
same paste behavior. The adapter rechecks terminal identity, agent, and readiness
before sending, and supplies no submission keys. See the pinned
[plugin schema](https://github.com/herdrdev/herdr/blob/v0.7.5/src/api/schema/plugins.rs),
[pane handlers](https://github.com/herdrdev/herdr/blob/v0.7.5/src/app/api/panes.rs), and
[input encoding](https://github.com/herdrdev/herdr/blob/v0.7.5/src/app/api_helpers.rs).

## Verification

Computer use is available and authorized for Ghostty. Tests use dedicated tabs,
temporary configuration, recorded diffs, and a local mock model provider. Model
prompts and tool calls stay on the local machine; user sessions are not submitted.

| Check | Evidence |
| --- | --- |
| Pi public API | 1.1.0 production bundle: actual model tool, preserved editor focus, mouse selection and Enter to existing draft in floating/fullscreen views, F7/F6/Escape, folds/unfolds, dedicated files screen and navigation, viewed marks across layout changes, close/reopen with draft preserved; earlier 0.99.1 smoke coverage retained |
| OpenCode 2.0.25 | Model called the actual registered tool; a valid comparison was acknowledged; native half-width split, fullscreen, folds, viewed marks, files, and preserved draft exercised in Ghostty |
| Selection to draft | Pi normalized-pointer integration test and OpenCode real-renderer mouse/Enter integration test append selected code to an existing draft without submission |
| Pi mouse Add to chat | Real Ghostty drag and button click appended code without submission: draft preservation checked with an input-tracing wrapper; the unmodified production bundle repeated the button flow on a live working-tree change |
| Pi lifecycle | Real second-extension overlay remained visible and focused when Diffr closed beneath it; closing the second overlay restored chat; starting a new Pi session removed the previous review |
| Computer-use pointer delivery | Initial synthetic presses used the terminal's previous pointer position; positioning the pointer before the tested drag/click resolved Pi selection. OpenCode real mouse selection, Add to chat, and divider dragging remain unverified |
| Earlier Herdr run | Real split beside an offline Pi agent; selected code became an unsent 14-line paste block; zoom, folds, and viewed marks exercised |
| Live producer | Production Pi invoked installed Diffr on two real changed Git files; model tool acknowledged both; the files screen navigated to the second file; mouse selection and Add to chat inserted the correct patch into the unsent draft; a HEAD comparison preserved the full base commit SHA and identified the working tree explicitly |

OpenCode's five behavioral tests cover matching-session delivery, rejection of a
hidden session, single-terminal claims, errors, cancellation, and real OpenTUI
selection/draft/fullscreen behavior. Pi tests cover tool dispatch, draft preservation,
public overlay cleanup (including another extension above it), and key release handling. The OpenCode renderer test runs
with the Solid preload through `bun run test` in CI.

All seven package typechecks, 153 regression tests, and the additional OpenCode
renderer test passed. Pi and Claude bundles built; the checked-in Claude plugin
bundle was rebuilt for the patch format. Frozen workspace installation passed.

The v2 runtime was installed and tested in isolation. A system Homebrew upgrade
was blocked by outdated macOS Command Line Tools; the original v1 command was
restored. No macOS toolchain changes were made.

## Remaining release work

These are source-workspace integrations with usage instructions in each package's
`USAGE.md`. They are ready for review as draft PRs, not published extension releases.

- **Pi layout:** obtain a supported sidebar API or use an external terminal split
  to meet the no-overlap requirement.
- **OpenCode UI validation:** complete real mouse selection, Add to chat, and native
  divider dragging using the corrected computer-use pointer positioning.
- **OpenCode compatibility:** test narrow terminals and additional host versions;
  prefer an upstream draft API when one becomes available.
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
coverage. A true Pi split remains dependent on an upstream API or an external split design;
its estimate needs that decision. OpenCode v2 already provides its required split.
These are estimates for the remaining work, not claims of verified compatibility.
