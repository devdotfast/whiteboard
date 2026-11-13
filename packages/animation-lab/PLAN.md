# Moving the lab block into Whiteboard

Status: draft for review, 2026-11-10. D1 decided (new block type; `animation` and `clip` deprecated). Nothing here is built. Working name for the block: `diagram`.

## 1. Context and goal

`packages/animation-lab` proves a block where an agent writes one JavaScript module against a `wb` SDK: C4-style nodes, nested groups, labelled wires, ELK layout with overlap detection, steps and scenarios with request tokens, code claims that are verified against the repository, and charts.

The goal is to ship that block in the real canvas (`packages/review/app`), authored by agents over the existing MCP tools, on all hosts, behind the Animations switch. People editing diagrams by hand stays out of scope.

What the product already has is more than a bare stage, and the plan leans on it:

- `packages/review/app/src/animation/` already has the safe shell: `stage.html` loaded by URL (no `srcdoc`, so no Trusted Types sink), a no-network CSP, the runtime and a `MessagePort` handed over in one boot message, zod-parsed stage messages, theme/fonts/scale/reduced-motion pushed in `init`, an `error` message, fullscreen through a portal, `openPeek` on `reveal`, the tour overlay, and the render handle behind `session_render`.
- Agents already get script errors back: the canvas posts `/animation-run`, `session_get` shows it, `session_render` returns `error` with the PNG.
- Named code ranges on `animation`/`clip` already flow through `sourceReferences` (`whiteboard-document/src/document.ts`) into `snapshot.staleSources` when the head moves.

So most of the review items 1 to 3 and 7 to 8 are "run the `wb` runtime inside the existing shell", not new plumbing.

## 2. Decisions for you

Each has a recommendation. Nothing below is assumed settled.

### D1. New block type, or replace what `animation` runs? (review item 10)

|                                   | A. New `diagram` type beside `animation`/`clip`                                                                   | B. `animation` runs `wb`                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schema                            | Own flat schema (`script`, frames with moves, `code` with evidence). `animation` untouched.                       | `animation` needs two shapes in one type (`html` + `whiteboard` runtime, or `script` + `wb`), or a version field. The component reference gets a fork inside one entry.              |
| Stored boards                     | No migration. Old animations keep rendering as they do.                                                           | Stored `html` animations still need the old runtime, so both runtimes ship either way; or a migration walk in `stored-document-migration.ts` that cannot translate HTML to a script. |
| Animations switch, stage plumbing | Reused as is: same switch, same `stage.html`, port, fonts, theme, render handle. One more type in the gate lists. | Reused, same.                                                                                                                                                                        |
| Agent instructions                | A second topic and a second `.d.ts` until `animation` is closed to agents. Agents must be told which to pick.     | One topic, but it must explain two APIs for as long as old blocks are edited.                                                                                                        |
| Clip                              | Untouched. The lab's continuous timeline is deferred (see D6).                                                    | Clip shares `animation`'s runtime today, so it is dragged into the change.                                                                                                           |
| Risk                              | Two runtimes to keep working for a while.                                                                         | Regressions in a shipped block; ten reference animations to rewrite at once.                                                                                                         |

**Decided (2026-11-10): A, and deprecate both `animation` and `clip`.** A new `diagram` type ships beside them. Once `diagram` covers stepped scenes (phase 3), both are deprecated for agents together (phase 3b). Both keep rendering for stored boards. The reasoning: it matches the earlier call for `clip` ("a sibling type keeps the schema and the reference flat") and the 2026-11-05 note ("new thin block type; animation/clip untouched").

Accepted gap: `clip` covers played motion (a continuous timeline with markers), which `diagram` only gains in phase 4b. Between 3b and 4b agents cannot write a played animation; stepped scenes cover most of that need.

### D2. Which libraries may a script use?

The lab's import map offers three, anime.js, React, React Flow, ELK and Plot from esm.sh. Desktop has no network in the stage, and the share viewer must carry the same bytes.

- Option 1 (recommended): scripts import nothing. Libraries are reached only through `wb`: `wb.layout()` (ELK), `wb.chart()` (Plot), `wb.anime` (anime.js, already shipped). Each is a lazy chunk the host sends over the port on first use.
- Option 2: also ship three and React + React Flow as prebuilt ESM bundles behind an import map built from blob URLs. Adds a build step, roughly 1.5 MB more assets, React Flow's CSS as an inlined string, and a `libraries` field on the block. The lab's `dice` and `nodes` fixtures need this.

