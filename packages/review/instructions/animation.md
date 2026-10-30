An `animation` component draws HTML you write on the whiteboard, in a sandboxed iframe. The reader steps through its frames, or plays them.

## The component

```json
{
  "type": "animation",
  "title": "Retry with backoff",
  "frames": [
    { "key": "send", "title": "The client sends", "caption": "The first request times out.", "data": { "attempts": ["timeout"] } },
    { "key": "retry", "title": "The retry succeeds", "code": ["retry"], "data": { "attempts": ["timeout", "ok"] } }
  ],
  "code": { "retry": { "source": "head/src/http/retry.ts#L12-L40", "label": "retryWithBackoff" } },
  "html": "…"
}
```

- `scenarios` are the paths a reader can pick, 2 to 8, each `{ "key": "retried", "label": "Retried", "frames": ["send", "retry"] }`. The animation starts on the first. Use them instead of drawing your own buttons.
- `code` names source ranges, each a range or `{ "source", "label" }`. Label each with what it is, such as the function. Make the parts of your drawing that the code explains clickable with `data-wb-open="retry"` (or `code: "retry"` on a scene card): the whiteboard opens the code beside the whiteboard when the reader clicks them, and names it when they hover. A frame's `code` lists the ranges that frame shows; your script reads it as `frame.code`. To show a range inside the drawing instead, use `<div data-wb-code="retry">` (or `scene.peek`).

## Work in files

1. `session_checkout({ sessionId, targetId })` writes the animation to a folder: `animation.html`, `frames.json`, `scenarios.json` (once it has scenarios) and `block.json` (`title`, and `code` and `pins` when it shows code).
2. Edit those files with your file tools.
3. Publish the folder: `session_edit({ sessionId, edit: { type: "update", targetId, fromFiles: "<folder>" } })`. Only the files you changed are saved. Keep editing and publishing the same folder; it records what it last published in `checkout.json`.
4. Read it back with `session_get({ sessionId, targetId })`. Its script runs only where the whiteboard is open, a moment after you publish, so the read says whether it ran there without an error, threw (with the error), or has not run yet. Fix an error and publish again.

For a new animation, write the same files into a folder of your own and publish with `{ type: "insert", fromFiles: "<folder>", parentId, afterId }`. If someone else changed the animation after your checkout, the publish is refused: check it out again.

## Draw it

Before you write HTML, read the two files whose paths `session_checkout` and these instructions give: `whiteboard.css`, the classes and `--wb-*` variables every animation loads, and `whiteboard.d.ts`, the `whiteboard` API. Use the classes and variables rather than your own colors, sizes or fonts, so the animation matches the board in light and dark.

There are two ways to draw.

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

A scene names frame keys, so a new scenario means new frames and a few new lines like these.

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

Write each frame's data in full, not as a change from the one before: a reader can jump straight to any frame. `whiteboard.animate` skips the motion on a jump and under reduced motion, and returning its animations makes playback wait for them.
