# Rolled die

A die thrown across a table in three.js, as one timeline the reader plays, pauses and scrubs, with chapters for each phase of the throw.

## Use when

The subject is physical or spatial and a flat drawing loses it: an object moving through space, a 3D layout, a camera view of a scene. Use nodes and wires instead whenever the point is structure.

## Shows

- Shake, throw, two bounces, the die settling, and the result.
- The die's shadow on an invisible table, so the scene reads on light and dark boards.
- The result fading in once the die is still.

## Technique

`const THREE = await wb.three()` loads three.js; the stage has no network, so a script never imports it. The scene is built once. `block.json` holds a `timeline` of chapters and the stage's size, and `wb.onTime((time, moment) => ...)` poses the die as a pure function of time, so scrubbing works either way. `diagram.html` holds the scene's box and the result over its corner; the script puts the renderer's canvas in the box. It draws no nodes, so the page needs no `data-wb-drawing`. Text takes `var(--wb-ink)` and `var(--wb-muted)`.

## Adapt

- Keep every pose a function of time: never move things a little each frame.
- Size the renderer to `stage.width` and `stage.height`.
- Prefer a shadow-only or transparent ground, so the scene sits on the board's own surface.
