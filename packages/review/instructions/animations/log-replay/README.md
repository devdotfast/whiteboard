# Log replay

An append-only event log replays one event per frame into a derived accounts table, and a second scenario redelivers an event that the checkpoint guard skips, so the state visibly stays put.

## Use when

A change adds or alters an event-sourced projection, a consumer of an at-least-once queue, or any handler that folds a log into state. The reviewer needs to see which row each event touches, and that a duplicate or replayed event cannot change the result.

## Shows

- Left, the events seen so far, the current one highlighted; a redelivered event carries a `redelivered` chip.
- Right, the derived rows: a new row toned `added`, a changed balance `modified`, the touched row underlined, and a checkpoint badge.
- Under the table, the handler's outcome for the current event; it opens the code that decided it.
- Clean replay: four events build the state. Redelivered event: #2 arrives again, the row shows `unchanged`, the checkpoint does not move, and the replay ends in the same state as the clean one.

## Technique

Data-driven, with `scenarios` for the two paths; frames the paths share (#1 and #2) are declared once. Each frame's `data` holds the events seen so far, every account row with its tone, the touched row, the checkpoint and the outcome. One `whiteboard.on("*", ...)` handler redraws both tables and returns `whiteboard.animate` fades for what is new since `previous`: the appended event, a new row, a changed balance. Nothing animates on the right when an event is skipped, which is the point. `frame.code[0]` becomes the outcome chip's `data-wb-open`.

## Adapt

- Rewrite `frames.json` with your events and state rows; give each frame the whole log so far and the whole state, never a delta.
- Change the column headers and `row([...])` cells in `animation.html` if your state has more than two columns.
- For an out-of-order event instead of a duplicate, keep the same shape: mark the event in `events`, leave the state as it was, and say why in `result`.
- Name the handler and its guard in `block.json` `code` and list the one each frame exercises.
