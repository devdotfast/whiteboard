An `animation` component plays HTML you write, frame by frame, to show how a change behaves over time: a request moving through layers, state before and after, a cache filling. Use it when motion explains something a static diagram cannot. Do not use it for content a `sequence`, `flow_diagram` or `code_peek` already shows.

## Choose how to build it

Choose where to start by what changes between the frames:

| Build with | When the frames show |
| --- | --- |
| The scene (`whiteboard.scene`) | Up to about 8 cards whose notes, text and tones change, with chips moving along their edges. This is the default. |
| Mermaid (`whiteboard.mermaid`) | A larger diagram, or one with branches or subgroups, whose nodes and edges appear, leave or light up. Its labels stay fixed: use the scene if they must change. |
| The toolkit, style kit and raw HTML | Anything else: a chart, a timeline, a queue, a custom shape, or motion the scene cannot express (`arrow`, `token`, `travel`, `timeline`). |

If no part of the drawing changes between frames, it is not an animation: use a `sequence` or `flow_diagram` block, whose steps and nodes link to code. The three mix: a stage can hold a scene, a Mermaid diagram and your own HTML together.

## The component

```json
{
  "type": "animation",
  "title": "Retry with backoff",
  "frames": [
    {
      "key": "send",
      "title": "The client sends",
      "label": "SEND",
      "caption": "The first request times out."
    },
    {
      "key": "wait",
      "title": "It backs off",
      "label": "WAIT",
      "duration": 4000
    },
    { "key": "retry", "title": "The retry succeeds", "label": "RETRY" }
  ],
  "code": { "retry": "head/src/http/retry.ts#L12-L40" },
  "pins": { "repositoryId": "…", "head": "…" },
  "html": "…"
}
```

- `frames`: every possible step. `key` names the frame for your markup and scripts; `title` and `caption` show under the stage. `label` is a short step name (e.g. `SEND`); give every frame one, or none, and the reader gets a named step strip instead of dots. `duration` (ms, default 3000) is how long the frame holds while playing. For a flow with alternate branches, declare every stable frame here and select the active ordered path with `whiteboard.setSequence(...)`.
- `code`: the source ranges the stage shows, by name. The server checks each anchor like any other reference, so verify paths and lines. Use `head/` for the new code and `base/` for the old.
- `pins`: as on any block that quotes code. A review with a target lends its own; a board without one needs them on the block.
- `html`: the stage's body. It runs in a sandboxed frame with no network: inline `<style>` and `<script>` only, no external URLs. Images must be `data:` URLs.
- `height`: defaults to `"auto"`, which fits the stage to its content, including host code peeks and blocks. Omit it for most animations. Set a number (120 to 1200 CSS pixels) only when the animation intentionally needs a fixed viewport; fixed-height stages clip overflow, so verify every frame at narrow widths. The width is the document column.

## Build with the scene

`whiteboard.scene` is a convenient starting point for cards and message flows. It provides grid layout, bound edges, and moving chips. You can combine it with custom HTML, SVG, CSS, or animation code whenever that better fits the explanation; the scene is optional. A complete example:

```html
<script>
  const s = whiteboard.scene({ columns: 4 });

  // Cards sit on a 1-based grid: [column, row].
  const agent = s.actor({
    id: "agent",
    at: [1, 1],
    title: "Agent",
    note: "session_edit",
  });
  const api = s.actor({
    id: "api",
    at: [2, 1],
    title: "Review API",
    note: "POST /commands",
  });
  const store = s.store({
    id: "store",
    at: [3, 1],
    title: "Store",
    note: "SQLite",
  });
  const canvas = s.actor({ id: "canvas", at: [4, 1], title: "Canvas" });

  // Edges follow their cards. They draw in on the frame you name.
  s.link(agent, api, { label: "call", enter: "write" });
  s.link(api, store, { label: "edit op", enter: "write" });
  s.link(store, canvas, {
    label: "snapshot",
    tone: "added",
    dashed: true,
    enter: "watch",
  });

  // A chip rides the edge during a frame, then fades out on arrival.
  s.send(agent, api, "edit", "write");
  s.send(api, store, "v9", "write", { stay: true, only: ["write"] });

  // Per-frame changes. Each holds until the next frame that changes it.
  s.on("write", store, { note: "version 9", tone: "modified" });
  s.on("watch", canvas, { note: "redrawn", tone: "added" });
  store.item("reviews", { enter: "write", tone: "added" });

  // A code peek in a cell. It spans all four columns of row 2 so the
  // source has room: [column, row, rowSpan, colSpan].
  s.peek("handler", { at: [1, 2, 1, 4], enter: "write" });

  const etag = s.badge({ text: "etag e0" });
  s.on("watch", etag, { text: "etag e1" });
</script>
```

