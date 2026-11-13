# Request with state

A request crosses a drawing step by step while a panel of markup under it shows the state the request reads and changes: here, the tokens left in a rate limiter's bucket.

## Use when

The point is a value that changes as the request moves, such as a counter, a queue's length or a cache's contents, and the drawing alone cannot show it.

## Shows

- Allowed: the gateway takes a token from the caller's bucket in Redis and forwards the request.
- Rate limited: the bucket is empty, so the gateway answers 429 and the API never sees the request.
- The panel under the drawing shows the tokens left and the decision on every step, and the Retry-After row appears only on the 429.

## Technique

`diagram.js` draws the nodes and wires; `diagram.html` is the page: the `data-wb-drawing` element the drawing goes in, then the panel under it. Each frame carries its state in `data`, and a `wb.onFrame` listener writes it into the panel's elements, found with `document.querySelector`. The Retry-After row is plain markup with `data-wb-only`, so it needs no script.

## Adapt

- Put what changes every step in a frame's `data` and write it from `wb.onFrame`; mark what only appears or disappears with `data-wb-from`, `data-wb-until` or `data-wb-only`.
- Leave the panel's width alone: a block under the drawing is as wide as the page, so it matches the drawing and stays inside the board's column.
- Colour it with the `--wb-*` variables so it follows the board's theme.
