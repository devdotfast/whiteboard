# Request fan-out

One request crosses the system step by step: each step is a frame, its movements ride the wires together, and a second scenario takes another path through the same drawing.

## Use when

The order of calls matters: a request fans out, waits on several services, and answers; or two requests take different paths through the same parts.

## Shows

- Play: the TV app asks the gateway, the gateway asks Playback and Catalog at once, Playback checks the plan, and the answers come back.
- Browse: the web app searches the catalog, a shorter path through the same parts.
- Each step lights what its own moves touch; what the request never touches dims.

## Technique

The drawing is the same as a still diagram; `frames.json` adds the steps. Each frame's `moves` name nodes by id and ride the wire between them; a move against a wire's direction is a reply. A fan-out is one frame with several moves, with `delay` to stagger them. `scenarios.json` lists each path's frame keys. Each frame's `code` names the calls it walks through, and the code view follows the steps.

## Adapt

- One movement, or one fan-out, per frame. Keep a frame's title to what happens, its caption to why.
- Every move needs a wire between its two nodes: draw the wire, or the render's findings will name the move.
- Use scenarios for paths a reader picks between, never buttons in the drawing.
