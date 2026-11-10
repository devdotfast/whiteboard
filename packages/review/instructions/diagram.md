A `diagram` draws a system on the whiteboard: its parts, what joins them, and a request crossing them step by step. Most diagrams are markup alone, in `diagram.html`. A sequence, a chart, a played timeline or a 3D scene is drawn by a script, `diagram.js`.

## Work in files

1. Write a folder: `diagram.html`, and `block.json` (`title`, `description`, `code`). For steps, add `frames.json` and, for paths the reader picks between, `scenarios.json`.
2. Publish it with `session_edit` and `{ type: "insert", fromFiles: "<folder>", afterId }`. Publishing writes `checkout.json` into the folder: keep editing there and publish changes with `{ type: "update", targetId, fromFiles }`. `session_checkout` writes a folder for a diagram you have none for.
3. Render it with `session_render({ sessionId, targetId, frame: "all" })` and look at every PNG. Check the drawing says what you meant, then read the rest of the result:
   - `error`: the script threw. Fix it.
   - `findings`: something is drawn wrong, such as an overlap, cut-off text or a move with no edge. Fix each one.
   - `notes`: a choice the stage made, such as turning a graph that was too wide. There is nothing to fix. Change the diagram only if you want a different result.
   - `claims`: how the code links stand. See Link the code.

## Markup

- `<wb-graph direction>` lays out everything inside it and routes the edges. `direction` is `right` or `down`. A graph too wide for the board is turned, and one too tall is folded into columns.
- `<wb-node id label tag kind>` is one part. `tag` is a second line, such as its technology. `kind` is `person`, `system`, `container` (an app or service), `component`, `database`, `queue` or `external` (a third party).
- `<wb-group label tag>` holds the nodes one owner has. Groups nest. Each takes a colour in turn; `color` names one: `sky`, `teal`, `green`, `amber`, `coral`, `rose`, `violet` or `neutral`.
- `<wb-edge from to label>` joins two nodes by id. Its label says how the call travels, in a word or two. Add `dashed` for a call nobody waits on.
- `<wb-panel label>` is a table of state inside a graph. Each `<wb-row label value="key">` shows that key of the current frame's `data`; a row with text and no `value` shows that text on every step. The graph puts the panel beside the nodes or under them; `side="right"` or `side="below"` asks for one.

Rules:

- Keep labels to a few words. Every piece sizes itself from its text.
- Inside a `<wb-graph>`, write no layout CSS: the graph places everything. Outside one, place things with your own CSS, as on any web page. A page can hold both.
- Write no legend. The stage draws one under a graph whose steps send more than one kind of token. It calls a plain token a "call"; `<wb-graph token="transition">` gives another word.
- Colour anything of your own with the `--wb-*` variables, so it follows the board's theme.

## What to write

Read the reference before you start; its path is under References.

| The diagram is | Write | Reference |
| --- | --- | --- |
| An architecture, a pipeline, or anything that branches or nests | One `<wb-graph>`: a group for each tier, owner or stage, nodes inside them, then the edges | `graph-architecture` |
| A state machine | One `<wb-graph>`: a node for each state and a labelled edge for each transition, back edges included | `graph-order-states` |
| The same, with state that changes by step | A `<wb-panel>` inside the graph, and a `data` object on each frame with the rows' keys | `graph-architecture` |
| Calls between a few participants, in order | `diagram.js`: the participants as nodes in one row, and a frame for each call or reply | `sequence` |
| Timing the reader plays and scrubs | `diagram.js` and a `timeline` of chapters in `block.json`, in place of frames | `played-request` |
| A chart | `diagram.js` with `wb.chart`, which takes Observable Plot options | `latency-chart` |
| Something physical or spatial | `diagram.js` with `await wb.three()`, which gives you three.js | `rolled-die` |

Read `wb.d.ts` (its path is under References) before writing a `diagram.js`.

Start with a `<wb-graph>` whenever the diagram is parts and the calls between them: it fits itself to the board, usually in one render. When you need an arrangement the graph does not give you:

- Lay the nodes out yourself with flex or grid, and no graph. Expect several renders before everything fits.
- Between two neighbours in a row, `<wb-edge></wb-edge>` with no `from` or `to` joins them and makes its own room. Join anything else with `<wb-edge from to>`, written after the layout.
- A table or notes of your own are ordinary markup outside the graph. An element with `data-wb-text="key"` shows that key of the frame's `data`.
- To show an element on some steps only, `data-wb-from="key"` and `data-wb-until="key"` take one frame key each, and `data-wb-only="key key"` takes several.

## Steps

`frames.json` is a list of frames. Each is one step of a request crossing the system.

- Give every frame a `caption`, a sentence saying what happens, and a short capitalised `label` for the step bar.
- `moves` send tokens along the edges, all at once. A move names two node ids. Sent against the edge's direction, it is drawn as a reply.
- Label a token with one word or a status, such as "INSERT" or "200". The caption says the rest.
- An edge shows one token at a time. To show a call and its reply, give each a frame.
- Give a move `failed: true` for a call that fails or is refused, and `lost: true` for one whose answer never comes, such as a timeout.
- A step that moves nothing names the nodes it is about in `focus`, as `"focus": ["breaker"]`.
- `code` lists the code the step walks through, so the reader's code view follows the steps.
- The layout is the same on every step. Steps only light parts and fill `data`.

`scenarios.json` gives the reader paths to pick between, such as a cache hit and a miss: `[{ "key", "label", "frames": [frame keys in order] }]`, with two to eight scenarios. Parts a scenario never touches are dimmed while it is chosen.

## Link the code

Name each range the diagram stands for in `block.json`'s `code`, as `{ "source": "head/path#L12-L30", "label": "API routes" }`. Point a node, edge or frame at it with `code="name"`. A node links where it is defined; an edge links the line that makes the call.

- The side is `head` or `base`. Line numbers are those at the board's commits, which can differ from your checkout. `session_get` names the commits in its header; read a file there with `git show <commit>:<path>`.
- A publish answers with `quotes`, the first and last line of each range. Check they are the lines you meant.
- A render's `claims` count the nodes and edges that stand for code: `matches` are linked to lines that are still there, `changed` are linked to lines that have since changed, and `unlinked` name no `code`. Link every one you can, and fix any that are `changed`.
- A diagram of something outside the board's repository takes no `code`, and nothing in it counts as unlinked.
