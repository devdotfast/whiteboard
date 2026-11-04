# Before/after structure

A flat list of orders regroups into a map keyed by customer: the same records slide from the old shape into the new one, and tones mark the key, the new containers and the field that goes away.

## Use when

A change reshapes data rather than behavior: a list becomes a map or tree, fields move into a nested object, a type gains or drops a level. The reviewer needs to see where each existing value lands, not just the new type.

## Shows

1. The before shape, as nested cards.
2. The field that drives the change (here the grouping key), toned `modified`.
3. The records moving into their new containers, which appear toned `added`.
4. The field the new shape makes redundant, toned `removed`.
5. The after shape, plain.

## Technique

Data-driven. Each frame's `data.root` is the whole structure as a tree of nodes `{id, title, note?, tone?, open?, layout?, fields?, children?}`. One `whiteboard.on("*", ...)` handler redraws the tree, then animates the difference with FLIP: it measures every `[data-id]` before and after the redraw and slides kept elements from their old box with `whiteboard.animate` (a child subtracts its parent's slide). New elements fade in; a new container that receives moved elements fades only its own chrome. `whiteboard.animate` lands the end state on a jump and under reduced motion. A node's `open` becomes `data-wb-open` only in frames whose `code` lists it.

## Adapt

- Rewrite `frames.json`: keep each node's `id` stable across frames, since the id is what makes an element travel instead of reappearing.
- Set `layout: "row"` on a node whose children should sit side by side; the default stacks them.
- Put tones on what changed in that frame only, and leave the last frame plain.
- Name your ranges in `block.json` `code`, list them in the frames that show the transformation, and set `open` on the node the code builds.
- `animation.html` should not need changes.
