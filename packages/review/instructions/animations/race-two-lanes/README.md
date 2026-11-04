# Lost update between two writers

Two actors read, modify and write one shared row in interleaved steps on two lanes, losing an update without a lock and serializing behind it with one.

## Use when

A change touches a read-modify-write on shared state, such as a balance, a counter or a JSON blob saved back whole, or adds or removes a lock, a transaction or a version check around it, and the reviewer has to judge whether two concurrent callers can clobber each other.

## Shows

Each actor's steps appear on its own lane in time columns, so the interleaving reads left to right, and its card shows the value it holds locally. The row below changes as writes land. Without a lock, both read 100 and B's write of 120 erases A's 150. With a lock, B's blocked bar grows until A writes and releases, then B reads 150 and writes 170.

## Technique

Data-driven: each frame's `data` holds the full state (the column count, every step so far with its lane, column, span and tone, each actor's local value, and the row), and one `whiteboard.on("*", ...)` handler redraws it all. It compares with `previous.data` to animate only what changed: a new step slides in, a wait that lasted another step grows from its old width, a step whose tone changed fades up, and a changed cell slides in, all through `whiteboard.animate`, so jumps and reduced motion draw the end state.

## Adapt

- Rename the actors in the two cards and rewrite the step `text` for your operation: an increment, a cache refill, a config file saved back.
- Change the row: its columns are the keys of `record.row`, so add a `version` column to show optimistic concurrency, and add a scenario where B's write is rejected and retried.
- Keep `columns` the same across a scenario's frames so the lanes do not reflow as steps arrive.
- A new frame or scenario is only new entries in frames.json and scenarios.json; animation.html stays as it is.
