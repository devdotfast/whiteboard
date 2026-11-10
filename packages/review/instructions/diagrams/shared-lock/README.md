# Shared lock

Two workers share a lock service and a store, placed by hand, while a panel beside the drawing shows the lock's holder, its lease and its fencing token. A write with an old token is refused, and its move is drawn as a failure.

## Use when

Two or more callers share the same services: a lock, a queue, a database. ELK lines such a small, crossing graph up poorly, and the point is a refusal or an error the reader must see.

## Shows

- Holds the lock: worker A takes the lock, gets token 33, and writes with it.
- Pauses: A stops for a long garbage collection, its lease runs out, and B takes the lock with token 34 and writes. A wakes, writes with token 33, and the store refuses it.
- The panel beside the drawing shows the holder, the lease left, the newest token and the highest token the store has accepted, on every step.

## Technique

`diagram.js` places the four nodes by hand on a diamond, the lock above and the store below, with a worker on each side, so no two wires share a path. The wires have ids, and moves name them in `edge` where two could match. The refused write is a move with `failed: true`, which draws its token red. `diagram.html` is the page: a flex row of the `data-wb-drawing` element and the panel, 24px apart. Each frame's `data` fills the panel from `wb.onFrame`.

## Adapt

- Place a small graph whose callers share targets by hand: callers on the sides, shared services above and below.
- Mark a call that fails with `failed: true` on its move rather than in the caption alone.
- Give a panel beside the drawing a fixed width of about 180px, so the row fits the board's column.
