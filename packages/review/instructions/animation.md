An `animation` component draws HTML you write on the whiteboard, in a sandboxed iframe. The reader steps through its frames, or plays them. The `session_edit` schema lists its fields.

For paths a reader can pick, such as a retry that succeeds or one that gives up, use `scenarios`: the whiteboard draws the picker, so do not draw your own buttons.

## Work in files

1. `session_checkout({ sessionId, targetId })` writes the animation to a folder: `animation.html`, `frames.json`, `scenarios.json` (once it has scenarios) and `block.json` (`title`, and `code` and `pins` when it shows code).
2. Edit those files with your file tools.
3. Publish the folder: `session_edit({ sessionId, edit: { type: "update", targetId, fromFiles: "<folder>" } })`. Only the files you changed are saved. Keep editing and publishing the same folder; it records what it last published in `checkout.json`.
4. Read it back with `session_get({ sessionId, targetId })`. Its script runs only where the whiteboard is open, a moment after you publish, so the read says whether it ran there without an error, threw (with the error), or has not run yet. Fix an error and publish again.

For a new animation, write the same files into a folder of your own and publish with `{ type: "insert", fromFiles: "<folder>", parentId, afterId }`. If someone else changed the animation after your checkout, the publish is refused: check it out again.

## Draw it

Before you write HTML, read the two files whose paths `session_checkout` and these instructions give: `whiteboard.css`, the classes and `--wb-*` variables every animation loads, and `whiteboard.d.ts`, the `whiteboard` API. Use the classes and variables rather than your own colors, sizes or fonts, so the animation matches the board in light and dark.

Start from the reference closest to what you are drawing, listed under References at the end of these instructions: copy its folder into your draft, then change the data, the prose and the code links.

There are three ways to draw.

### A scene: cards and messages

For a few services, processes or stores with messages moving between them, use `whiteboard.scene`. You place cards on a grid and say what changes in which frame:

```html
<script>
  const s = whiteboard.scene({ columns: 2 });
  const client = s.actor({ id: "client", at: [1, 1], title: "Client" });
  const api = s.actor({ id: "api", at: [2, 1], title: "API" });

  s.send(client, api, "GET", "send");
  s.on("send", api, { note: "timed out", tone: "removed" });
  s.send(client, api, "GET", "retry");
  s.on("retry", api, { note: "200 OK", tone: "added" });
</script>
```

A scene names frame keys, so a new scenario means new frames and a few new lines like these. A card's `id` is its element's id, so your own CSS can address it as `#api`.

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

## Link the code

Name the ranges the animation explains in `code`, then link the drawing to them:

- `data-wb-open="retry"` (or `code: "retry"` on a scene card) opens the code beside the whiteboard when the reader clicks that element, and names it when they hover. Put it on the part of the drawing the code explains.
- A frame's `code` lists the ranges that frame shows. Your script reads it as `frame.code`, so one script can mark what to open in every frame.
- `<div data-wb-code="retry">` (or `scene.peek`) shows a range inside the drawing instead.
