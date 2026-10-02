# Bugs found by the e2e journey suite

One `## ` heading per bug; the heading text is what `ctx.knownBug("...")` references
(`harness.mjs` asserts the heading exists), so keep it stable once written. A journey
never weakens an assertion to pass: it asserts the real behaviour, corroborates the
bug's signature, then marks the check with `ctx.knownBug`, so the journey fails again
the day the bug is fixed.

Status values: `open`, `fix-pr #<n>`, `fixed`, `not-a-bug` (with the reason).

## Status

- `review info --review <uuid>` always fails with `Not found.` — fixed (#348)
- `review app pick --review <uuid>` never opens the review — fixed (#348)
- The first-run telemetry notice disappears before it can be used — fixed (#351)
- A community invitation dismissed before the first-run reload comes back — fixed (#351)
- The modal editor opened by Go to Definition ignores the first Escape — fixed (#352)
- The review topbar covers the Find widget and the contents pill — fixed (#350)
- A review whose repository directory moves or is deleted renders `ReviewApiError: Review operation failed.` — open
- `review app pick` goes to the launcher instead of reporting an unusable pointer — fixed (#348)
- One unreadable legacy `review.json` stops Review Desktop from starting — fixed (#349)
- Home says nothing about a legacy review directory left behind by the JSON cutover — not-a-bug
- Opening a Go file installs Go tools from the network without asking — fixed (#354)
- A review's Rust language server never starts when the extension wins a race with the workspace folder — fix-pr #854
- Home offers no way to dismiss an active review — open
- The tutorial's live editor gets no hover or Go to Definition — open
- Activating the Go extension opens its welcome page over the review — open
- Peeks and tour stops never offer to show their element in the software map — open
- A focus request that mounts the Map view loses to its default selection — fixed
- The Trace view lists retained traces in the order they finish loading — open
- Formatting between two dollar amounts shows as raw Markdown — open

## Template (copy, do not edit)

- **Journey:** `<journey name>` · **Found:** YYYY-MM-DD · **Status:** open
- **Repro:** the CLI / UI steps, exactly as the journey performs them.
- **Expected:** one sentence.
- **Actual:** one sentence, plus the assertion message or screenshot path.
- **Notes:** suspected cause with a `file:line` pointer if known.

## A review whose repository directory moves or is deleted renders `ReviewApiError: Review operation failed.`

- **Journey:** `worktree-drift` · **Found:** 2026-09-17 · **Status:** open
- **Regressed (2026-09-28), intermittently, after its fix in #355:** on
  origin/main (1 of 1 runs) and on the housekeeping stack (3 of 4 runs; the
  fourth rendered normally and also passed the delete path), opening the review
  after `mv <repo> <repo>-moved` renders `ReviewApiError: Review operation
failed (Error). The server logged the cause; …`, and the host logs
  `GET /reviews-api/<uuid>/commits failed: Error: No Git or jj repository found
for <repo>.` The delete path fails the same way. The journey asserts that log
  line in the current launch's output before it records this bug, and accepts
  a normal render.
- **Repro:** create a review with a `commits` target in a git repository, let it
  render, quit Review Desktop, `mv <repo> <repo>-moved` (or `rm -rf` it),
  relaunch Desktop and open the review from Home or with
  `POST /reviews-api/<uuid>/open`.
- **Expected:** the canvas either renders the review from the pinned checkout —
  after the rename it is intact, it lives at
  `<repo>-moved/.git/dev-fast/reviews/<uuid>/head/<sha>` and moved with the
  repository — or says which checkout it can no longer find.
- **Actual:** the canvas renders only
  `<p role="status">ReviewApiError: Whiteboard operation failed (…).</p>` inside
  `.review-canvas-root [data-review-api]`, with no title, no document and no
  path. `GET /reviews-api/<uuid>/commits?version=<n>` answers 500 with
  `{"error":"Whiteboard operation failed (…). …"}`; `GET /reviews-api/<uuid>?full=true`
  and `GET /reviews-api` still answer 200 with the whole document, so the
  document is intact and only the source-backed read fails. A plain restart
  with the repository left in place renders the same review normally, so the
  move is the cause.
- **Notes:** the stored `repositoryPath` is absolute and is never re-resolved —
  the summary list still reports `repositoryPath: "/…/repo"` after the rename,
  and Home keeps offering the review (and a `View source →` link) under a
  directory that no longer exists. `api-document.tsx:100-105` loads
  `/<id>/commits` before anything else renders, and every provider failure
  becomes the generic 500 at `review-api/http.ts:50`, which
  `api-canvas.tsx:166` shows verbatim. A graceful degradation exists —
  `sourceUnavailable`, rendered as "Local checkout unavailable. Showing
  retained source." (`api-document.tsx:224-228`) — and one of its two writers
  is not gated on the target kind: `GET /:id?full=true` sets it for any target
  when `data.sourcePins(snapshot)` throws a 404 `ReviewInputError`
  (`http.ts:620-633`). That path was not taken here — `?full=true` answered 200
  and did not degrade, so `sourcePins` still resolved after the rename, and
  whatever `/:id/commits` needs from the repository is not what `sourcePins`
  needs. The `/commits` route has no equivalent degradation at all, so it has
  nothing to fall back to. (The other writer, the worktree refresh at
  `store.ts:186-198` and `:225-243`, _is_ gated on
  `target.kind === "worktree"` and cannot fire for this review either.) The
  `Worktree unavailable` state at `desktop-entry.tsx:38-46` is unreachable
  today: the only `{ kind: "source" }` render (`reviewCanvasPart.ts:308`) never
  sets `error`, so no journey can assert that string.

## Home says nothing about a legacy review directory left behind by the JSON cutover

- **Journey:** `settings-and-migration` · **Found:** 2026-09-17 · **Status:** not-a-bug
- **Reason:** the JSON store is the catalog, and the cutover that fills it is a
  one-time storage migration, not a Home refresh task. A directory left in
  `<home>/reviews` afterwards is dead data, and nothing writes one any more.
- **Repro:** with a Review home that has already been through the cutover
  (`<home>/json-cutover.json` present), add
  `<home>/reviews/11111111-1111-4111-8111-111111111111/review.json` holding
  `{"schemaVersion":1,"uuid":"11111111-1111-4111-8111-111111111111"}`, restart
  Review Desktop and open Home.
- **Expected (by the plan):** Home lists the review as needing migration and
  names the command to run, from the `MIGRATION_REQUIRED` `ReviewHomeError`
  whose message is "Invalid review.json; run `whiteboard migrate apply`: …"
  (`review-home.ts:364-366`, `:706-710`).
- **Actual:** Home renders the empty-Home onboarding rail and mentions neither
  the review nor the command; `GET /reviews-api` answers 200 without it; the
  directory is left byte-for-byte as seeded. The journey asserts all three, and
  keeps the plan's assertion behind a branch that fires if a build grows the
  guidance, so the expectation is recorded rather than dropped.
- **Notes:** `ensureJsonCutover` (`review-import/json-cutover.ts:254-289`) returns on its
  marker without reading `<home>/reviews` again, and Home lists from the JSON
  store (`review-api/store.ts:485`). The `MIGRATION_REQUIRED` error has no
  Desktop consumer at all: only tests read `review-home.ts`'s scan errors,
  and `ReviewHomeError` appears nowhere in
  `packages/review/app/src`. What is worth fixing is the path where such a
  directory still matters: before the cutover has run, the same record stopped
  the Desktop from starting (fixed in #349).

## A review's Rust language server never starts when the extension wins a race with the workspace folder

- **Journey:** `lsp-rust` · **Found:** 2026-09-17 · **Status:** fix-pr #854
- **Repro:** install the Rust group through Settings → Tools → Extensions, then
  open a review with a `code_peek` over a `.rs` file in a Cargo project. Two
  windows out of three, no hover, no Go to Definition, no `cargo` process and
  no `target/` or `Cargo.lock` in the review's pinned checkout; the third
  window works.
- **Expected:** opening the peek starts rust-analyzer against the review's
  checkout every time.
- **Actual:** in a losing window
  `<profile>/user-data/logs/*/window1/exthost/rust-lang.rust-analyzer/rust-analyzer Extension.log`
  ends at `Starting language client` and never reaches
  `Using server binary at …`, which is the line the extension logs once it has
  decided it has a workspace. Nothing recovers it: the journey asserts that
  signature before it retries in a new window.
- **Notes:** `reviewLocalLanguageFeatures.acquire` (`:152-166`) adds the
  checkout as a workspace folder and then calls
  `extensions.activateByEvent("onLanguage:rust")` — but `addFolders` resolving
  in the renderer (`workspaceContextService.ts:72-74`, `:110-166`) does not mean
  the extension host has applied the change, so the activation can reach
  `rust-analyzer` first. `rust-analyzer`'s `activate` captures
  `fetchWorkspace()` once (`out/main.js`, `new Ctx(context, …, fetchWorkspace())`);
  with no folders and no open Rust document it is `{kind: "Empty"}`,
  `getOrCreateClient` returns without starting anything, and
  `onWorkspaceFolderChanges` only restarts a client that is _already running_,
  so the later folder change is ignored and even `rust-analyzer: Restart
Server` cannot help — the captured workspace is never re-read. The fix
  belongs on Review's side: activate only after the extension host has the
  folder (or open the document first, which would at least yield
  `{kind: "Detached Files"}`). The same ordering is what
  `curated-extensions.manifest.mjs:86-95` already works around for
  `workspaceContains:`.
- **Root cause (2026-09-18):** the activation Review triggers is not the only
  one. The workbench derives an implicit `onLanguage:rust` from
  rust-analyzer's own `rust` language contribution, so creating the peek's model
  activates the extension before `acquire` has registered any folder, and no
  ordering on Review's own `activateByEvent` call can win that race. Review's
  manifest patch (`curated-extensions.manifest.mjs`) rewrites only the VSIXes it
  materializes, and this group is installed from Settings at runtime, so the
  patch never reaches it. A fix therefore needs an install-time manifest patch
  that replaces the implicit event with a Review-owned one fired after
  `addFolders`.

## Home offers no way to dismiss an active review

- **Journey:** `home-multi-review` · **Found:** 2026-09-28 · **Status:** open
- **Repro:** in Whiteboard Desktop with two or more reviews, open Home and open
  a row's `Actions for <title>` menu.
- **Expected:** the row offers Dismiss, the reversible action the Dismissed
  section and its Undo exist for.
- **Actual:** the menu holds only `Delete <title>`, and no `Dismiss <title>`
  button renders anywhere in the table. A review reaches Dismissed only through
  the `attention` command (`POST /reviews-api/commands`), which is what the
  journey sends before it tests Undo and delete.
- **Notes:** `ReviewRowActions` in `review-home-view.tsx` renders
  `DismissReviewButton` only when `onDelete` is absent, and the Desktop passes
  both `onDelete` and `onDismiss` (`desktop-entry.tsx`, from
  `reviewCanvasPart.ts`), so its `review_dismissed` `via: "home"` event can
  never fire. The browser tests cover Dismiss only with no `onDelete`.

## The tutorial's live editor gets no hover or Go to Definition

- **Journey:** `tutorial` · **Found:** 2026-09-28 · **Status:** open
- **Repro:** open the tutorial (`Whiteboard: Open Tutorial...`), pick a keymap,
  then hover `totalCents` or any typed identifier in the Welcome section's
  `src/orders/order-service.ts` editor and press `F12` on it.
- **Expected:** tsserver's hover appears and completes the "Inspect a symbol"
  step, and `F12` opens the definition in a Source window, as it does for a
  TypeScript `code_peek` in any other review (`lsp-typescript` passes).
- **Actual:** after a minute of hovers `.monaco-hover-content` is empty,
  `showHover` stays unchecked in `review.tutorial.progress.v1`, and `F12` does
  not check `gotoDefinition`. The extension host started TS Server
  (`exthost/vscode.typescript-language-features/TypeScript.log` ends at
  `<semantic> Starting...`). Reproduced with the Desktop built from origin/main
  as well as the housekeeping stack. The journey asserts both absences, then
  uses the guide's Next to go on.
- **Notes:** the tutorial's checkout lives under
  `<home>/tutorial/sample-service/.git/dev-fast/reviews/<uuid>/head/<sha>`;
  whatever gives other reviews' peeks a file-backed model for tsserver does not
  reach it. Not investigated further.

## Activating the Go extension opens its welcome page over the review

- **Journey:** `lsp-go` · **Found:** 2026-09-28 · **Status:** open
- **Repro:** install the Go group through Settings → Tools → Extensions on a
  fresh profile, then open a review with a `code_peek` over a `.go` file.
- **Expected:** the review stays the active tab while the extension activates.
- **Actual:** a `Go for VS Code v0.56.0` welcome tab opens and becomes active,
  so the review, its peek and the reader's place in it are hidden. The journey
  sees that tab active before it clicks back to the review.
- **Notes:** `golang.go` shows the page on first activation unless
  `go.showWelcome` is false. `reviewConfigurationDefaults.ts` already turns off
  the extension's survey and update prompts (`go.survey.prompt`,
  `go.toolsManagement.checkForUpdates`), but not this one.

## Peeks and tour stops never offer to show their element in the software map

- **Journey:** `canvas-resume` · **Found:** 2026-09-28 · **Status:** open
- **Repro:** open the tutorial with the software map enabled and start the
  database lens tour under Interactive Diagrams; its actors name
  `softwareMapPath`s such as `orderService.application.orders`.
- **Expected:** a stop whose element is on the map shows its
  "Show … in software map" button, as the side peek and tour stop render it.
- **Actual:** no `button[aria-label$=" in software map"]` renders anywhere, so
  the map focus request is unreachable from the UI. The journey reaches it
  through the review action the button would call.
- **Notes:** the buttons (`review-components.tsx:615`, `:974`) render only when
  `PeekAnchor.softwareMapPath` is set, and nothing sets it; `database-lens.tsx`
  copies the definition's `softwareMapPath` only into its own mini-map. Also on
  `origin/main`.

## The Trace view lists retained traces in the order they finish loading

- **Journey:** `canvas-resume` · **Found:** 2026-09-28 · **Status:** open
- **Repro:** create a review with two `trace_quote` blocks that quote two
  different retained traces, open it and open the Trace view's picker.
- **Expected:** the picker lists the traces in document order and defaults to
  the first.
- **Actual:** the order, and so the default trace, changes from load to load.
  The journey delays the second trace's resource by 1.5 s so the first trace is
  always the default, then asserts the reader's pick over it.
- **Notes:** `api-document.tsx:149` fills `data.traces` as each resource read
  resolves inside a `Promise.all`, and `ReviewTraceView.tsx` takes the list and
  default from that map's insertion order.

## Formatting between two dollar amounts shows as raw Markdown

- **Journey:** `math-rendering` · **Found:** 2026-09-29 · **Status:** open
- **Repro:** open a review whose Markdown block holds
  `It costs $5 for **pro** and $10 for team.`
- **Expected:** "pro" is bold, as it was before Markdown read math.
- **Actual:** the paragraph shows `**pro**`, asterisks included. A link or a
  code span between the two amounts shows as its source in the same way.
- **Notes:** `micromark-extension-math` reads everything between the two `$` as
  math. `agent-markdown.tsx:310` sees the space before the closing `$` and
  prints the span back, but it has only the raw text. A `$` that opens and
  closes without a space, as in `$FOO/$BAR`, is typeset. The fix is to apply
  the rule while parsing, which the stock tokenizer has no option for.