Recommend option 1 now and option 2 only when a reference script needs it.

### D3. A publish whose evidence does not match

The server checks each `code` entry at the block's pins: the `evidence` text must lie inside the linked lines.

- Option 1 (recommended): refuse the edit, naming each entry and where the evidence is now (`movedTo` line). A claim that was never true should not reach a reader, and the fix is one line.
- Option 2: accept and return the entry as `changed`; the reader sees a "changed" badge on a brand-new block.

### D4. When the head moves and evidence moved with it

Today the server keeps authored coordinates and only marks ranges that no longer exist ("the author decides").

- Option 1 (recommended): same policy. Evidence no longer inside the range marks the entry stale; `session_set_target` warnings and `session_get` name the entry and `movedTo`, and the agent repins with one edit.
- Option 2: the server rewrites the anchor itself when the evidence is found exactly once in the file. Fewer stale marks, but the server edits content nobody reviewed, and the range length may no longer fit.

### D5. Closing `flow_diagram`, `sequence`, `call_stack_diff` to agents (review item 9)

Earlier decision stands: 409 on insert pointing at the new block, renderers kept, no migration. Open points:

- When: recommend only after phase 5 ships a sequence reference and a call-path reference that render as well as the old blocks. Until then both stay writable.
- Helpers or references: recommend reference scripts first, built from nodes, wires and steps; add `wb.sequence()` / `wb.callStack()` helpers only if the references come out long or fragile. `call_stack_diff` has base/head semantics the SDK has no concept of; it may need to stay open longer.
- The switch: the 409 can only apply while Animations is on, or agents with the switch off lose every diagram. Closing the old blocks for everyone means turning the switch on by default first. That is a separate decision.

### D6. Smaller choices

