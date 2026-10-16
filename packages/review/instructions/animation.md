An `animation` component plays HTML you write, frame by frame, to show how a change behaves over time: a request moving through layers, state before and after, a cache filling. Use it when motion explains something a static diagram cannot. Do not use it for content a `sequence`, `flow_diagram` or `code_peek` already shows.

## The component

```json
{
  "type": "animation",
  "title": "Retry with backoff",
  "height": 320,
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

- `frames`: the steps, in order. `key` names the frame for your markup and scripts; `title` and `caption` show under the stage. `label` is a short step name (e.g. `SEND`); give every frame one, or none, and the reader gets a named step strip instead of dots. `duration` (ms, default 3000) is how long the frame holds while playing.
- `code`: the source ranges the stage shows, by name. The server checks each anchor like any other reference, so verify paths and lines. Use `head/` for the new code and `base/` for the old.
- `pins`: as on any block that quotes code. A review with a target lends its own; a scratchpad needs them on the block.
- `html`: the stage's body. It runs in a sandboxed frame with no network: inline `<style>` and `<script>` only, no external URLs. Images must be `data:` URLs.
- `height`: the stage height in CSS pixels (120 to 1200). The width is the document column.

## Build with the scene

Reach for `whiteboard.scene` first. It lays out cards on a grid, draws the edges, and moves chips along them, so every animation keeps the same spacing, the same edge style, and the same motion. You pick the cells and say what changes on each frame; the scene does the rest. A complete example:

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
  s.send(api, store, "v9", "write");

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

The scene keeps three things consistent for you, so do not override them:

- **Spacing.** Cards sit in grid cells with a fixed gap. You choose the cell; the scene sets the gap and the padding. Four cards fit a row; past that, use a second row.
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
  link(from: Ref, to: Ref, options?: { label?; tone?; dashed?; enter?; exit?; only? }): SVGGElement;
  send(from: Ref, to: Ref, label: string, frame: string, options?: { tone?; stay?: boolean }): void;
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
- `send` draws its edge for you if no `link` joins the two cards yet. Keep edge and chip labels short (about 12 characters): a label sits at the middle of its edge, in the space between the two cards.
- Use `tone` `added` / `removed` / `modified` for what the change adds, deletes or alters. `accent` draws the eye; `muted` recedes. In `on`, `tone: "none"` clears a part back to the neutral surface, e.g. to un-highlight the previous step.
- Edges route straight, but bow clear of any card that sits on the line between their ends, and a label that would land on a card is nudged off it. Prefer a layout where the cells between two linked cards are empty; a bowed edge is a fallback, not the look to design for.

### Frames

The stage sets `data-frame="<key>"` on `<html>`, and `enter` / `exit` / `only` on any scene part decide the frames it shows in. They are states, not events, so they land right when the reader jumps to a frame or steps back. A hidden part still holds its grid cell, so the layout does not jump; put parts that replace each other in the same cell.

## Going further: the toolkit

When the scene cannot express a layout, drop to the toolkit. It is the same drawing underneath, so it mixes with a scene: pass a scene card to `arrow`, or tween a card's `id` in a `timeline`.

- Lay out by hand with `.wb-row` (a centered row) and `.wb-stack` (a centered column); `.wb-node` is a box, `.wb-layers` stacks its children in one place.
- `whiteboard.arrow(from, to, { label, tone, dashed, bend, enter, exit, only, highlight })` draws an edge that follows both ends. `bend` bows it; use it only for a return path the scene cannot route.
- `whiteboard.token({ label, tone })` makes a dot or pill; `whiteboard.travel(token, arrow, frame, { duration, ease, stay })` moves it along an arrow.
- `whiteboard.timeline(frame)` is that frame's part of one anime.js timeline: `.add(targets, params, position)`, `.set(...)`, `.call(...)`. A tween starts from where the frames before it left the element, so write only where it goes: `{ translateX: 120 }`. A numeric `position` counts milliseconds from the frame's start; `"<"` starts with the previous call.
- `data-enter` / `data-exit` / `data-only` / `data-highlight` work on any element you write, arrows included.

## Raw HTML

For anything the toolkit cannot do, write your own HTML, SVG and CSS, and drive it with:

- `whiteboard.on(key, handler)` runs when a frame shows (`"*"` on every frame). Return the animations it starts so playback waits for them. Reach for it only when a state cannot.
- `whiteboard.animate(target, keyframes, options)` is `element.animate` that holds its end state and honors jumps.
- `whiteboard.anime` is anime.js v4 (also the global `anime`): easings, stagger, utils.

Keep edges and moving blocks on `link` / `send` (or `arrow` / `travel`) even inside custom HTML, so they stay consistent. Use raw drawing for shapes and content, not for its own lines or motion.

## The rest of the `whiteboard` shim

```ts
code(name: string): HTMLElement;   // a placeholder the whiteboard fills with that code peek
block(id: string): HTMLElement;    // a placeholder for another component of this whiteboard
goto(key: string): void; next(): void; prev(): void;
reveal(name: string): void;        // open the named code beside the whiteboard
readonly frames; readonly frame; readonly theme; readonly reducedMotion;
```

- `scene.peek(name, ...)`, `whiteboard.code(name)` and `<div data-wb-code="name">` all draw the real code peek over a placeholder. Give `scene.peek` a cell, and span columns (the cell's `colSpan`) when the code needs width — a one-column peek clips long lines; a raw `data-wb-code` div takes a CSS width instead. Its height follows the code, up to about 18 lines. A peek is always on top of your drawing, so do not draw or travel over it.
- A code peek is about 40px of header plus 18px per line, up to about 400px. Rows of cards take about 90px each. Leave room: the stage clips at its height.

## Theme

Use the whiteboard's colors and fonts so the stage matches light and dark: `var(--wb-ink)`, `--wb-ink-muted`, `--wb-ink-faint`, `--wb-accent`, `--wb-accent-soft`, `--wb-on-accent`, `--wb-surface`, `--wb-well`, `--wb-rule`, `--wb-added`, `--wb-removed`, `--wb-modified`, `--wb-added-bg`, `--wb-removed-bg`, `--wb-modified-bg`, `--wb-font-sans`, `--wb-font-mono`, `--wb-font-serif`. `--wb-duration` (450ms) is the default fade.

## Checklist

- Each frame shows one idea; its title says what changed. 3 to 8 frames is usual.
- Every frame reads correctly when reached by a jump, not only by playing.
- Prefer a scene; drop to the toolkit or raw HTML only when it cannot fit.
- Script errors show under the stage. After writing, read the whiteboard back and fix any.
