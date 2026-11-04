# Request across layers

One request crosses client, API, service and database and back, and each card shows the payload in the shape that layer holds, with a branch where validation stops it at the API.

## Use when

A change touches how a request is parsed, validated, mapped or persisted, and the reviewer needs to see which layer owns which shape and where a bad input is turned away.

## Shows

- Valid order: a JSON body with a string `qty` becomes a typed DTO, a domain Order without an id, a row with one, an Order again, and a 201 body.
- Validation fails: the API answers 422 naming the field; the service and the database are marked not called.
- The card doing the work is ringed in each frame; its note keeps the shape it produced, so earlier shapes stay readable.

## Technique

A scene: `whiteboard.scene({ columns: 4 })` with four `actor`s, solid `link`s for requests and dashed ones for replies, one `send` per hop per frame, and `on(frame, card, { text, tone })` for the payload shape. `highlight` rings the active card; `code` on a card and each frame's `code` link the ranges.

## Adapt

- Rename the actors and code ranges to your layers; keep four or fewer in a row.
- Write each note as the payload's real type at that layer, short enough for two lines.
- Keep one `send` per frame: sends on different edges in one frame start together.
- Branch with new frame keys (a different body) and a scenario, not by drawing buttons.