A scene appends to the stage body by default. To compose it with your own headings, text or controls, pass a container selector or element: `whiteboard.scene({ columns: 3, container: "#diagram" })`. Badges stay with that container too.

When the container is too narrow for readable cards, the scene stacks its cells in row/column order. Widening restores the declared grid. Tables wrap their content. Hidden cards, store items and table rows take no space, so auto height follows visible content. Use `responsive: false` for an intentional fixed grid with your own responsive or scrolling plan.

The scene keeps three things consistent for you:

- **Spacing.** Cards sit in grid cells with a fixed gap. You choose the cell; the scene sets the gap and the padding. Four cards fit a sufficiently wide row; narrower containers stack them. Past four, prefer a second row.
- **Edges.** `link` draws one straight line from the center of one card's nearest side to the other's, with one weight and one arrowhead. `dashed: true` means async (a reply, a stream, a background send). A second edge between the same two cards offsets beside the first.
- **Moving blocks.** `send` is the only way to move a block along an edge. The chip rides the edge's line at one fixed speed, so a longer edge takes longer, and every chip moves at the same pace. It fades out on arrival unless you pass `stay: true`.

### The scene API

```ts
whiteboard.scene(options?: { columns?: number; container?: string | Element; responsive?: boolean }): Scene;   // default 3 columns

interface Scene {
  actor(options: CardOptions): Card;                 // a labeled card
  store(options: CardOptions): Store;                // a card that holds items
  table(options: CardOptions & { columns: string[] }): Table;
  peek(name: string, options: { at: Cell; enter?; exit?; only? }): HTMLElement;
  badge(options: { text?: string; tone?: Tone }): HTMLElement;  // a pill above the scene
  link(from: Ref, to: Ref, options?: { label?; tone?; dashed?; arrowhead?: boolean; enter?; exit?; only? }): SVGGElement;
  send(from: Ref, to: Ref, label: string, frame: string, options?: { tone?; stay?: boolean; enter?; exit?; only? }): void;
  on(frame: string, part: Ref, change: { text?: string; tone?: Tone | "none" }): void;
}

type Cell = [column: number, row: number, rowSpan?: number, colSpan?: number];   // 1-based
type Ref = Card | string /* its id */ | Element;
type Tone = "accent" | "added" | "removed" | "modified" | "muted";

interface CardOptions {
  id: string;            // names the card for link, send and on
  at: Cell;
  title?: string;        // the first line; defaults to the id
  note?: string;         // the second line
  tone?: Tone;
  enter?: string; exit?: string; only?: string[];   // which frames it shows in
  highlight?: string[];  // frames during which it is ringed
}

store.item(label, { enter?; exit?; only?; tone? }): HTMLElement;   // a chip inside the store
table.row(cells: string[], { enter?; exit?; only?; tone? }): HTMLTableRowElement;
```

- `on(frame, part, { text, tone })` changes a card, item, or badge from that frame on. `text` sets a card's note line, or an item's or badge's text — `note` works too, since that is the field cards declare. The change holds until the next frame that changes the same part, so a jump lands right. An unknown field throws rather than being ignored.
- `send` draws its edge for you if no `link` joins the two cards yet. Keep edge and chip labels short (about 12 characters): a label sits at the middle of its edge, in the space between the two cards. `stay: true` retains the chip at its destination; use `enter`, `exit`, or `only` separately to scope when that retained chip is visible. For example, `s.send(a, b, "PACK", "upload", { stay: true, only: ["upload"] })` keeps the arrived packet visible only in `upload`.
- Use `tone` `added` / `removed` / `modified` for what the change adds, deletes or alters. `accent` draws the eye; `muted` recedes. In `on`, `tone: "none"` clears a part back to the neutral surface, e.g. to un-highlight the previous step.
- Links are directed by default. Pass `arrowhead: false` to `link` for an undirected guide, boundary, or relationship while retaining endpoint binding, routing, labels, tones, dashed styling, lifecycle, and travel support.
- Edges route straight, but bow clear of any card that sits on the line between their ends. Labels use their rendered bounds to avoid endpoint cards, intervening cards, and other visible edge labels, and are reconsidered as the stage resizes. Prefer a layout where the cells between two linked cards are empty; automatic routing is a fallback, not the look to design for.

