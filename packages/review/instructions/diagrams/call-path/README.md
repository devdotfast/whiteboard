# Call path

The path a user action takes through the code before and after a change, as two scenarios over one drawing: the reader switches between them and steps through the calls.

## Use when

A change reroutes a flow: a new function in the path, a call that moved, a step that went away. The reader needs to see the old and new path side by side, rooted in the entry point.

## Shows

- Before: the button's handler calls the save function, which writes straight to the database.
- After: the handler calls a new validation step first, and the save function goes through a repository.
- Parts only one path uses dim while the other scenario shows.

## Technique

Functions are `component` nodes laid out downward from the entry point. Both paths share one drawing; each scenario lists its own frames, and each frame's move is one call. The moves engine dims what a scenario never touches, so a node only the new path uses fades in the old one. Every node and wire links to its code.

## Adapt

- Root both paths in the entry point the user triggers, and keep unchanged steps in the path.
- Name the scenarios after the commits or states they show: "Before", "After".
- Link base code for what the change removed: `base/...` anchors work in `code`.
