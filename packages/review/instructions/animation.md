New `animation` and `clip` components are retired: write a `diagram` instead (`session_get_instructions({topic:"diagram"})`), which draws steps, request movements, played timelines and charts. Use these instructions only to fix or update an animation or clip a whiteboard already holds.

An `animation` component draws HTML you write on the whiteboard, in a sandboxed iframe. The reader steps through its frames, or plays them. The `session_edit` schema lists its fields.

For paths a reader can pick, such as a retry that succeeds or one that gives up, use `scenarios`: the whiteboard draws the picker, so do not draw your own buttons.

A `clip` component runs in the same stage with the same API, but it has no frames: it is one timeline the reader plays, pauses and jumps around by named markers. See "Clips: one timeline, played" below.

## Work in files

1. `session_checkout({ sessionId, targetId })` writes the animation to a folder: `animation.html`, `frames.json`, `scenarios.json` (once it has scenarios) and `block.json` (`title`, and `code` and `pins` when it shows code).
2. Edit those files with your file tools.
3. Publish the folder: `session_edit({ sessionId, edit: { type: "update", targetId, fromFiles: "<folder>" } })`. Only the files you changed are saved. Keep editing and publishing the same folder; it records what it last published in `checkout.json`.
4. Read it back with `session_get({ sessionId, targetId })`. Its script runs only where the whiteboard is open, a moment after you publish, so the read says whether it ran there without an error, threw (with the error), or has not run yet. Fix an error and publish again.
5. Look at it: `session_render({ sessionId, targetId, frame })` shows that frame (or a clip at that marker; omitted, the first) on the whiteboard open in Desktop, as the reader sees it, and returns it as a PNG image, with the error the script threw, if any. It also writes the PNG to the path the result names. Render each frame you changed and check the drawing is what you meant: cards where you placed them, arrows between the right parts, nothing clipped or overlapping. Do not take screenshots of the screen. The whiteboard must be open in Desktop: `session_create` opens it, and `session_open` opens an existing one.

For a new animation, write the same files into a folder of your own and publish with `{ type: "insert", fromFiles: "<folder>", parentId, afterId }`. If someone else changed the animation after your checkout, the publish is refused: check it out again.

## Draw it

Before you write HTML, read the two files whose paths `session_checkout` and these instructions give: `whiteboard.css`, the classes and `--wb-*` variables every animation loads, and `whiteboard.d.ts`, the `whiteboard` API. Use the classes and variables rather than your own colors, sizes or fonts, so the animation matches the board in light and dark.

Draw for a stage 720px wide: the width of the board's reading column, and the narrowest the stage gets. Fit that width with nothing past its right edge, so the reader never scrolls sideways on a full-size board: a scene fits three columns of cards, with room for link labels between them. A wider board or fullscreen gives the stage more room, and a narrower window keeps it at 720px and scrolls it sideways, so do not shrink the drawing for small widths. A scene keeps its columns at any width.

Start from the reference closest to what you are drawing, listed under References at the end of these instructions: copy its folder into your draft, then change the data, the prose and the code links.

There are three ways to draw.

### A scene: cards and messages

For a few services, processes or stores with messages moving between them, use `whiteboard.scene`. You place cards on a grid and say what changes in which frame:

```html
<script>
  const s = whiteboard.scene({ columns: 2 });
  const client = s.actor({ id: "client", at: [1, 1], title: "Client", form: "window" });
  const api = s.actor({ id: "api", at: [2, 1], title: "API", form: "bars" });

  s.send(client, api, "GET", "send");
  s.on("send", api, { note: "timed out", tone: "removed" });
  s.send(client, api, "GET", "retry");
  s.on("retry", api, { note: "200 OK", tone: "added" });
</script>
```

A scene names frame keys, so a new scenario means new frames and a few new lines like these. While a frame shows, each message it sends is the label of its edge and the edge takes the marker colour, however the reader reached the frame; stepping into the frame rides a chip from the sender that settles into the label. A card's `id` is its element's id, so your own CSS can address it as `#api`.