### Frames

The stage sets `data-frame="<key>"` on `<html>`, and `enter` / `exit` / `only` on any scene part decide the frames it shows in. They are states, not events, so they land right when the reader jumps to a frame or steps back. With `setSequence`, `enter` / `exit` and held `scene.on` changes follow active-sequence order, not declaration order: a change whose key is outside the active path does not apply, an inactive `enter` never occurs, and an inactive `exit` does not end an already-entered part. `only` and highlight lists always match exact stable keys. Visible cards keep their declared wide-grid cells. Hidden cards, store items and table rows collapse from layout; put replacing cards in the same cell. For an intentionally stable footprint, give the container a min-height or choose a fixed stage height with an appropriate scrolling plan.

## Draw with Mermaid

`whiteboard.mermaid(text)` draws a Mermaid diagram in the stage's theme, lays it out for you, and shows its parts frame by frame. Use it when the frames change a diagram too large to place card by card: a pipeline whose stages light up in turn, a state machine stepping through its states, a graph that grows as a request spreads. Use the scene when a few cards carry chips along their edges; Mermaid has no `send`.

Mermaid nodes do not link to code. A diagram that stays the same in every frame belongs in a `flow_diagram` or `sequence` block, not in an animation.

```html
<script>
  const d = whiteboard.mermaid(`flowchart LR
    agent[Agent] e1@-->|call| api(Review API)
    api e2@-->|edit op| store[(Store)]
    store e3@-.->|snapshot| canvas[Canvas]`);

  d.highlight("call", "agent", "e1")
    .enter("write", "store", "e2")
    .on("write", "store", { tone: "modified" })
    .enter("watch", "canvas", "e3")
    .on("watch", "canvas", { tone: "added" });
</script>
```

Name a part by its Mermaid id:

- A node by its id: `api` above.
- An edge by the id you give it with `@`: `a e1@--> b`. Name every edge you will reveal or light up. An unnamed flowchart edge is `L_<from>_<to>_<n>`, counting from 0.
- In a sequence diagram, a participant by its name, and a message as `i0`, `i1`, … in the order they appear.

`d.ids` lists every part in the drawing, and a call naming a part the drawing lacks throws with that list.

```ts
whiteboard.mermaid(text: string, options?: { container?: string | Element }): MermaidDiagram;

interface MermaidDiagram {
  readonly element: HTMLElement;     // the diagram's box
  readonly ids: readonly string[];
  enter(frame: string, ...ids: string[]): MermaidDiagram;   // show from this frame on
  exit(frame: string, ...ids: string[]): MermaidDiagram;    // hide from this frame on
  only(frames: string | string[], ...ids: string[]): MermaidDiagram;
  highlight(frames: string | string[], ...ids: string[]): MermaidDiagram;   // ring during these frames
  on(frame: string, ids: string | string[], change: { tone: Tone | "none" }): MermaidDiagram;
}
```

- The whole diagram is laid out once, from its full text, and parts that have not entered keep their place. Nothing moves as parts appear, so write the text for the last frame and reveal it frame by frame.
- `enter`, `exit`, `only` and `highlight` follow the same rules as on scene parts, active sequences included. A solid edge draws in along its line as it enters; a dashed one fades in. An edge's label shows and hides with it.
- `on` gives nodes and edges a tone from that frame on, as `scene.on` does; `"none"` clears it.
- The diagram follows the stage's colors, faces and theme. Leave out Mermaid's `style`, `classDef` and `%%{init}%%` theming: they fix colors that do not follow light and dark. Use tones instead. Links and `click` actions do nothing in the stage.
- The diagram fits its box's width and draws again when that width changes. A diagram that runs across and does not fit a narrow box is drawn running down instead of shrunk, so a `flowchart LR` may show top to bottom in the document column. Your frame changes carry over to the new drawing, but an element you hold from `d.element` does not: look parts up again inside a frame handler.
- Any Mermaid diagram type draws. Highlights and tones color nodes and edges. Flowchart and sequence diagrams name their parts as above. State, class and ER diagrams name nodes by their ids too, but make up their own edge ids, such as `edge0`; read them from `d.ids`.
- Text Mermaid cannot parse shows its error under the stage.

## Going further: the toolkit