| Topic                                                   | Recommendation                                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type name                                               | `diagram`. Alternatives: `figure`, `stage`.                                                                                                                                                                                                                    |
| Field names                                             | Follow the product, not the lab: frame `key` (not `id`), code entry `{source, evidence, label}` (not `anchor`/`title`). Then `sourceReferences`, peeks and `session_render` work unchanged.                                                                    |
| Request moves                                           | First-class `moves` on a frame (typed, validated), played by the SDK. Lab's `data.moves` goes away.                                                                                                                                                            |
| Continuous timeline (lab's chapters + scrubber)         | Phase 4b, after `clip` is deprecated. The lab's `timeline` and player are the starting point.                                                                                                                                                                  |
| Select mode (reader picks stage items as model context) | Defer to phase 6, onto the canvas's existing `useDiagramSelection`.                                                                                                                                                                                            |
| Group hues and chart series colours                     | The lab hard-codes hex pairs. The kit rule is "no raw colours, do not add a step". Recommend mapping to existing tokens in `animation-stage-kit.ts`; where no token fits (eight group hues, the chart series), I will list the gaps and ask before adding any. |
| Where ELK runs                                          | In the stage, as in the lab (it needs measured DOM boxes and the overlap loop). The 2026-11-05 note said "on the host"; this supersedes it.                                                                                                                    |
| Lab package                                             | Keep as a playground until phase 3 matches it, then delete.                                                                                                                                                                                                    |

## 3. What the agent sees

### 3.1 The block

```json
{
  "type": "diagram",
  "title": "Streaming service",
  "description": "Who owns what, and what one Play request touches.",
  "script": "…contents of diagram.js…",
  "scenarios": [
    {
      "key": "play",
      "label": "Play",
      "frames": [
        {
          "key": "play-request",
          "label": "Request",
          "caption": "The TV app asks the gateway for something to play.",
          "code": ["tv-play-call"],
          "moves": [{ "from": "tv", "to": "gateway", "label": "GET /play/42" }]
        },
        {
          "key": "play-fan-out",
          "label": "Fan out",
          "caption": "The gateway asks Playback and Catalog at the same time.",
          "code": ["gateway-manifest", "gateway-title"],
          "moves": [
            { "from": "gateway", "to": "playback", "label": "manifest?" },
            { "from": "gateway", "to": "catalog", "label": "title?" }
          ]
        }
      ]
    }
  ],
  "code": {
    "gateway": {
      "source": "head/platform/gateway/play.go#L9-L12",
      "evidence": "func (s *Server) Routes(",
      "label": "Gateway routes"
    },
    "tv-play-call": {
      "source": "head/apps/tv/src/main/kotlin/fast/tv/Player.kt#L6",
      "evidence": "api.get<PlaybackResponse>(\"/api/play/$episodeId\")",
      "label": "TV app asks for playback"
    }
  },
  "stage": { "inset": 24 },
  "pins": { "head": "9f3422aa7" }
}
```

Rules the schema and `check()` enforce (`packages/whiteboard-document/src/blocks/diagram.ts`):

- `script`: 1 to 200,000 characters. A module; `wb` is a global. Top-level `await` works.
- Steps: either block-level `frames` or `scenarios[].frames`, not both. Keys use the existing `handle` pattern and are unique across the whole block, so `session_render`'s `frame` names one step without a scenario argument. Up to 60 frames, 8 scenarios. A frame is `{key, label?, caption?, code?, moves?, data?}`; `data` keeps the existing 20 KB limit.
- `moves`: `{from, to, label?, reply?, delay?}` with node ids. The server checks the shape; the stage reports a move that names no wire (it cannot be checked without running the script).
- `code`: `{name: {source: anchor, evidence, label?}}`. `evidence` is 1 to 200 characters, not blank. Every name a frame lists must exist.
- `stage`: optional `{width?, height?, inset?}`. A script that calls `wb.layout()` reports its own size; a hand-placed drawing gives width and height.

### 3.2 The files

`session_checkout` writes the block to a folder, as it does for animations. Publishing a folder with `diagram.js` makes a diagram (today `frames.json` means animation and `markers.json` means clip; `diagram.js` is checked first).

| File             | Holds                                            |
| ---------------- | ------------------------------------------------ |
| `diagram.js`     | The script.                                      |
| `frames.json`    | Block-level frames, when there are no scenarios. |
| `scenarios.json` | Scenarios with their frames.                     |
| `block.json`     | `title`, `description`, `code`, `stage`, `pins`. |
| `checkout.json`  | What was last published; written by the tool.    |

Read-only, beside the drafts (`animation-drafts/` under `devReviewHome()`, same place as today): `wb.d.ts` and `references/diagrams/<name>/` (a README plus the same files).

### 3.3 The tool calls, in order

No new tools. Changes are to `session_get_instructions` (a topic), `session_checkout`, `session_edit` (`fromFiles` and its result), `session_render` (result) and `session_get` (run report).

**1. Instructions**

```jsonc
session_get_instructions({ "topic": "diagram" })
// → instructions/diagram.md, then:
//   "API: <drafts>/wb.d.ts
//    References: <drafts>/references/diagrams/layered-architecture/ …request-fan-out/ …latency-chart/"
```

The Components section lists `diagram` only while Animations is on.

**2. Publish a new diagram** (the agent wrote the folder itself, or copied a reference)

```jsonc
session_edit({
  "sessionId": "s_41",
  "activityId": "a_7",
  "edit": { "type": "insert", "fromFiles": "/abs/drafts/streaming", "parentId": "sec_design" }
})
// →
{
  "targetId": "b_2k",
  "type": "diagram",
  "quotes": [
    { "anchor": "head/platform/gateway/play.go#L9-L12", "first": "func (s *Server) Routes(mux *http.ServeMux) {", "last": "}" }
  ],
  "code": { "matches": 14, "changed": [] },
  "advice": []
}
```

If evidence does not match (D3, option 1) the edit is refused:

```text
409 Two code entries do not hold at head 9f3422a:
- gateway-manifest: "playback.Manifest(" is not in platform/gateway/play.go#L21-L23; it is at line 31.
- drm-plan-query: services/drm/plan.go is not in the repository.
Fix the anchors in block.json and publish again.
```

**3. Look at it**

```jsonc
session_render({ "sessionId": "s_41", "targetId": "b_2k", "frame": "play-fan-out", "verify": true })
// → an image content part (PNG), plus:
{
  "targetId": "b_2k",
  "type": "diagram",
  "frame": { "key": "play-fan-out", "title": "Fan out", "position": 3, "count": 8 },
  "scenario": "play",
  "clipped": false,
  "size": { "width": 1280, "height": 560 },
  "error": null,
  "findings": [
    { "kind": "overlap", "message": "Edge label \"gRPC\" (gateway→catalog) overlaps node \"Search\"." },
    { "kind": "move", "message": "Frame play-plan moves drm → billing, but no wire joins them." }
  ],
  "claims": {
    "matches": 21, "changed": 0, "unlinked": 2,
    "unlinkedLabels": ["Sessions", "TV app → Payments"]
  },
  "file": "/abs/animation-renders/s_41/b_2k/play-fan-out.png"
}
```

- `frame` omitted renders the first step, or the only state of a diagram without steps.
- `verify: true` (new, optional) draws the claim badges into the picture.
- `error` is the first thing that stopped the script: a syntax error, a throw, a library that failed to load, ELK rejecting the graph. Line numbers refer to `diagram.js`.
- `findings` are things that drew but are wrong: `overlap`, `move`, `claim` (a `wb.code` name the block does not define), `id` (duplicate node id).
- Rendering still needs the board open in Desktop. Without it the tool answers 409 as today.

**4. Fix and republish**

```jsonc
session_edit({ "sessionId": "s_41", "edit": { "type": "update", "targetId": "b_2k", "fromFiles": "/abs/drafts/streaming" } })
```

Only changed files are saved; a block someone else changed after the checkout is refused, as today.

**5. Read back without rendering**

`session_get({ sessionId, targetId })` shows the last run the canvas reported: "ran without errors", "threw: …", or "has not run yet", now followed by the findings and the claim counts. This is what an agent on a host that cannot render relies on.

### 3.4 The `wb` reference (`packages/review/instructions/wb.d.ts`, excerpt)

```ts
declare const wb: Wb;

type NodeKind =
  | "person"
  | "system"
  | "container"
  | "component"
  | "database"
  | "queue"
  | "external";
type State = "default" | "active" | "dimmed";
type Hue =
  | "neutral"
  | "sky"
  | "teal"
  | "green"
  | "amber"
  | "coral"
  | "rose"
  | "violet";

interface Wb {
  /** Draw. Leave x/y out and call layout(). */
  node(o: {
    id?: string;
    kind: NodeKind;
    label: string;
    tag?: string;
    code?: string | string[];
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    state?: State;
  }): HTMLElement;
  group(o: {
    id?: string;
    label: string;
    tag?: string;
    around?: HTMLElement[];
    color?: Hue | "auto";
    padding?: number;
    state?: State;
  }): HTMLElement;
  edge(o: {
    id?: string;
    from: HTMLElement | string;
    to: HTMLElement | string;
    label?: string;
    dashed?: boolean;
    code?: string | string[];
    state?: State;
  }): SVGPathElement;

  /** Places everything drawn so far. Resolves to the drawing's size. */
  layout(o?: {
    direction?: "right" | "down";
    spacing?: number;
    layerSpacing?: number;
  }): Promise<{ width: number; height: number }>;
  /** What collides right now, in words. Also reported to you by session_render. */
  overlaps(): string[];

  /** Steps. A frame's `moves` play by themselves: tokens ride the wires, what the
   *  request has reached lights up, the rest of its path stays plain, everything
   *  else dims. Call moves.manual() to drive them yourself. */
  readonly scenario: Scenario | null;
  readonly frame: Frame | null;
  readonly frameIndex: number;
  onFrame(fn: (frame: Frame | null, change: FrameChange) => void): () => void;
  onScenario(fn: (scenario: Scenario | null) => void): () => void;
  readonly moves: { manual(): void };
  token(o?: { label?: string; tone?: "request" | "reply" }): HTMLElement;
  travel(
    token: HTMLElement,
    wire: SVGPathElement,
    o?: { reverse?: boolean; speed?: number; signal?: AbortSignal },
  ): Promise<boolean>;

  /** Code. A node or wire with `code` is a claim; mark anything else you draw. */
  code(target: Element, names?: string | string[], label?: string): void;

  /** Charts: Observable Plot with the stage's palette and fonts. */
  chart(o: {
    id?: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    code?: string | string[];
    plot(c: {
      Plot: PlotModule;
      colors: Colors;
      width: number;
      height: number;
      frame: Frame | null;
      scenario: Scenario | null;
    }): PlotOptions;
  }): HTMLElement;

  /** Theme and motion come from the board, not the OS. */
  readonly theme: "light" | "dark";
  readonly reducedMotion: boolean;
  colors(): Colors;
  onTheme(fn: (theme: "light" | "dark", colors: Colors) => void): () => void;

  /** Runs when the scenario changes or the stage resets: undo what you started. */
  onCleanup(fn: () => void): void;
  readonly anime: unknown;
}
```

`packages/review/app/src/diagram/wb-reference.ts` holds this file to the runtime's own types with the `Matches<Runtime, Documented>` check that `stage-reference.ts` uses, so a drifted reference fails `tsc`.

## 4. Architecture

### 4.1 Message flow

```
canvas (diagram-block.tsx)                 stage.html (sandboxed, opaque origin, no network)
  │  iframe src = stage.html (by URL)            │
  │── boot: { runtime source, MessagePort } ───▶ │ runs wbRuntime(port) from a blob
  │── init: script, frames, scenario, code names,│
  │         theme vars, colorScheme, scale,      │ imports the script from a blob URL;
  │         fonts, reducedMotion, inset ───────▶ │ a failed import is caught and reported
  │◀── library { name: "elk" | "plot" } ──────── │ wb.layout() / wb.chart(), first use only
  │── library { name, source } ────────────────▶ │
  │◀── ready, size, claims, findings, error ──── │
  │── frame / scenario / theme / verify ───────▶ │
  │◀── settled, reveal { names }, step, escape ─ │
  ▼
openPeek(panel)   POST /animation-run { blockId, error, findings, claims }   render handle
```

- The stage keeps `stage.html` and its CSP unchanged. Messages ride the port only; the lab's `parent.postMessage(…, "*")` and its `event.source !== parent` check go away, which closes the self-navigation hole (a script that navigates the frame loses the port).
- Both directions are zod-parsed. Host→stage parsing is new: the runtime validates `init` and later messages with small hand-written guards (zod is not in the stage).
- New file `diagram/wb-protocol.ts` rather than more arms on `stage-protocol.ts`: the two runtimes share the boot message and nothing else.

### 4.2 Where things run

| Work                                     | Runs in                                                                                                     | Why                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Schema, key and name checks              | `whiteboard-document` (`check()`), on every edit                                                            | Same as every block.                                                        |
| Evidence check, stale marks              | Review server, at the block's pins and again in `projectSource` when the head moves                         | It has the files; the canvas and the share viewer only read `staleSources`. |
| Layout, overlap detection, moves, badges | Stage                                                                                                       | They need the drawn DOM.                                                    |
| Claim state shown to the reader          | Canvas: stage reports claims (label + names), canvas joins them with `staleSources` and sends `verify` back | No new server channel.                                                      |
| Linked code view                         | Canvas side panel through `openPeek` (Monaco in Desktop)                                                    | Replaces the lab's `code-view.tsx` and `linked-code.tsx`.                   |
| Render to PNG                            | Desktop: `canvas.renderAnimation` → `getScreenshot` (`webContents.capturePage`)                             | Exists.                                                                     |

### 4.3 Library delivery (review item 1)

- The runtime itself: `wbRuntime.toString()` in the boot message, as `stageRuntime` does today. It must stay closure-free; a browser test boots it from its source text.
- ELK: `elkjs/lib/elk.bundled.js?raw` in its own lazy chunk (elkjs 0.11.1 is already a canvas dependency). The stage asks for it on the first `wb.layout()`; the host answers with the text; the stage runs it from a blob. A block that places by hand never loads it.
- Plot: its UMD build and d3's, `?raw`, lazy, same request path (phase 4).
- anime.js: already shipped this way.
- Fonts: the existing inlined `@font-face` rules.
- No import map and no remote stylesheet under D2 option 1.
- Share viewer: it renders the same bundle, so the lazy chunks and `stage.html` ship with it. Verify the `@dev.fast/canvas` package build emits the new `?raw` chunks.
- Trusted Types: nothing new. No `srcdoc`, no `innerHTML` in the host; blob URLs are created inside the stage, which has its own CSP.

### 4.4 Theme, fonts, motion (review item 3)

The lab reads the OS (`light-dark()`, `matchMedia`). The product pushes them: `init` and `theme` messages carry `--wb-*` values from `STAGE_THEME` and the board's colour scheme; `reducedMotion` comes from the host. The runtime's palette becomes a table of variable names, with hex only as the values the host sent. `wb.colors()` reads the pushed values for canvas libraries.

## 5. Phases

Every phase ships behind the Animations switch. `animation` and `clip` are untouched until phase 3b. Tests are the targeted files named; `pnpm lint` and `pnpm format` (oxfmt) run whole. The manual check in each phase is an isolated Desktop (`DEV_FAST_REVIEW_DESKTOP_BACKGROUND=1`), light and dark, a narrow window, keyboard only, and reduced motion.

### Phase 1: an agent-authored layered diagram renders in Desktop

Scope: nodes, groups, wires, `wb.layout()`, overlaps, theme. No steps, no code linking yet (the `code` field is accepted and anchors validated as today, evidence unchecked).

Add:

- `packages/whiteboard-document/src/blocks/diagram.ts`; register in `blocks/index.ts` (union, `blocks`, `referenceOrder`).
- `packages/review/app/src/diagram/wb-runtime.ts` (port of `animation-lab/src/sdk/wb.ts`: port instead of `postMessage`, pushed theme, no selection, no verify yet), `wb-protocol.ts`, `diagram-block.tsx`, `wb-reference.ts`.
- `packages/review/instructions/diagram.md`, `wb.d.ts`, `instructions/diagrams/layered-architecture/`.

Change:

- `packages/review/app/src/animation/animation-block.tsx`: export the pieces the new block reuses (stage URL, boot handshake, font and theme loading, render registration) instead of copying them. A second copy belongs in a shared module.
- `packages/review/app/src/blocks` registry: render `diagram`.
- `packages/review/src/review-api/animation-drafts.ts`: `diagram.js`, the new `block.json` fields, `wb.d.ts` and the diagram references in `writeStageReference`.
- `animation-references.ts`, `instructions.ts` (`desktopBlockTypes`, the `diagram` topic), `public-tools.ts` (topic hint), `authoring-tools.ts` (descriptions of `edit`, `checkout`, `render`).
- `http.ts`: the edit gate (`type === "animation" || type === "clip"`) and `/animation-run`; `animation-runs.ts` and `document-text.ts` for `findings`.
- `animation-render.ts` (`isStageBlock`, a diagram without frames renders its one state) and `packages/review-protocol/src/contracts.ts` (`ReviewRenderedFrame` gains `findings`, `size`), then `pnpm --filter @dev.fast/review-desktop protocol:sync`.
- `foreign-references.ts`, `document-text.ts`: the new type in their switches.

Hosts: no new setting. The existing switch already reaches `desktop-server.ts`, `headless-host.ts` and an attached Desktop; add `diagram` cases to `authoring-capabilities.test.ts` and `headless-host.test.ts` (hidden from the reference and refused on edit when off, on each host).

Tests:

- `blocks/diagram.test.ts`: the cross-field rules (duplicate keys, frames in both places, unknown code name).
- `diagram/diagram-block.browser.test.tsx`: a script draws and reports its size; a thrown error and a syntax error reach the block as `error` with a line; a hand-placed overlap arrives as a finding; a dark theme push changes a node's computed colour; the stage cannot message the host after navigating itself.
- `diagram/references.browser.test.tsx`: every reference runs with no error and no findings (the pattern of `animation/references.browser.test.tsx`, with `VITE_ANIMATION_SHOTS=1` for screenshots).
- `animation-drafts.test.ts`: checkout, edit, publish round trip for a diagram folder.

Desktop check: publish the reference from an agent session; it draws; `session_render` returns the PNG and an empty `findings`; break the script and see the error in `session_render` and `session_get`; narrow window scrolls sideways at the stage's minimum width (no reflow); switch Desktop's theme while the OS stays on the other one.

### Phase 2: code claims, verification, the side peek, keyboard

Add:

- `packages/review/src/review-api/code-evidence.ts`: the lab's `verify.ts` logic (evidence inside range, nearest `movedTo`) against the server's file reader.
- Stage: `wb.code`, claims report, badges, `verify` message; nodes and wires become focusable (`tabindex`, a role and an accessible name), Enter or Space posts `reveal`.

Change:

- `whiteboard-document/src/document.ts`: `sourceReferences` yields diagram code entries (ids from `animationCodeId`), so pins, quotes and stale marks work.
- `http.ts` edit path: run the evidence check, shape the result or the refusal (D3). `local-data.ts` `projectSource`: an entry whose evidence left its range is stale. `session_set_target` warnings name it with `movedTo` (D4).
- `diagram-block.tsx`: `reveal` → `openPeek` with the entry's label; a Verify toggle (kit `Button`), the counts in a `role="status"` line so a screen reader hears "21 match, 0 changed, 2 unlinked"; changed and unlinked items listed in a tooltip, not in the chrome.
- `session_render`: `verify` input, `claims` in the result (contracts + protocol sync).

Tests: `code-evidence.test.ts` (match, moved, removed file, blank evidence, CRLF); a `review-api` test that a head move marks the entry stale; browser tests that clicking a linked node calls the panel store's `openPeek` and that Tab reaches a node and Enter opens it.

Desktop check: click a node and a wire, the Monaco peek opens on the linked lines; close it and focus returns to the stage item; edit a file so evidence moves, re-target, see the changed badge and the stale mark; keyboard only through nodes and wires.

### Phase 3: steps, scenarios and request moves

Add:

- Schema: `frames`, `scenarios`, `moves`.
- Stage: the moves engine inside the SDK (tokens, fan-out with `delay`, reply tone when a move runs against a wire, lighting from group membership the SDK already knows, so the fixture's `home` map disappears). Reduced motion: tokens rest mid-wire, as `wb.travel` does now.
- Teardown: one `AbortController` per scenario; on a scenario change the SDK aborts trips, removes tokens, resets every `data-state`, runs `onCleanup` handlers, then applies the new frame. A reset never reloads the iframe.
- Stage posts `step` (arrow keys) and `escape` when focus is inside it, so step keys and leaving full screen work wherever focus is.

Change:

- `diagram-block.tsx`: reuse `StepStrip` (`animation/stage-controls.tsx`), the scenario `SegmentedControl`, and the frame player's stop model; full screen through the existing portal and `layer`, with the stage scaled to fit (no Fullscreen API); the lab's `player.tsx`, `frame-controls.tsx`, `scenario-picker.tsx`, `fullscreen.tsx` and `styles.css` are not ported.
- A frame's `code` drives the peek while it is open (the lab's "code view follows the steps"), through the existing tour shell where a block lists code on its frames.
- `animation-render.ts`: frame lookup across scenarios; `scenarios.json` in drafts.
- Reference: `instructions/diagrams/request-fan-out/`.

Tests: browser tests that stepping to a fan-out frame shows two tokens and lights the right wires; that switching scenario leaves no token and no lit node from the previous one; that ArrowRight inside the stage advances the step; that reduced motion draws the end state. `diagram.test.ts` for key uniqueness across scenarios.

Desktop check: step by mouse and by keys with focus in and out of the stage; switch scenarios mid-trip; full screen and Escape returns focus to the trigger; zoom the window (cmd +) and check the stage still fits; reduced motion on.

### Phase 3b: deprecate `animation` and `clip`

With steps, scenarios and moves in `diagram`, agents stop creating `animation` and `clip` blocks. People are unaffected and stored boards keep rendering.

- `http.ts`: an insert of `animation` or `clip` while Animations is on is refused with a 409 that names `diagram` and its instructions topic. Updates, `session_checkout`, `session_render` and removals of existing `animation` and `clip` blocks still work, so an agent can fix or remove what is already on a board.
- `instructions.ts` / `desktopBlockTypes`: both leave the component reference; the `animation` topic (which also covers clips) opens with a pointer to `diagram` and stays for editing existing blocks. `authoring.md` points stepped scenes at `diagram`.
- `animation-drafts.ts`: the reference animations and clips stop being offered for new work (kept for existing blocks until a later cleanup).
- No migration: `stored-document-migration.ts` is untouched; the `whiteboard` runtime and `animation-block.tsx` stay for stored boards.
- Tests: authoring tests for the 409 on insert of each type and for update still working, on all three hosts (`authoring-capabilities.test.ts`, `headless-host.test.ts`).
- Desktop check: a stored board with animations and clips still plays, steps and renders; an agent asked for a stepped scene writes a `diagram`.

### Phase 4: charts

- `wb.chart` in the runtime; Plot and d3 as lazy `?raw` chunks; series and surface colours from the pushed theme (see D6 on tokens); `instructions/diagrams/latency-chart/`.
- Tests: a browser test that a chart draws without loading ELK, redraws on a theme push, and that Plot failing to load reports an `error`. The reference test covers the new reference.
- Desktop check: light and dark, hover tips, a chart whose frame changes its marks, share viewer shows it.

### Phase 4b: played motion

- Schema: an optional `timeline` on `diagram` (`chapters` with `key`, `label`, `duration`, optional `code`), exclusive with frames and scenarios. Markers map to chapters.
- Stage: `wb.time`, `wb.duration`, `wb.onTime(fn)` and the chapter at a time, from the lab's player model; reduced motion shows each chapter's end state.
- Canvas: reuse the existing clip player (`animation/` frame player and stop model) instead of the lab's `player.tsx`; the playhead and chapter chips drive `wb:time` over the port.
- `session_render`: a `chapter` (or time) input picks the moment drawn.
- Reference: `instructions/diagrams/played-request/`, a request animated end to end.
- Tests: browser tests that scrubbing draws the right chapter, that playback stops at the end and with reduced motion.
- Desktop check: play, pause, scrub by keyboard and pointer.

### Phase 5: sequence and call-path coverage, then close the old blocks (D5)

- References `instructions/diagrams/sequence/` and `…/call-path/`; helpers only if needed.
- `authoring.md`: point design and implementation guidance at `diagram`.
- `http.ts`: 409 on insert of `flow_diagram`, `sequence`, `call_stack_diff` while Animations is on, naming `diagram` and its instructions topic; updates and removals of stored ones still work; `desktopBlockTypes` drops them from the reference.
- Tests: an authoring test for the 409 and for the switch-off case on all three hosts.
- Desktop check: a stored board with the old blocks still renders and still edits by hand.

### Phase 6: reader selection

- Port select mode onto `useDiagramSelection`, with the stage reporting selectable items over the port.
- Tests and checks as phase 2's keyboard work.

## 6. Deferred

- People editing diagrams by hand.
- three, React and React Flow in scripts (D2 option 2).
- Rendering without a visible Desktop (headless or share viewer capture). Agents there rely on `session_get`'s run report.
- Paint-in when a diagram arrives from the agent's stream (the animation block's three levels).
- Removing the `whiteboard` runtime once no stored board uses `animation` or `clip` (needs a migration decision).
- Unit-level edits to a diagram (whole-block authoring only, as decided).
- Auto-repinning (D4 option 2).

