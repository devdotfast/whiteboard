A `diagram` component draws in a sandboxed stage on the whiteboard, from markup you write, a JavaScript module you write against the `wb` API, or both. It draws architecture, request flows, sequences, call paths and charts: nodes in groups, wires between them, laid out for you, and steps that move a request along the wires. Every node and wire links to the code it stands for, and the reader can check that each link still holds. The `session_edit` schema lists its fields.

## Work in files

1. Write a folder: `diagram.html` (the page: markup and styles), `diagram.js` (the script) or both, `block.json` (`title`, `description`, `code`, and `stage` or `timeline` when you need them), and, for steps, `frames.json` and `scenarios.json`. Start from the reference closest to what you are drawing, listed under References at the end of these instructions: `shared-lock` and `fan-out` for drawings placed by hand, `request-fan-out` for ELK, `latency-chart` for charts.
2. Publish it: `session_edit({ sessionId, edit: { type: "insert", fromFiles: "<folder>", parentId, afterId } })`, where `afterId` is the block it follows; to add it at the end of the board, give the last block and leave out `parentId`. Publishing writes `checkout.json` into the folder, which makes it your checkout: keep editing the same folder and publish changes with `{ type: "update", targetId, fromFiles }`. `session_checkout({ sessionId, targetId })` writes a diagram you have no folder for. A publish is refused when someone changed the diagram after your checkout.
3. Look at it: `session_render({ sessionId, targetId, frame })` shows the diagram on the whiteboard open in Desktop and returns it as a PNG image. `frame` is a frame key; without it, the first frame of the first scenario; `"all"` renders every frame of every scenario in turn, a file for each, with the findings of all of them. Render `"all"` before you call a diagram done: some findings, such as a token cut off, appear only once their step has shown. A single frame several scenarios share renders in the scenario showing, or else in the first that has it. The PNG shows the step at rest, each token where its move ends; the reader sees the same moves play. The result holds:
   - `error`: what stopped the script, with its line in `diagram.js`;
   - `findings`: what drew but is wrong: overlapping nodes or labels, a wire through a node, a move with no wire, a code name the block does not define, a node id used twice, a node's or group's name or tag cut off, a step label cut off on the step bar, a chart Plot warns about, text running into other text inside a chart, a drawing or page wider than the board's column;
   - `claims`: how many nodes and wires match their code, have changed, or name none (it counts what is drawn, not the entries in `code`);
   - `clipped`: true when the diagram is taller than the Desktop window, so the PNG cuts it off.
     Fix every finding and render again, then look at the PNG yourself: findings cover the nodes, wires and labels, not everything. Check that the drawing reads the way you meant. Do not take screenshots of the screen.
4. `session_get({ sessionId, targetId })` reports the same error, findings and claims from the last time an open whiteboard ran the script, without a picture.

## Draw it

Read `wb.d.ts` (its path is under References) before writing the script. A script that draws nodes ends with `await wb.layout()`, which places everything with ELK, or `await wb.layout({ mode: "manual" })` when you place the nodes yourself. See Pick a layout below. A script of charts alone needs neither.

```js
const web = wb.node({
  id: "web",
  kind: "container",
  label: "Web app",
  tag: "Container · React",
  code: "web-app",
});
const api = wb.node({
  id: "api",
  kind: "container",
  label: "API",
  tag: "Container · Go",
  code: "api-routes",
});
const db = wb.node({
  id: "db",
  kind: "database",
  label: "Orders",
  tag: "Database · Postgres",
  code: "orders-table",
});

wb.edge({ from: web, to: api, label: "HTTPS", code: "web-calls-api" });
wb.edge({ from: api, to: db, label: "SQL", code: "insert-order" });

wb.group({ id: "backend", label: "Backend", around: [api, db] });
await wb.layout({ direction: "right" });
```

- Pick each node's `kind` by what it is: `person`, `system`, `container` (an app or service), `component`, `database`, `queue`, `external` (a third party). Kinds differ by outline; colour belongs to groups and state.
- Group what belongs together with `wb.group({ label, around })`: inner groups first, then a group around them, which becomes their boundary. Colour says who owns what.
- Keep labels to a few words: "HTTPS", "gRPC", "GET /play". The wire's label says how it travels, its `code` says where.
- Use `var(--wb-ink)`, `var(--wb-muted)`, `var(--wb-accent)` and the other `--wb-*` variables, or `wb.colors()`, for anything you colour yourself, so the diagram follows the board's light and dark theme. Drawn that way, it needs no check in the other theme.

## Pick a layout