When the scene cannot express a layout, drop to the toolkit. It is the same drawing underneath, so it mixes with a scene: pass the card returned by `scene.actor`, `scene.store`, or `scene.table` directly to `arrow`, or use its public `id` or `element` fields where another API needs one.

- Lay out by hand with the style kit's layout classes (below): `.wb-row`, `.wb-stack`, `.wb-grid`, `.wb-layers`, `.wb-lane`, with `.wb-node` or `.wb-card` boxes.
- `whiteboard.arrow(from, to, { label, tone, dashed, arrowhead, bend, enter, exit, only, highlight })` draws an endpoint-bound connector that follows both ends. It is directed by default; pass `arrowhead: false` for a headless connector without changing its route, label, styling, lifecycle, or use with `travel`. It does not draw while either endpoint is detached from the document, and resumes when both endpoints reconnect. A default straight arrow reduces its endpoint clearance when necessary to preserve a directed segment in a narrow positive gap; overlapping endpoints still need more authored space. Labels avoid visible form controls and host-overlay slots as well as endpoint cards, other edge labels, and the swept bounds of packets travelling along their route. If both ends share an ancestor with clipped or scrollable overflow, the edge and its label are clipped to that viewport too. `bend` is a CSS-pixel distance: positive bows left relative to the arrow's direction and negative bows right. Reciprocal arrows need the same nonzero sign to bow onto opposite sides (for example, `bend: 32` on both); opposite signs put them on the same path. Use it only for a return path the scene cannot route.
- `whiteboard.token({ label, tone, visible, enter, exit, only })` makes a dot or pill; labelled tokens automatically choose a readable foreground for their resolved tone color in each theme. Tokens start hidden for `travel`; pass `visible: true` for a static snapshot at its authored position. Lifecycle fields work like they do on scene parts. The token already centers itself with CSS `translate`, so position it with `left` and `top` and do not add a centering `transform` or `translate`. For example:

  ```js
  const packet = whiteboard.token({
    label: "PACK",
    tone: "accent",
    visible: true,
    only: ["upload"],
  });
  lane.append(packet); // lane has position: relative
  Object.assign(packet.style, { left: "45%", top: "50%" });
  ```

  `whiteboard.travel(token, arrow, frame, { duration, ease, position, stay })` moves a token along an arrow. Its path coordinates are stage-relative, so leave an SDK token in its default stage overlay for travel; do not reparent the positioned snapshot from the preceding example and then travel it. You can make that SDK token square by changing its shape styles without changing its positioning. For a caller-owned travelling element, use an explicit document origin such as `position: absolute; left: 0; top: 0`, with any deliberate centering in CSS; travel preserves that authored origin and existing transforms. Static lane snapshots and travelling packets are separate layout choices, and `stay` controls arrival retention rather than frame visibility—use `enter`, `exit`, or `only` for lifecycle scope.

  Trips append to the frame by default. Pass `position: 0` to start parallel trips together, or a millisecond position to sequence a reply after its request. Equivalent wide/narrow layout trips should use the same positions, so a hidden layout does not add a second wait. `position` uses the same syntax as `whiteboard.timeline` below.

  The default token remains hidden until travel starts. Travel progress stays bound to the live arrow geometry, so an active or retained token follows its edge when responsive layout or code-peek sizing moves the endpoints. You may reuse a token for later trips without reparenting it; the trip active at the current timeline position owns its placement, including after jumps, backward seeks, and resizes.

- `whiteboard.timeline(frame)` is that frame's part of one anime.js timeline: `.add(targets, params, position)`, `.set(...)`, `.call(...)`. A tween starts from where the frames before it left the element, so write only where it goes: `{ translateX: 120 }`. A numeric `position` counts milliseconds from the frame's start; `"<"` starts at the previous call's end, while `"<<"` starts at its beginning.
- `data-enter` / `data-exit` / `data-only` / `data-highlight` work on any element you write, arrows included.

## Raw HTML

For custom layouts, charts, shapes, or interactions, write HTML, SVG and CSS. Build them from the style kit first, so a hand-made stage reads like the rest of the whiteboard, and drive them with the frame API after it.

### The style kit

Every stage loads these classes. They use the whiteboard's faces, colors and spacing in light and dark, so prefer them to your own CSS; add a `<style>` only for what the kit does not cover, and build it from the variables under "Theme and motion".

