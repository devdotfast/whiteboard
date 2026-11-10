# Layered architecture

A streaming platform's containers, grouped by the team that owns them, with every container and call linked to its code and laid out by `wb.layout()`.

## Use when

The reader needs the shape of a system before its behaviour: which parts exist, who owns them, and which calls cross a boundary.

## Shows

- People and client apps on the left, the platform's teams as coloured groups inside one boundary, stores at the far end.
- Each wire says how the call travels (HTTPS, gRPC, SQL) and links to the line that makes it.
- A third-party service sits outside the boundary, drawn as `external`, with a dashed wire.

## Technique

Nodes are drawn without coordinates; `wb.group({ around })` wraps them, inner groups first, and one group around the groups becomes the boundary. `await wb.layout({ direction: "right" })` places it all. Every container names its code; a wire names its call site.

## Adapt

- Keep a node's label to its name and put its tech in `tag`: "Container · Go".
- One group per owner. Leave a part ungrouped rather than invent an owner.
- Link only the lines a node or wire stands for: the function for a node, the call itself for a wire.