Give each card the silhouette of what it stands for, so a reader tells the parts apart before reading a title: `form: "window"` for a client, `"bars"` for a service or worker of this codebase, `"cylinder"` for a database, `"drum"` for a cache, `"stack"` for a queue or topic, `"pill"` for a start or end, `"cut"` for a branch. A third-party service or API gets `outline: "dashed"`. `color` sets a border colour at rest (`teal` for stores, `violet` for queues, `accent` for the part under discussion); a frame's `tone` takes over while set. The same `data-form`, `data-outline` and `data-color` work on a `wb-node` in a hand-made layout.

Draw a boundary around cards that belong together with `s.group({ id, at: [column, row, rowSpan, colSpan], title: "SEARCH SERVICE", color })`: a washed box behind the cards in those cells, titled in its corner. On a board that reviews a change, mark what it did to a part with `change: "added" | "modified" | "removed"` on the card: its dot and left edge take the change colour at rest, and a removed part's title is struck. When the cards carry marks a reader must decode, add `s.legend([{ form: "cylinder", label: "Database" }, { change: "modified", label: "Changed here" }])`, one row under the scene; name only what matters.

### A hand-made layout: lanes, axes, graphs

When the drawing is not a grid of cards (attempts on a time axis, two lanes interleaving, a state graph), lay out your own elements with the kit (`wb-node`, `wb-lane`, `wb-table`) and connect them:

- `whiteboard.arrow("#caller", "#service", { enter: "a1" })` draws an SVG arrow that follows the two elements. A string here is a CSS selector; in a scene's methods it is a card id.
- `whiteboard.token({ label: "GET" })` and `whiteboard.travel(token, arrow, "a1")` ride a chip along the arrow during that frame.
- `whiteboard.timeline("a1").add(".wait", { scaleX: [0, 1], duration: 600 })` adds tweens that play when the reader steps into the frame and land at their end on a jump.

Declare arrows, tokens, travels and timelines while the script first runs, naming the frames they play in; they cannot be added from a frame handler. `data-enter="a1"`, `data-exit="a3"`, `data-only="a1 a3"` and `data-highlight="a1 a3"` on any element show, hide or ring it in those frames with no script.

### Your own HTML: draw each frame from its data

For anything else (a log, a table, a chart, a state machine), put what each frame shows in its `data`, and write one script that draws any frame from it. The script never names a frame key, so a new frame or scenario only adds entries to `frames.json`, and `animation.html` stays as it is.

Draw the frame in full, then animate what is new since the previous frame:

```html
<div class="wb-row attempts"></div>
<script>
  const row = document.querySelector(".attempts");

  whiteboard.on("*", ({ frame, previous }) => {
    const chips = frame.data.attempts.map((result) => {
      const chip = document.createElement("span");
      chip.className = "wb-chip";
      chip.dataset.tone = result === "ok" ? "added" : "removed";
      chip.textContent = result;
      return chip;
    });
    row.replaceChildren(...chips);

    const before = previous?.data.attempts.length ?? 0;
    return chips.slice(before).map((chip) =>
      whiteboard.animate(chip, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], 300),
    );
  });
</script>
```

Write each frame's data in full, not as a change from the one before: a reader can jump straight to any frame. `whiteboard.animate` skips the motion on a jump and under reduced motion, and returning its animations makes playback wait for them. Give every keyframe its start value (`[{ opacity: 0 }, { opacity: 1 }]`, not `[{ opacity: 1 }]`): a jump finishes the animation, and a missing start lands wrong.

Something that moves between frames (a job changing queue slot, a record regrouped under a new parent) is drawn the same way: measure every element's position, redraw, then animate each moved element from its old position to `transform: none`. Measure everything before starting any animation; one that has started already reports its transform.

`whiteboard.frames` and `frame.index` follow the active scenario, so a frame outside it is not listed. Key your drawing on `frame.data`, not on positions.

## Painting in

When you write an animation, the reader watches it arrive: its first frame paints in, part by part, instead of appearing at once. It paints only then, not when the board loads with it already there, and not under reduced motion. The test harness and a cold load do not paint, so you see it only by watching your own write land on the board.