| Class | Use it for |
| --- | --- |
| `.wb-row`, `.wb-stack` | A centered row or column of parts, with the scene's spacing. |
| `.wb-grid` | A grid of equal columns; set `style="--wb-columns: 4"` (default 3). |
| `.wb-layers` | Children stacked in one place, for states that replace each other. |
| `.wb-lane` | A `position: relative` track with a dashed center line, for a static `token` snapshot. |
| `.wb-card` | A box with a title and note: put `.wb-card-title` and `.wb-card-note` inside. The scene's cards are these. |
| `.wb-node` | A centered box for a hand-made layout; a `<small>` inside is its second line. |
| `.wb-well` | An inset area that groups parts, such as a process or a machine boundary. |
| `.wb-rule` | A divider (`<hr class="wb-rule">`). |
| `.wb-badge` | A pill for a status or version, e.g. `etag e1`. |
| `.wb-chip` | A chip in a list, such as a queued job or a cached key; `.wb-items` lays a list of them out. |
| `.wb-table` | A compact table of rows, such as a schema or a result set. |
| `.wb-title` | A heading inside the stage. |
| `.wb-caps` | An uppercase micro label, like the step strip's. |
| `.wb-prose` | A sentence of explanation, in the board's reading face. |
| `.wb-mono`, `.wb-code` | Ids, paths and values in the mono face; `.wb-code` is inline code on a well. |
| `.wb-muted`, `.wb-faint` | Text that recedes. |
| `.wb-shape`, `.wb-shape-text` | An SVG shape drawn like a card, and the text inside it. |

`data-tone="accent|added|removed|modified|muted"` colors any card, node, chip, badge, shape or table row, like the scene's tones. `data-highlight="frameKey …"` rings a card, node or shape during those frames.

```html
<div class="wb-row">
  <div class="wb-node" data-highlight="read">Reader<small>GET /v1</small></div>
  <div class="wb-well wb-stack">
    <span class="wb-caps">Cache</span>
    <div class="wb-items">
      <span class="wb-chip" data-tone="added" data-enter="fill">user:42</span>
    </div>
  </div>
</div>
```

### The frame API

- `whiteboard.on(key, handler)` runs when a frame shows (`"*"` on every frame), including a same-frame refresh when the reduced-motion preference changes. Shared `"*"` handlers run before frame-specific handlers, so they can render content before a frame handler animates it. Connection labels hide immediately when their frame ends, while the connecting stroke can fade. The handler receives `{ frame, previous, direction, instant }`; `frame` and `previous` are frame objects, so use `frame.key` when selecting keyed state. Return the animations it starts, or a finite promise for a simulation cycle, so playback waits for the represented work. Cancel earlier work when another frame shows. Use `instant` and the live `whiteboard.reducedMotion` value to draw a consistent skipped-motion pose; normal playback still needs to advance the model.
- `whiteboard.animate(target, keyframes, options)` is `element.animate` that holds its end state and honors the current frame jump. After that frame settles, later button or slider callbacks animate normally. The current reduced-motion preference always skips motion, including animations started by later interactions.
- `whiteboard.anime` is anime.js v4 (also the global `anime`): easings, stagger, utils.

Prefer `link` / `send` (or `arrow` / `travel`) for ordinary message flows: they handle endpoint geometry, labels, and navigation. Custom connectors and motion are also supported; keep them readable, responsive, and coherent when the reader jumps frames or requests reduced motion.

## The rest of the `whiteboard` shim

```ts
code(name: string): HTMLElement;   // a placeholder the whiteboard fills with that code peek
block(id: string): HTMLElement;    // a placeholder for another component of this whiteboard
setSequence(keys: string[]): void; // select the ordered path shown by host controls
goto(key: string): void; next(): void; prev(): void;
reveal(name: string): void;        // open the named code beside the whiteboard
readonly frames: readonly { key: string; title: string; caption?: string; index: number }[];
readonly frame: { key: string; title: string; caption?: string; index: number };
readonly theme; readonly colorScheme: "light" | "dark"; readonly reducedMotion;
```

`whiteboard.frame` is the current frame object, not its key. For keyed state, read `whiteboard.frame.key` or use the handler argument: `whiteboard.on("*", ({ frame }) => render(frame.key))`.

