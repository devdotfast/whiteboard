# State machine

An entity's states drawn as nodes with their legal transitions as arrows, where each frame names the current state and the transition tried, a token rides the arrow taken, and an illegal transition is refused without a state change.

## Use when

A change adds, removes or guards a transition, such as an order status, a job lifecycle or a subscription, and the reviewer needs to see which moves are legal from where and what happens to one that is not.

## Shows

- Happy path: draft, submit to queued, pay to paid, ship to shipped, then a cancel refused because the order has shipped.
- Cancellation: draft, queued, cancel to cancelled, then a late payment refused.
- The current state is ringed and the persisted `status` value sits below; a refused move draws a dashed red arrow, its token stops partway, and a 409 chip names the reason.

## Technique

Data-driven: each frame's `data` is `{ state, transition?: { event, from, to, refused? } }`, complete per frame, and one `whiteboard.on("*", ...)` draws any frame from it. Nodes are `.wb-node` elements in a CSS grid, the start and the final states as `data-form="pill"`; `whiteboard.arrow` draws the edges and one `whiteboard.token` rides them. The ride is a `whiteboard.animate` over points sampled from the arrow's path, so it skips itself on a jump and under reduced motion; it plays only when stepping forward.

## Adapt

- Replace the nodes and the `arrow(...)` calls with your states and legal transitions; place nodes with the grid, at most four columns.
- Write one frame per step in `frames.json`; a new scenario needs no script change.
- Set `refused` to the error your code returns for an illegal move.
- Point `code` at your transition table.