- By default the kit's parts (cards, nodes, chips, badges, table rows, lanes, labels, peeks, tokens) fade in one after another in document order, and arrows draw along their path, all within about a second and a half. A part inside another goes in with it.
- `data-wb-paint="1"` orders a part: numbered parts first, the rest in document order. `data-wb-paint="none"` shows an element and everything in it at once. `data-wb-paint-style="fade"`, `"draw"` (an SVG line), `"wipe"` (left to right) or `"none"` picks the effect. Any element with either attribute paints on its own.
- `whiteboard.on("paint", ({ frame, instant }) => ...)` replaces the default painter: draw the first frame in yourself and return the animations, as a frame handler does. It also runs with `instant: true` when the block does not paint in; leave everything in its end state then. `whiteboard.timeline("paint")` is a timeline that plays once as the block paints in and lands at its end otherwise; it also replaces the default painter. Do not name a frame `paint`.

## Link the code

Name the ranges the animation explains in `code`, then link the drawing to them:

- `data-wb-open="retry"` (or `code: "retry"` on a scene card) opens the code beside the whiteboard when the reader clicks that element, and names it when they hover. Put it on the part of the drawing the code explains.
- A frame's `code` lists the ranges that frame shows. Your script reads it as `frame.code`, so one script can mark what to open in every frame.
- `<div data-wb-code="retry">` (or `scene.peek`) shows a range inside the drawing instead.

## Clips: one timeline, played

Pick a clip when the motion itself is the point and the timing carries the meaning: a token crossing a system, two requests racing, a queue draining, a timeout firing while a reply is on its way. Pick an animation when the reader needs to compare discrete states, one frame against the next.

A clip's folder holds `markers.json` where an animation's holds `frames.json`; `session_checkout` writes whichever the block has, and publishing a folder with `markers.json` makes a clip. A marker is `{ key, title, caption?, code? }`: a named moment the reader jumps to and the tour stops at. The strip under the clip shows each title, so keep titles to a few words. Markers have no `data` or `duration`: the script decides when each one happens.

Build the timeline while the script first runs, and place every marker on it:

```html
<script>
  whiteboard
    .clip()
    .marker("sent")
    .add(".packet", { left: ["10%", "50%"], duration: 700 })
    .marker("accepted")
    .add(".packet", { left: ["50%", "90%"], duration: 900 })
    .marker("stored");
</script>
```

- `whiteboard.clip()` returns a timeline with `add`, `set` and `call`, as `whiteboard.timeline` does, and `.marker(key)`, which places a declared marker at the timeline's end so far, or at an anime.js position (`.marker("timeout", 1500)`). Numeric positions count from the clip's start. Markers are labels on the timeline, so later calls can start at one: `.add(".retry", { opacity: [0, 1] }, "timeout")`.
- A marker the script leaves unplaced shows an error under the clip, naming it.
- With `scenarios` (`[{ key, label }]` in `scenarios.json`), each scenario is a timeline of its own: call `whiteboard.clip("fast")`, `whiteboard.clip("slow")`, once each, and place every marker on each. A `whiteboard.clip()` without a key serves every scenario that has no timeline of its own.
- Write each tween with its start value (`left: ["10%", "50%"]`, not `left: "50%"`), and make what differs between beats a `set` or a tween on the timeline: jumping back to a marker then undoes everything after it.
- `whiteboard.on("stored", ({ marker, instant }) => ...)` runs when the playhead crosses that marker playing forward, or lands on it after a jump with `instant: true`; `"*"` runs on every marker. Use it for what a tween cannot draw, such as changing text, and set the whole state for that marker, since the reader can jump straight to it. `whiteboard.markers` lists the markers with their `at` (milliseconds) once placed, and `whiteboard.marker` is the one the playhead last reached.
- In a clip, `data-enter`, `data-exit`, `data-only`, `data-highlight` and `scene.on` name markers instead of frames, and follow the marker the playhead last reached.
- `whiteboard.frames`, `frame`, `goto`, `next`, `prev`, `setSequence`, `timeline(key)`, `travel` and `scene.send` belong to frames and throw in a clip. Move tokens with tweens on the clip instead.
- Under reduced motion the clip never animates: Play steps from marker to marker, holding each for a few seconds and landing on its time at once, and a jump lands at once. Marker handlers get `instant: true`.
- Painting in and code linking work as for an animation: the clip paints in at time 0, before anything plays, and a marker's `code` gives its tour stop, as a frame's does.