For alternate paths, call `whiteboard.setSequence(["start", "branch-a", "done"])`. Every key must be a unique frame declared in the component. Repeating the same sequence is a no-op, so it is safe to call from a render path. The selected order controls the host step labels, titles, count, Previous/Next, keyboard navigation, Play/Replay, and `whiteboard.next()` / `prev()`; changing it stops current playback and clears its hold timer. Changing the sequence preserves the current frame when it remains in the new path; otherwise it lands instantly on the new path's first frame. `whiteboard.frames` contains the active ordered path and its `index` values, and `whiteboard.frame.index` is the current active-path position; keys remain the stable identity. `goto(key)` accepts only a frame in the active sequence and is a direct jump, while adjacent forward steps still play the destination frame's motion even when declaration indexes move backward. Call `setSequence` before `goto` when a control switches branches:

```js
const delivered = ["push", "gossip", "replicate", "serve"];
const dropped = ["push", "gossip-dropped", "catch-up", "serve-recovered"];

function selectPath(drop) {
  const path = drop ? dropped : delivered;
  whiteboard.setSequence(path);
  whiteboard.goto(path[1]);
}
```

- `scene.peek(name, ...)`, `whiteboard.code(name)` and `<div data-wb-code="name">` all draw the real code peek over a placeholder. Give `scene.peek` a cell, and span columns (the cell's `colSpan`) when the code needs width — a one-column peek clips long lines; a raw `data-wb-code` div takes a CSS width instead. Its height follows the code, up to about 18 lines. A peek is always on top of your drawing, so do not draw or travel over it.
- A code peek is about 40px of header plus 18px per line, up to about 400px. Rows of cards take about 90px each. With the default `height: "auto"`, the stage grows to fit them. If you intentionally use a numeric fixed height, leave enough room because overflow clips at that height.

## Text inside shapes

Scene cards supply their own padding. For custom HTML or SVG, keep the full rendered text bounds at least 12 CSS pixels inside the container boundary at the displayed size. Check every text-box corner against a curved boundary, not only the shape’s rectangular bounding box. Wrap or shorten the label, or enlarge the shape, while keeping the font readable. Verify this inset in each frame and supported viewport.

## Theme and motion

Custom CSS should use the whiteboard's variables, never literal colors, sizes or font names, so the stage matches light and dark and the rest of the board:

- Colors: `var(--wb-ink)`, `--wb-ink-muted`, `--wb-ink-faint`, `--wb-accent`, `--wb-accent-soft`, `--wb-on-accent`, `--wb-surface`, `--wb-surface-raised`, `--wb-well`, `--wb-rule`, `--wb-rule-soft`, `--wb-added`, `--wb-removed`, `--wb-modified`, `--wb-added-bg`, `--wb-removed-bg`, `--wb-modified-bg`.
- Faces, by role: `--wb-font-sans` for labels and controls, `--wb-font-mono` for ids, paths and values, `--wb-font-serif` for prose, `--wb-font-code` for source text. The stage loads the whiteboard's own faces, so name no font yourself.
- Spacing: `--wb-space-2` to `--wb-space-20` in 2px steps, then `24`, `28`, `32`, `36`, `40`, `48`, `56`, `72`, `96`, `120`, `160`.
- Type: sizes `--wb-text-micro` (10px), `small`, `body` (12px), `ui`, `title`, `reading`, `heading`, `display`; line heights `--wb-leading-tight`, `normal`, `relaxed`, `prose`; weights `--wb-weight-regular`, `medium`, `semibold`, `bold`; `--wb-tracking-caps` and `--wb-tracking-chrome` for uppercase labels.
- Radii: `--wb-radius-small`, `control`, `surface`, `pill`, `round`.
- Motion: `--wb-motion-fast`, `medium`, `slow` and the easings `--wb-motion-ease`, `enter`, `settle`. `--wb-duration` (450ms) is the default fade.

`<html>` carries `data-wb-theme="light|dark"` and the matching `color-scheme`, and `whiteboard.colorScheme` reads it, for the rare drawing that needs a different value per theme.

`whiteboard.reducedMotion` reads the stage's current `prefers-reduced-motion` setting. Use it when custom rendering has motion that `whiteboard.animate` and the scene helpers do not manage.

## Checklist

- Each frame shows one idea; its title says what changed. 3 to 8 frames is usual.
- Omit `height` unless the animation intentionally needs a fixed viewport; verify any numeric height in every frame and narrow layout.
- Every frame reads correctly when reached by a jump, not only by playing.
- Build as "Choose how to build it" says: a scene by default, Mermaid for a larger or branching diagram, and the toolkit or raw HTML for anything else.
- In raw HTML, build from the style kit and the `--wb-*` variables; write no literal color, size or font name.
- Script errors show under the stage. After writing, read the whiteboard back and fix any.
