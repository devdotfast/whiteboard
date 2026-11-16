# Graph architecture

A rate-limited API in one `<wb-graph>`: two groups, a panel of the limiter's state, and two scenarios. No script, and no layout CSS.

## Use when

The drawing is a system: parts owned by tiers or teams, calls between them, and more than one path a request can take.

## Shows

- `<wb-group label tag>` for each tier. The graph places the groups and gives each its own colour.
- `<wb-panel>` inside the graph, with a `<wb-row label value="key">` for each value. The stage fills the rows from each frame's `data` and keeps the panel one size. `data-wb-value` on a row is there for a style to match.
- `scenarios.json` with two paths over the same drawing. What a scenario never touches is dimmed, so its path stands out.
- `failed` on a move for a call that is refused, and `focus` on a frame that moves nothing.
- `code="name"` on nodes and edges, and `code` on frames, each naming a range in `block.json`.
- The legend under the graph is the stage's: it lists the kinds of token the steps send.