The board's column is about 720px wide, and the stage keeps 8px of it on each side, so a drawing placed by hand must end by x = 700: its outermost edge, a group's padding and a node's widening included. A drawing ELK lays out `right` that comes out wider than the column is laid out `down` instead when that fits; when neither fits, the findings say to place it by hand. A drawing you place by hand that is wider than the column scrolls sideways, and the findings say what reaches furthest and how far to move it. Keep the stage under about 600px tall too: a taller one does not fit a laptop's Desktop window, and its render comes back `clipped`. Keep the drawing near square: a long thin strip reads badly in the column. Two layouts get you there.

**ELK** (`await wb.layout()`) places nodes, groups, wires and labels and keeps them clear of each other. Use it when the graph branches or fans out, when groups nest, or when you cannot picture a clean arrangement. Give it a `direction`, and turn a long chain inside one group with `wb.group({ direction })`: a drawing laid out `right` whose group stacks `down` keeps the chain from stretching it. Not the other way round: a drawing laid out `down` whose groups run `right` steps each group sideways into a staircase. A chain that runs through three or more groups, or through three or more columns of nodes with a group among them, is the exception to ELK: place it by hand, whatever its size.

**Manual** (`await wb.layout({ mode: "manual" })`) keeps the `x` and `y` you give every node. Use it for a small drawing whose shape you can see and ELK spreads out, such as a column of services beside the two things that call them, and for a chart or 3D scene beside a sketch. A wire runs between the sides that face each other: left and right when the two nodes do not overlap across, otherwise top and bottom. It runs straight when its two ends can meet level: when one node's side spans where the wire meets the other, as a node as tall as a column beside it spans every wire to that column. Otherwise it bends twice, crossing over about halfway between them. Wires that share a side spread 12px apart, cross over on lanes of their own, and put their labels by the quieter end, off the nodes, so a fan-out with replies stays clear: the `fan-out` reference is one. So:

- Line nodes up on shared rows and columns; a wire between aligned nodes runs straight. A node's `x`, `y`, `width` and `height` are the box around all it draws, a person's head and a database's lid included, so boxes add up. Leave out `width` and a node is 160px; give it to line a column up. Either way a node widens to show its name and tag whole. Placed by hand at a `width` it outgrows, it grows about its middle and the findings say so, with the width it took, so you can line the rest up to it.
- A token rests on its wire: give a wire that carries a labelled move about 7px per character of the label plus 40px. On a wire that bends, a last stretch too short for it makes the token rest back around the bend; the findings name a token cut off, or one with nowhere clear to rest, with the length it needs.
- Leave the label's width plus about 40px between nodes where a labelled wire runs, and 56px where an unlabelled one does. Budget the column's 700px before you place: three columns of 160px nodes leave two 110px gaps, room for labels of about 9 characters; four columns of 124px nodes leave 52px gaps, room for unlabelled wires only, so label those moves with the step instead. A group adds its padding to either side of what it holds, 20px unless you give `padding`, and a wire's label needs the gap to the group's edge, not to the node inside: give the group a padding of about 12 where its wires carry labels.
- Put the two ends of a wire where its elbow will not cut through a third node or a group's name.
- A group with `around` wraps its nodes with 20px of padding, and about 21px more above them for its name, which sits at the top left. A group whose name and tag are wider than that grows about its middle to show them whole. Put what the group is in `label` and a short qualifier in `tag`, such as `label: "Participants", tag: "own databases"`: the tag follows the name in small capitals, as "Participants OWN DATABASES", so leave out any separator. A wire through the name moves it to the right end of the header, then to the first stretch between wires that holds it; a header with no such stretch is a finding. Start at 0: what reaches above or left of the stage's corner, such as that name, moves the whole drawing in.
- Wires between the same two nodes, such as a request, its reply and a retry, run side by side 12px apart with the outer two labels on the outer sides and any between on their wires. Run three or more side by side across, not down: a label on a wire that runs down covers its neighbours. Give each an `id`, and name it in a move's `edge` so the move rides the one you mean; without `edge`, a move rides the wire that runs its way.
- The stage takes what you drew. `stage` in `block.json` is a least size, for a 3D scene or room you want kept; the stage still grows to hold everything.

Whichever you pick, render and fix the findings. If a manual drawing keeps colliding, switch to ELK. If ELK crosses wires or stacks labels on a small graph, such as two callers that share two services, place it by hand: the `shared-lock` reference does.

## Steps and moves

For a request crossing the system, give the diagram `frames`: each frame is one step, and its `moves` are the movements in that step, which run together. A fan-out is one frame with several moves.

