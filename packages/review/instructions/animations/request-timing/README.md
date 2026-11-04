# One read, with and without the cache

A clip of one request crossing client, API, cache and database as a continuous trip, with an elapsed bar, played once as a cache hit and once as a miss.

## Use when

A change adds, removes or moves a cache, a retry or any hop on a request's path, and the reviewer has to feel what it does to latency: the point is how long each leg takes, not a list of states.

## Shows

A GET token rides from the client to the API and on to the cache. On a hit the cache answers at once; on a miss the read goes on to Postgres, waits there, and comes back through the cache to fill it. A 200 token rides home and the elapsed bar, which fills for the whole trip, stops at that scenario's total. The markers name the same five beats in both, so jumping to Cache lookup in either shows where the paths split.

## Technique

A clip: markers.json declares the beats, and the script builds one timeline per scenario with `whiteboard.clip(key)`, placing each marker with `.marker(key)` where the request reaches it. Tokens move by `left` percentages, so the trip follows the four-column layout at any width. Everything that differs between the scenarios (the result chip, the second token, the total) is a `set` on that scenario's timeline, so a jump back undoes it. The elapsed bar is one tween added at position 0 with the trip's length, scaled by the longest trip so the two scenarios' bars compare.

## Adapt

- Rename the four nodes and their `<small>` lines for your path, and keep the column centers in `client`, `api`, `cache`, `db` in step with the grid.
- Change the leg lengths in `hop` and `hold` to the proportions that matter, a slow query or a fast cache, and set `LONGEST` to the longest scenario's sum.
- Add a scenario (a stale entry, a timeout) with an entry in scenarios.json and one more `build` call that places every marker.
- Point `code` at your client call, handler, cache and query, and list them on the markers that show them.
