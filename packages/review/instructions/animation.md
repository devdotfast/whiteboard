An `animation` component plays HTML you write, frame by frame, to show how a change behaves over time: a request moving through layers, state before and after, a cache filling. Use it when motion explains something a static diagram cannot. Do not use it for content a `sequence`, `flow_diagram` or `code_peek` already shows.

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
- `pins`: as on any block that quotes code. A review with a target lends its own; a scratchpad needs them on the block.
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
whiteboard.scene(options?: { columns?: number }): Scene;   // default 3 columns

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

## Going further: the toolkit

When the scene cannot express a layout, drop to the toolkit. It is the same drawing underneath, so it mixes with a scene: pass the card returned by `scene.actor`, `scene.store`, or `scene.table` directly to `arrow`, or use its public `id` or `element` fields where another API needs one.

- Lay out by hand with `.wb-row` (a centered row) and `.wb-stack` (a centered column); `.wb-node` is a box, `.wb-layers` stacks its children in one place.
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

For custom layouts, charts, shapes, or interactions, write HTML, SVG and CSS and drive it with:

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
readonly theme; readonly reducedMotion;
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

## Theme and motion

Use the whiteboard's colors and fonts so the stage matches light and dark: `var(--wb-ink)`, `--wb-ink-muted`, `--wb-ink-faint`, `--wb-accent`, `--wb-accent-soft`, `--wb-on-accent`, `--wb-surface`, `--wb-well`, `--wb-rule`, `--wb-added`, `--wb-removed`, `--wb-modified`, `--wb-added-bg`, `--wb-removed-bg`, `--wb-modified-bg`, `--wb-font-sans`, `--wb-font-mono`, `--wb-font-serif`. `--wb-duration` (450ms) is the default fade.

`whiteboard.reducedMotion` reads the stage's current `prefers-reduced-motion` setting. Use it when custom rendering has motion that `whiteboard.animate` and the scene helpers do not manage.

## Checklist

- Each frame shows one idea; its title says what changed. 3 to 8 frames is usual.
- Omit `height` unless the animation intentionally needs a fixed viewport; verify any numeric height in every frame and narrow layout.
- Every frame reads correctly when reached by a jump, not only by playing.
- Prefer a scene; drop to the toolkit or raw HTML only when it cannot fit.
- Script errors show under the stage. After writing, read the whiteboard back and fix any.