```json
[
  {
    "key": "ask",
    "title": "Request",
    "label": "REQUEST",
    "caption": "The web app posts the order.",
    "code": ["web-calls-api"],
    "moves": [{ "from": "web", "to": "api", "label": "POST /orders" }]
  },
  {
    "key": "store",
    "title": "Store the order",
    "label": "STORE",
    "caption": "The API writes it to Postgres in one insert.",
    "code": ["insert-order"],
    "moves": [{ "from": "api", "to": "db", "label": "INSERT" }]
  },
  {
    "key": "reply",
    "title": "Reply",
    "label": "REPLY",
    "caption": "The API answers once the row is stored.",
    "moves": [{ "from": "api", "to": "web", "label": "201" }]
  }
]
```

- Each move plays once when the reader reaches its step, and its token rests at the end of the wire, just short of the node it reached; the reader replays the step with a button under the diagram. A token's label shows about 16 characters, fewer on a wire too short for it, and the findings name one cut off or one resting against a node; keep it to a word or a status, such as "INSERT", "200" or "miss", and let the caption say the rest. A resting token hides any wire label it covers, and a later move on the same wire, such as the reply, takes over from the token resting there.
- Give a move `failed: true` when it goes wrong: a call that fails or is refused, such as a 5xx or a stale write, and a no vote or an abort: its token is drawn red. The `shared-lock` reference does this. Give it `lost: true` when the message never arrives, such as a request that times out: its token stops halfway, red and faded. Both are failures: a timeout is `lost` on the call that gets no answer and `failed` on the error it hands back, such as a 504 to the caller. A legend in `diagram.html` matches the tokens with `var(--wb-accent)` for a request, outlined in it for a reply, and `var(--wb-removed)` for a failed or lost one.
- A frame needs no moves: a step can be only a caption, a change in the markup, or a chart's new data. On such a step the stage lights nothing; set `node.dataset.state = "active"` in `wb.onFrame` for what the step is about, since listeners run after the stage lights a step.
- Moves name nodes by their `id` and ride the wire between them; a move against the wire's direction is drawn as a reply. Every move needs a wire: the findings name one without.
- The stage lights the nodes and wires the step's own moves touch, keeps the rest of the request's path plain, and dims everything it never touches. Call `wb.moves.manual()` to draw states and tokens yourself with `wb.onFrame`, `wb.token` and `wb.travel`.
- A frame's `code` lists the code that step walks through: the reader's code view follows the steps.
- For paths a reader can pick, such as a cache hit and a miss, or the old path and the new one, add `scenarios.json`: `[{ "key", "label", "frames": [frame keys in order] }]`. The whiteboard draws the picker.
- The reader sees each frame's `label` on the step bar under the diagram, and its `caption` under that. Give every frame a caption that says what happens, in a sentence. The `title` shows only on a narrow screen or for a frame without a caption, and names the frame in a render's result.
- Give every frame a `label` (a word or two in capitals) or none. The bar shares the column between the steps: about 60 characters in all, so 8 steps take about 7 each, and the first and last half that, since they sit at the ends. The findings name a label cut off.
- A frame's `title`, `label` and `caption`, and the block's `title` and `description`, are plain text: backticks and other Markdown show as typed.
- A frame's `data` is yours: any JSON the script reads as `frame.data` in `wb.onFrame`. Use it for a value that changes every step; see The page. A frame several scenarios share has one `data`: give it separate frames when its state differs between them.

A played diagram (a timeline the reader plays, pauses and scrubs) takes `timeline: { chapters: [{ key, title, duration }] }` in `block.json` instead of frames. Draw each moment from `wb.onTime((time, moment) => ...)`: time can jump either way.

## The page

`diagram.html` is the diagram's page, laid out as any web page is. Put `<div data-wb-drawing></div>` where the drawing goes: everything `wb` draws, nodes, groups, wires and charts, goes inside it, and it takes the drawing's size, as an image does. Without `diagram.html`, the page is that element alone. A script that draws with `wb` while `diagram.html` has no `data-wb-drawing` stops with an error saying so.

Draw with the `wb` components first: they lay out, link to code and check themselves. Write markup for what they cannot draw, such as a panel of state beside the drawing, a table, or a log. It goes in the stage before `diagram.js` runs, so a script can find what it holds with `document.querySelector` and change it from `wb.onFrame`. Scripts in `diagram.html` do not run; put them in `diagram.js`. A diagram with only `diagram.html` needs no script at all.