## 7. Risks and open questions

- **Direction.** The 2026-11-05 notes record "iframe + `wb` SDK" as rejected, then reopened by building the lab. This plan assumes the lab is the chosen direction.
- **Main thread.** The sandboxed stage shares the canvas's thread. ELK on a 40-node compound graph, plus the label escalation passes, may freeze the board for a moment. Measure in phase 1; a worker inside the stage (from a blob) is the fallback.
- **Run reports are asynchronous.** Findings exist only after a canvas ran the script. An agent on a host with no canvas open gets "has not run yet". Acceptable for now; headless rendering is the real fix.
- **`toString()` delivery.** The runtime must not close over module scope. The lab already lives with this; the browser test that boots it from text is the guard.
- **Two runtimes.** `whiteboard` (3,800 lines) and `wb` (2,400) both ship: `animation` is deprecated for new work in phase 3b but keeps rendering stored boards. Until 3b, agents may pick the wrong block; the two instruction topics must say when to use which.
- **Stage width.** The product keeps a 720 px minimum and scrolls sideways. A layered diagram from ELK is often wider than the reading column (the lab's example is 1280). Inline it will scroll; full screen scales to fit. Open: should a wide diagram scale down inline instead?
- **Colour tokens** (D6): the group hues and chart series may not all have a token to snap to.
- **Evidence strictness** (D3): refusing publishes could slow an agent sketching a diagram before it has anchors. Entries are optional, so it can publish unlinked first; watch whether agents then leave claims unlinked.
- **`call_stack_diff`** has base/head semantics with no counterpart in `wb`; it may not be closable in phase 5.
- **Size of phase 1.** It touches schema, canvas, server, instructions and protocol at once. It can be cut in two (canvas rendering from a fixture first, authoring second) if a smaller first PR is preferred.
