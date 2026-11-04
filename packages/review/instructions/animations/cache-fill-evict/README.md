# Read-through cache with LRU eviction

A scene with a caller, a bounded cache and a slow source that walks a miss and fill, a hit, and an eviction when the cache is full.

## Use when

A change adds or alters a cache in front of a slower dependency: its read-through path, its capacity, or what it evicts and when.

## Shows

- Miss: the request falls through to the source, the row is stored as the newest entry, then returned.
- Hit: the value comes from memory, the source is marked not called, and the entry moves to the newest end.
- Full: the oldest entry is marked, then leaves as the loaded one enters; the cache stays at capacity.

## Technique

Scene-based. `whiteboard.scene` places three cards; `scene.store` holds the entries as `cache.item(label, { enter, exit, tone })`. `scene.send` moves each request and reply, and `scene.on(frame, part, { text, tone })` changes notes and tones from a frame on. Items keep their order, so each scenario seeds its own entries, and a moved entry is one item exiting while another enters. The cache card opens code with `code:`; a `whiteboard.on("*")` handler points it at the first name in `frame.code`, so clicking it during an eviction opens the eviction range.

## Adapt

- Rename the cards and keys to your caller, cache and source; keep labels short (chips about 12 characters).
- Change the capacity by seeding more items, and the policy by which item exits (oldest for LRU or FIFO, least used for LFU).
- Add a scenario such as a stale entry or a failed load with new frame keys and a few `send` and `on` lines.
- Point `code` in block.json at your real ranges and list them in each frame's `code`.