```html
<style>
  .page {
    display: flex;
    gap: 24px;
    align-items: flex-start;
  }
  ul {
    width: 180px;
    margin: 0;
    font-size: 15px;
    line-height: 24px;
  }
</style>
<div class="page">
  <div data-wb-drawing></div>
  <ul>
    <li>Read the cache</li>
    <li data-wb-from="miss">Miss: ask the database</li>
    <li data-wb-from="miss" data-wb-until="fill">Waiting on the database</li>
    <li data-wb-only="fill">Fill the cache</li>
    <li data-wb-from="reply">Answer the app</li>
  </ul>
</div>
```

- Place the drawing with flow, flex and grid, like any element. A block under it is as wide as the page, so a panel under the drawing matches its width with no width of its own. Keep the page inside the board's column: findings say when it is wider, and by how much.
- The styles in `diagram.html` reach the page and the `data-wb-drawing` element itself, never what `wb` draws inside it, so a bare `ul` or `div` rule is safe. Style the page itself with `:scope`; `body`, `html` and `:root` reach nothing.
- `data-wb-from="key"` shows an element from that frame on, and `data-wb-until="key"` up to and including that frame, so the two together show it over a range. Both follow the order of the scenario showing: a scenario that skips the from frame never shows it, and one that skips the until frame never hides it.
- `data-wb-only="key other"` shows an element on the frames it lists alone.
- An element with several shows only where all of them hold. A hidden element gives up its room, so what follows closes up and the stage resizes to fit. Findings name a key no frame has, and a range whose until frame comes before its from frame.
- For a value that changes every step, such as a counter or what a cache holds, put it in each frame's `data` and write it into the markup from `wb.onFrame`. The `request-with-state` reference does this.
- Colour with the `--wb-*` variables so the markup follows the board's theme, and link what stands for code with `wb.code(element, names)` from a script.

## Charts

`wb.chart({ label, plot })` draws with Observable Plot. Left without `x`, `y` and `width`, a chart takes the board's column under whatever was drawn before it, so charts stack; give `height` for anything but 240px. Two charts with a summary under them fit the 600px stage at about 200px each, or 230px for a chart with a legend row. `plot` returns ordinary Plot options; the stage fills in the palette, the series colours in fixed order, and the fonts, and calls `plot` again on every theme, scenario and frame change, so a step can stress what it is about. Between steps each mark eases from where it was: bars resize, lines reshape, colours blend, and marks that appear or go fade. Keep the data marks the same, in the same order, across steps so they move rather than fade; annotations a step adds, such as a rule and its note, fade in and out, as `latency-chart`'s do. One axis per chart. Give `plot` a `title` the reader sees: the chart's `label` only names it. Each chart starts the series colours from the first, so a chart of one series takes the first colour. Label the series directly or give a legend. Give the chart `code` naming the query or code that produces its data.

## 3D scenes

For something physical or spatial that a flat drawing loses, `const THREE = await wb.three()` gives you three.js: the stage has no network, so never `import` it. Build the scene once, size the renderer to `stage.width` and `stage.height` in `block.json`, and draw it as a played diagram, posing everything as a function of time in `wb.onTime`. Prefer nodes and wires whenever the point is structure.

## Link the code

Name every range the diagram stands for in `block.json`'s `code`:

```json
"code": {
  "api-routes": { "source": "head/services/api/routes.go#L12-L30", "label": "API routes" },
  "insert-order": { "source": "head/services/api/orders.go#L48", "label": "Insert the order" }
}
```

- `source` is `<side>/<path>#L<first>-L<last>`, or `#L<line>` for one line. The side is `head` or `base`, and the path is relative to the repository root.
- Draw the code at the board's commits, even where your checkout is newer, and say so in the description when it matters.
- Line numbers are those at the board's head commit, which can differ from your checkout. `session_get` names it in its header (`Base … · head …`); read a file there with `git show <head>:<path>`.
- A publish answers with `quotes`, the first and last line of each range it accepted, for you to check they are the lines you meant; it quotes the first ones and counts the rest in `unquotedAnchors`. An update whose ranges did not change quotes none.
- A node names where it is defined; a wire names its call site, the line where one side calls the other. A person, an external system and a wire to either claim nothing unless you give them `code`. Give anything else that is not code, such as a repository, a disk or a third-party service drawn as a database, `code: false`.
- A `code` entry's `label` says what the range is, in 48 characters at most.
- A node or wire with code opens it beside the board when clicked, or with Enter. Once the diagram has code, the reader gets Tour, which walks the steps alongside their code. Mark anything else you draw with `wb.code(element, names, label)`.
- Leave nothing unlinked that is code: `claims.unlinked` in a render counts what names none. It is a count, not a finding, and a diagram with no `code` at all counts nothing as unlinked.
- A diagram of something that is not in the board's repository, such as a design or another team's system, takes no `code`.
