// A diagram runs its script against `wb` in the same sandboxed stage as an
// animation. The stage is opaque to the test, so these read what the host
// draws from what the stage reports: the stage's size, the error line, the
// step strip, and the claims it counted, as the host reports them to the
// server for the agent.

import {
  fixtureHost,
  loadFixture,
  mountWhiteboard,
  settled,
} from "@canvas/whiteboard-fixture";
import type { JsonObject } from "@dev.fast/json";
import {
  type Block,
  documentSchema,
  selectionKey,
} from "@dev.fast/whiteboard-document";
import type { ReviewProgress } from "@review/review-api/review-progress";
import type { Snapshot } from "@review/review-api/store";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import "@canvas/styles.css";

const pins = { repositoryId: "repo", base: "base", head: "head" };

const DRAWING = `
const app = wb.node({ id: "app", kind: "container", label: "App" });
const orders = wb.node({ id: "orders", kind: "container", label: "Orders", code: "status" });
const store = wb.node({ id: "store", kind: "database", label: "Store" });
wb.edge({ from: app, to: orders, label: "HTTPS" });
wb.edge({ from: orders, to: store, code: "status" });
await wb.layout();
`;

/** A diagram of DRAWING with `fields` set; `script: null` leaves it out. */
const diagram = (fields: JsonObject = {}): Block =>
  documentSchema.parse([
    Object.fromEntries(
      Object.entries({
        id: "diagram-1",
        type: "diagram",
        title: "Orders",
        script: DRAWING,
        code: {
          status: {
            source: "head/order.ts#L1",
            label: "Status line",
          },
        },
        pins,
        ...fields,
      }).filter(([, value]) => value !== null),
    ),
  ])[0]!;

const progress: ReviewProgress = {
  files: [],
  lenses: [],
  resolvedSelections: {
    [selectionKey({
      file: "order.ts",
      start: { side: "head", line: 1 },
      end: { side: "head", line: 1 },
    })]: [{ file: "order.ts", side: "head", fromLine: 1, toLine: 1 }],
  },
};

let canvas: ReturnType<typeof mountWhiteboard> | undefined;

// What the host told the server of each run, newest last.
let reports: {
  claims?: { matches: number; changed: number; unlinked: number };
}[] = [];

afterEach(async () => {
  await act(async () => canvas?.dispose());
  canvas = undefined;
  reports = [];
  document.body.replaceChildren();
});

async function mount(block: Block, staleSources?: string[]) {
  const snapshot: Snapshot = {
    reviewId: "diagram-review",
    version: 0,
    title: "Diagrams",
    pins,
    target: { kind: "commits", ...pins },
    document: [block],
    createdAt: "2026-11-01T00:00:00.000Z",
    ...(staleSources && { staleSources }),
  };

  const container = document.createElement("div");
  container.style.cssText = "width: 860px; margin: 0 auto;";
  document.body.append(container);

  await act(async () => {
    canvas = mountWhiteboard(
      container,
      loadFixture({
        snapshot,
        progress,
        commits: [],
        images: {},
        traces: {},
        maps: {},
      }),
      {
        host: fixtureHost({
          request: async (path, init) => {
            if (path.includes("/animation-run"))
              reports.push(JSON.parse(String(init?.body)));

            return Response.json({ ok: true });
          },
        }),
      },
    );
  });

  return container;
}

/** The claims the host last reported, as "matches/changed/unlinked". */
const claims = () => {
  const last = reports.findLast((report) => report.claims)?.claims;

  return last ? `${last.matches}/${last.changed}/${last.unlinked}` : "";
};

const figure = () => document.querySelector<HTMLElement>(".animation-block");

// A stage holds 120px until its script reports the drawing's size; these
// drawings are shorter, so a smaller stage has run.
const drawn = () => stageHeight() > 72 && stageHeight() < 120;

const stageHeight = () =>
  document.querySelector<HTMLIFrameElement>(".animation-block iframe")
    ?.parentElement?.parentElement?.offsetHeight ?? 0;

const alertText = () =>
  document.querySelector(".animation-block [role='alert']")?.textContent ??
  null;

const button = (name: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(".animation-block button"),
  ].find(
    (item) =>
      item.textContent === name || item.getAttribute("aria-label") === name,
  );

// The name of the frame showing, under the player's track.
const current = () =>
  document.querySelector(".animation-block [aria-current='step']")?.textContent;

describe("diagram", () => {
  it("lays out its script's drawing and sizes the stage to it", async () => {
    await mount(diagram());

    expect(await settled(drawn, 8000)).toBe(true);
    expect(figure()?.querySelector("figcaption")?.textContent).toContain(
      "DIAGRAM",
    );
    // A still diagram has no player under it.
    expect(document.querySelector("[role='slider']")).toBeNull();
    expect(button("Replay step")).toBeUndefined();
    expect(alertText()).toBeNull();
  });

  it("counts its claims against the code for the agent", async () => {
    await mount(diagram());
    expect(await settled(drawn, 8000)).toBe(true);

    // Orders and its wire to Store back onto the status line; App, Store
    // and the App wire name no code.
    expect(await settled(() => claims() === "2/0/3", 4000)).toBe(true);
  });

  it("leaves out of its claims what the script says is not code", async () => {
    await mount(
      diagram({
        script: DRAWING.replace(
          'label: "Store" }',
          'label: "Store", code: false }',
        ).replace('label: "HTTPS" }', 'label: "HTTPS", code: false }'),
      }),
    );
    expect(await settled(drawn, 8000)).toBe(true);

    // Only App is left unlinked.
    expect(await settled(() => claims() === "2/0/1", 4000)).toBe(true);
  });

  it("counts a claim changed when the board marked its code stale", async () => {
    // The server marks a range stale when its lines are gone. The diagram
    // still draws.
    await mount(diagram(), ["diagram-1:code:status"]);
    expect(await settled(drawn, 8000)).toBe(true);
    expect(await settled(() => claims() === "0/2/3", 4000)).toBe(true);
  });

  it("fits a chart's title into its box, whatever height the plot asks for", async () => {
    const chart = (height: string) => `
      wb.chart({
        label: "Bars",
        x: 0, y: 0, width: 400, height: 160,
        plot: ({ Plot }) => ({
          title: "A title above the plot",
          ${height}
          marks: [Plot.barX([1, 2, 3])],
        }),
      });
    `;

    const findings = () =>
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "";

    const ran = () =>
      document
        .querySelector(".animation-block")
        ?.hasAttribute("data-stage-ran") === true;

    await mount(
      diagram({ script: chart(""), stage: { width: 400, height: 160 } }),
    );
    expect(await settled(ran, 8000)).toBe(true);
    // Plot loads after the script ends; give the chart a moment to draw.
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(findings()).toBe("");

    await act(async () => canvas?.dispose());
    document.body.replaceChildren();

    // A height the plot asks for is the box's to set: the chart still fits.
    await mount(
      diagram({
        script: chart("height: 400,"),
        stage: { width: 400, height: 160 },
      }),
    );
    expect(await settled(ran, 8000)).toBe(true);
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(findings()).toBe("");
  });

  it("moves a group's name clear of the wires that enter it", async () => {
    // Two wires drop into a narrow group from above, one under each end of
    // its header: the name has to go to the group's bottom.
    await mount(
      diagram({
        script: `
          const a = wb.node({ id: "a", kind: "container", label: "A" });
          const b = wb.node({ id: "b", kind: "container", label: "B" });
          const c = wb.node({ id: "c", kind: "container", label: "C" });
          const d = wb.node({ id: "d", kind: "container", label: "D" });
          wb.edge({ from: a, to: b });
          wb.edge({ from: a, to: c });
          wb.edge({ from: b, to: c });
          wb.edge({ from: c, to: d });
          wb.group({ label: "A long group name", around: [c, d] });
          await wb.layout({ direction: "down" });
        `,
        code: {},
      }),
    );

    expect(
      await settled(
        () =>
          document
            .querySelector(".animation-block")
            ?.hasAttribute("data-stage-ran") === true,
        8000,
      ),
    ).toBe(true);
    expect(
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "",
    ).toBe("");
  });

  it("stacks a group down inside a drawing that runs across", async () => {
    // Three nodes in a row are one node tall; stacked, they are three. They
    // are narrow, so the row fits the column.
    const script = (direction: string) => `
      const a = wb.node({ id: "a", kind: "container", label: "A", width: 96 });
      const b = wb.node({ id: "b", kind: "container", label: "B", width: 96 });
      const c = wb.node({ id: "c", kind: "container", label: "C", width: 96 });
      const d = wb.node({ id: "d", kind: "container", label: "D", width: 96 });
      wb.edge({ from: a, to: b, label: "in" });
      wb.edge({ from: a, to: c });
      wb.edge({ from: b, to: c });
      wb.edge({ from: c, to: d });
      wb.group({ label: "Inside", around: [b, c, d]${direction} });
      await wb.layout({ direction: "right" });
    `;

    const ran = () =>
      document
        .querySelector(".animation-block")
        ?.hasAttribute("data-stage-ran") === true;

    await mount(diagram({ script: script(""), code: {} }));
    expect(await settled(ran, 8000)).toBe(true);
    const across = stageHeight();

    await act(async () => canvas?.dispose());
    document.body.replaceChildren();

    await mount(diagram({ script: script(', direction: "down"'), code: {} }));
    expect(await settled(ran, 8000)).toBe(true);
    expect(stageHeight()).toBeGreaterThan(across * 2);
    expect(
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "",
    ).toBe("");
  });

  it("keeps a manual layout where the script put it, and names a node it never placed", async () => {
    const script = (third: string) => `
      const a = wb.node({ id: "a", kind: "container", label: "A", x: 0, y: 0, width: 120, height: 48 });
      const b = wb.node({ id: "b", kind: "container", label: "B", x: 200, y: 0, width: 120, height: 48 });
      const c = wb.node({ id: "c", kind: "container", label: "C", ${third} width: 120, height: 48 });
      wb.edge({ from: a, to: b });
      wb.edge({ from: a, to: c });
      await wb.layout({ mode: "manual" });
    `;

    const ran = () =>
      document
        .querySelector(".animation-block")
        ?.hasAttribute("data-stage-ran") === true;

    const findings = () =>
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "";

    // Two rows: the stage takes the drawing's height, 48 + 80 + 48.
    await mount(diagram({ script: script("x: 0, y: 128,"), code: {} }));
    expect(await settled(ran, 8000)).toBe(true);
    expect(findings()).toBe("");
    expect(stageHeight()).toBeGreaterThan(176);

    await act(async () => canvas?.dispose());
    document.body.replaceChildren();

    await mount(diagram({ script: script(""), code: {} }));
    expect(await settled(ran, 8000)).toBe(true);
    expect(findings()).toContain('Node "C" has no x and y');
  });

  it("draws diagram.html without a script, sized to the markup, and names a frame key it lacks or a range that ends first", async () => {
    const ran = () =>
      document
        .querySelector(".animation-block")
        ?.hasAttribute("data-stage-ran") === true;

    const findings = () =>
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "";

    const markup = (key: string, start = "one") => `
      <style>p { margin: 0; height: 40px; }</style>
      <p>One</p>
      <p data-wb-from="${key}">Two</p>
      <p data-wb-only="${key}">Three</p>
      <p data-wb-from="${start}" data-wb-until="${key}">Four</p>
    `;

    const frames = [
      { key: "one", title: "One" },
      { key: "two", title: "Two" },
    ];

    // Rows of 40px: two on the first frame, four on the second, as hidden
    // rows give up their room.
    await mount(
      diagram({ html: markup("two"), script: null, frames, code: {} }),
    );
    expect(await settled(ran, 8000)).toBe(true);
    expect(findings()).toBe("");
    expect(alertText()).toBeNull();
    const first = stageHeight();
    expect(first).toBeGreaterThanOrEqual(80);
    await act(async () => button("Two")!.click());
    expect(await settled(() => current() === "Two")).toBe(true);
    expect(await settled(() => stageHeight() >= first + 80, 4000)).toBe(true);
    expect(findings()).toBe("");

    await act(async () => canvas?.dispose());
    document.body.replaceChildren();

    await mount(
      diagram({ html: markup("three"), script: null, frames, code: {} }),
    );
    expect(await settled(ran, 8000)).toBe(true);
    expect(findings()).toContain('data-wb-from="three"');
    expect(findings()).toContain('data-wb-only="three"');
    expect(findings()).toContain('data-wb-until="three"');

    await act(async () => canvas?.dispose());
    document.body.replaceChildren();

    await mount(
      diagram({ html: markup("one", "two"), script: null, frames, code: {} }),
    );
    expect(await settled(ran, 8000)).toBe(true);
    expect(findings()).toContain(
      "shows from two until one, but one comes first",
    );
  });

  it("draws where diagram.html puts data-wb-drawing, and grows a stage given a size to hold the page", async () => {
    const ran = () =>
      document
        .querySelector(".animation-block")
        ?.hasAttribute("data-stage-ran") === true;

    // A log of 40px rows; its first row alone is as tall as the drawing.
    const log = `
      <style>p { margin: 0; height: 40px; width: 120px; }</style>
      <p>Log</p>
      <p data-wb-only="two">More</p>
      <p data-wb-only="two">And more</p>
    `;

    const frames = [
      { key: "one", title: "One" },
      { key: "two", title: "Two" },
    ];

    // Under the drawing, the stage takes both; the log's rows on the second
    // frame grow it, and going back shrinks it again. A stage block.json
    // sizes smaller than that still holds everything.
    await mount(
      diagram({
        html: `<div data-wb-drawing></div>${log}`,
        frames,
        stage: { width: 120, height: 120 },
      }),
    );
    expect(await settled(ran, 8000)).toBe(true);
    expect(await settled(() => stageHeight() > 160, 8000)).toBe(true);
    const under = stageHeight();
    await act(async () => button("Two")!.click());
    expect(await settled(() => stageHeight() >= under + 80, 4000)).toBe(true);
    await act(async () => button("One")!.click());
    expect(await settled(() => stageHeight() === under, 4000)).toBe(true);
    expect(alertText()).toBeNull();

    await act(async () => canvas?.dispose());
    document.body.replaceChildren();

    // In a row beside a drawing narrow enough for both to fit, the two
    // share its height.
    await mount(
      diagram({
        html: `
          <style>.row { display: flex; gap: 24px; align-items: flex-start; }</style>
          <div class="row"><div data-wb-drawing></div><div>${log}</div></div>
        `,
        frames,
        script: `
          const a = wb.node({ id: "a", kind: "container", label: "A" });
          const b = wb.node({ id: "b", kind: "container", label: "B" });
          wb.edge({ from: a, to: b });
          await wb.layout();
        `,
        code: {},
      }),
    );
    expect(await settled(ran, 8000)).toBe(true);
    expect(
      await settled(
        () => stageHeight() > 72 && stageHeight() < under - 30,
        8000,
      ),
    ).toBe(true);
    expect(alertText()).toBeNull();
  });

  it("keeps diagram.html's styles off what wb draws, and says when a script draws with nowhere to go", async () => {
    const ran = () =>
      document
        .querySelector(".animation-block")
        ?.hasAttribute("data-stage-ran") === true;

    const findings = () =>
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "";

    const heightWith = async (html: string) => {
      await mount(diagram({ html }));
      expect(await settled(ran, 8000)).toBe(true);
      await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
      const height = stageHeight();
      await act(async () => canvas?.dispose());
      document.body.replaceChildren();

      return height;
    };

    // A rule that would pad every node leaves the drawing's size alone.
    const plain = await heightWith("<div data-wb-drawing></div>");

    expect(
      await heightWith(
        "<style>[data-wb-drawing] div { padding: 40px; }</style><div data-wb-drawing></div>",
      ),
    ).toBe(plain);

    // A rule naming the document reaches nothing, and findings say so.
    await mount(
      diagram({
        html: "<style>body { color: red; }</style><div data-wb-drawing></div>",
      }),
    );
    expect(await settled(ran, 8000)).toBe(true);
    expect(await settled(() => findings().includes('"body"'), 4000)).toBe(true);

    await act(async () => canvas?.dispose());
    document.body.replaceChildren();

    // Markup with no place for the drawing stops the script that draws.
    await mount(diagram({ html: "<p>Notes</p>" }));
    expect(
      await settled(
        () => alertText()?.includes("data-wb-drawing") === true,
        8000,
      ),
    ).toBe(true);
  });

  it("moves a group's name clear of a wire in a drawing placed by hand", async () => {
    // The wire from A drops onto B's middle, through the group's long name,
    // which moves to the far end of its header.
    await mount(
      diagram({
        script: `
          const a = wb.node({ id: "a", kind: "container", label: "A", x: 0, y: 0, width: 120, height: 48 });
          const b = wb.node({ id: "b", kind: "container", label: "B", x: 0, y: 160, width: 120, height: 48 });
          const c = wb.node({ id: "c", kind: "container", label: "C", x: 240, y: 160, width: 120, height: 48 });
          wb.edge({ from: a, to: b });
          wb.group({ label: "A group with a long name", around: [b, c] });
          await wb.layout({ mode: "manual" });
        `,
        code: {},
      }),
    );

    expect(
      await settled(
        () =>
          document
            .querySelector(".animation-block")
            ?.hasAttribute("data-stage-ran") === true,
        8000,
      ),
    ).toBe(true);
    expect(
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "",
    ).toBe("");
  });

  it("brings a drawing placed above the stage's corner into it, and keeps the labels of two wires between the same nodes apart", async () => {
    const ran = () =>
      document
        .querySelector(".animation-block")
        ?.hasAttribute("data-stage-ran") === true;

    const findings = () =>
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "";

    // The group's name sits above its nodes at y 0, so it starts above the
    // stage; the queue and the worker trade jobs both ways.
    await mount(
      diagram({
        script: `
          const queue = wb.node({ id: "queue", kind: "queue", label: "Queue", x: 0, y: 0, width: 120, height: 48 });
          const worker = wb.node({ id: "worker", kind: "container", label: "Worker", x: 260, y: 0, width: 120, height: 48 });
          wb.edge({ from: queue, to: worker, label: "take" });
          wb.edge({ from: worker, to: queue, label: "retry" });
          wb.group({ label: "Jobs", around: [queue, worker] });
          await wb.layout({ mode: "manual" });
        `,
        code: {},
      }),
    );
    expect(await settled(ran, 8000)).toBe(true);
    expect(findings()).toBe("");
    // The node, the group's padding under it, and its name above all show.
    expect(stageHeight()).toBeGreaterThan(48 + 20 + 41);
  });

  it("keeps apart the elbows and labels of a hand-placed fan-out with replies", async () => {
    // A gateway calls three services stacked to its right, and each replies.
    await mount(
      diagram({
        script: `
          const gateway = wb.node({ id: "gateway", kind: "container", label: "Gateway", x: 0, y: 140, width: 140, height: 56 });
          for (const [index, name] of ["Orders", "Stock", "Billing"].entries()) {
            const service = wb.node({ id: name, kind: "container", label: name, x: 420, y: index * 140, width: 140, height: 56 });
            wb.edge({ from: gateway, to: service, label: "POST" });
            wb.edge({ from: service, to: gateway, label: "ok" });
          }
          await wb.layout({ mode: "manual" });
        `,
        code: {},
      }),
    );

    expect(
      await settled(
        () => figure()?.hasAttribute("data-stage-ran") === true,
        8000,
      ),
    ).toBe(true);
    expect(figure()?.dataset.findings ?? "").toBe("");
  });

  it("widens a node to show its name, and names a chart Plot warns about", async () => {
    await mount(
      diagram({
        script: `
          // The long name widens a about its middle, into b beside it.
          wb.node({ id: "a", kind: "container", label: "readAnimationFolderFromDisk", x: 0, y: 0, width: 96, height: 48 });
          wb.node({ id: "b", kind: "container", label: "B", x: 120, y: 0, width: 96, height: 48 });
          wb.chart({
            label: "Latency",
            x: 0, y: 80, width: 300, height: 120,
            // Dates given as strings: Plot warns.
            plot: ({ Plot }) => ({ marks: [Plot.dot([{ x: "2026-01-01", y: 1 }, { x: "2026-01-02", y: 2 }], { x: "x", y: "y" })] }),
          });
          await wb.layout({ mode: "manual" });
        `,
        code: {},
      }),
    );

    const findings = () =>
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "";

    expect(
      await settled(
        () =>
          findings().includes("readAnimationFolderFromDisk overlaps B") &&
          !findings().includes("is cut off") &&
          findings().includes('Chart "Latency" warns'),
        8000,
      ),
    ).toBe(true);
  });

  it("names text that runs into other text inside a chart", async () => {
    await mount(
      diagram({
        script: `
          wb.chart({
            label: "Deploys",
            plot: ({ Plot }) => ({
              x: { domain: [0, 30] },
              marks: [Plot.text([{ x: 10, label: "Rolled back" }, { x: 11, label: "Hotfix shipped" }], { x: "x", y: 0, text: "label" })],
            }),
          });
        `,
        code: {},
      }),
    );

    expect(
      await settled(
        () =>
          (figure()?.dataset.findings ?? "").includes(
            'Chart "Deploys": “Rolled back” runs into “Hotfix shipped”',
          ),
        8000,
      ),
    ).toBe(true);
  });

  it("names chart text that sits on a line or runs past the chart's edge", async () => {
    await mount(
      diagram({
        script: `
          wb.chart({
            label: "Load",
            plot: ({ Plot }) => ({
              x: { domain: [0, 10] },
              y: { domain: [0, 100] },
              marks: [
                Plot.lineY([{ x: 0, y: 99 }, { x: 10, y: 99 }], { x: "x", y: "y" }),
                Plot.text([5], { x: (d) => d, frameAnchor: "top", text: () => "deploy" }),
                Plot.text([10], { x: (d) => d, frameAnchor: "bottom", textAnchor: "start", dx: 40, text: () => "a note far too long to fit" }),
              ],
            }),
          });
        `,
        code: {},
      }),
    );

    const findings = () => figure()?.dataset.findings ?? "";

    expect(
      await settled(
        () =>
          findings().includes('Chart "Load": “deploy” sits on the data') &&
          findings().includes(
            'Chart "Load": “a note far too long to fit” runs',
          ),
        8000,
      ),
    ).toBe(true);
  });

  it("stacks charts given no position at the column's width", async () => {
    const chart = (label: string) => `
      wb.chart({
        label: "${label}",
        height: 160,
        plot: ({ Plot }) => ({ marks: [Plot.barY([1, 2, 3])] }),
      });
    `;

    await mount(diagram({ script: chart("One") + chart("Two"), code: {} }));

    // Two charts of 160px, one under the other.
    expect(await settled(() => stageHeight() > 2 * 160 + 24, 8000)).toBe(true);
    expect(
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "",
    ).toBe("");
  });

  it("rides the wire a move names, names one that is not there with those that are, and widens a group to show its name", async () => {
    await mount(
      diagram({
        script: `
          const queue = wb.node({ id: "queue", kind: "queue", label: "Queue", x: 0, y: 0, width: 120, height: 48 });
          const worker = wb.node({ id: "worker", kind: "container", label: "Worker", x: 260, y: 0, width: 120, height: 48 });
          wb.edge({ id: "take", from: queue, to: worker, label: "take" });
          wb.edge({ id: "retry", from: worker, to: queue, label: "retry" });
          wb.group({ label: "A group whose name is far too long", tag: "and a long tag too", around: [queue] });
          await wb.layout({ mode: "manual" });
        `,
        frames: [
          {
            key: "take",
            title: "Take",
            label: "TAKE",
            moves: [{ from: "queue", to: "worker", edge: "take" }],
          },
          {
            key: "retry",
            title: "Retry",
            label: "RETRY",
            moves: [{ from: "worker", to: "queue", edge: "missing" }],
          },
        ],
        code: {},
      }),
    );

    const findings = () =>
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "";

    expect(
      await settled(
        () =>
          findings().includes(
            'along "missing", but no wire with that id joins them; the wires that do are "take", "retry"',
          ),
        8000,
      ),
    ).toBe(true);
    expect(findings()).not.toContain("moves queue → worker");
    expect(findings()).not.toContain("cut off");
  });

  it("names what reaches furthest when a drawing is wider than the board's column", async () => {
    await mount(
      diagram({
        script: `
          wb.node({ id: "a", kind: "container", label: "Near", x: 0, y: 0, width: 120, height: 48 });
          wb.node({ id: "b", kind: "container", label: "Far", x: 900, y: 0, width: 120, height: 48 });
          await wb.layout({ mode: "manual" });
        `,
        code: {},
      }),
    );

    const findings = () =>
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "";

    expect(
      await settled(
        () => findings().includes("Far reaches furthest, to x = 1020"),
        8000,
      ),
    ).toBe(true);
  });

  it("cuts a token's label to fit a short wire, and names it, and draws a failed move", async () => {
    // 48px between the nodes: room for a short token, not for this label.
    await mount(
      diagram({
        script: `
          const a = wb.node({ id: "a", kind: "container", label: "A", x: 0, y: 0, width: 120, height: 48 });
          const b = wb.node({ id: "b", kind: "container", label: "B", x: 168, y: 0, width: 120, height: 48 });
          wb.edge({ from: a, to: b });
          await wb.layout({ mode: "manual" });
        `,
        frames: [
          {
            key: "send",
            title: "Send",
            moves: [
              { from: "a", to: "b", label: "POST /charges", failed: true },
            ],
          },
        ],
        code: {},
      }),
    );

    const findings = () =>
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "";

    expect(
      await settled(
        () =>
          findings().includes(
            "The token “POST /charges” on step send is cut off",
          ),
        8000,
      ),
    ).toBe(true);
    expect(findings()).not.toContain("rests against");
  });

  it("widens a node given no width to its name, and says to place by hand a drawing too wide either way", async () => {
    const findings = () =>
      document.querySelector<HTMLElement>(".animation-block")?.dataset
        .findings ?? "";

    const ran = () =>
      document
        .querySelector(".animation-block")
        ?.hasAttribute("data-stage-ran") === true;

    await mount(
      diagram({
        script: `
          wb.node({ id: "a", kind: "component", label: "resolveDraftEditFromTheFolder", x: 0, y: 0 });
          await wb.layout({ mode: "manual" });
        `,
        code: {},
      }),
    );
    expect(await settled(ran, 8000)).toBe(true);
    expect(findings()).toBe("");

    await act(async () => canvas?.dispose());
    document.body.replaceChildren();

    // Two nodes each wider than the column fit neither across nor down.
    await mount(
      diagram({
        script: `
          const a = wb.node({ id: "a", kind: "container", label: "A", width: 800 });
          const b = wb.node({ id: "b", kind: "container", label: "B", width: 800 });
          wb.edge({ from: a, to: b });
          await wb.layout({ direction: "right" });
        `,
        code: {},
      }),
    );
    expect(
      await settled(() => findings().includes("place it by hand"), 8000),
    ).toBe(true);
  });

  it("runs an edit of a diagram with steps in a new stage", async () => {
    const frames = [
      {
        key: "sent",
        title: "Order sent",
        moves: [{ from: "app", to: "orders" }],
      },
      {
        key: "stored",
        title: "Order stored",
        moves: [{ from: "orders", to: "store" }],
      },
    ];

    // Laid out downward, the three nodes stack; across, they sit in a row.
    const container = await mount(
      diagram({
        frames,
        script: DRAWING.replace(
          "wb.layout()",
          'wb.layout({ direction: "down" })',
        ),
      }),
    );

    expect(await settled(() => stageHeight() > 300, 8000)).toBe(true);

    // The agent turns it across: the stage runs the new script.
    const edited = diagram({ frames });
    await act(async () =>
      canvas?.update(
        loadFixture({
          snapshot: {
            reviewId: "diagram-review",
            version: 1,
            title: "Diagrams",
            pins,
            target: { kind: "commits", ...pins },
            document: [edited],
            createdAt: "2026-11-01T00:00:00.000Z",
          },
          progress,
          commits: [],
          images: {},
          traces: {},
          maps: {},
        }),
      ),
    );

    expect(await settled(() => stageHeight() < 300, 8000)).toBe(true);
    expect(container.textContent).toContain("Order sent");
  });

  it("shows what its script threw", async () => {
    await mount(diagram({ script: 'throw new Error("no orders");' }));

    expect(
      await settled(() => alertText()?.includes("no orders") === true, 8000),
    ).toBe(true);
  });

  it("shows a syntax error in its script", async () => {
    await mount(diagram({ script: "wb.node({ kind: " }));

    expect(
      await settled(() => alertText()?.includes("SyntaxError") === true, 8000),
    ).toBe(true);
  });

  it("steps through frames whose moves ride the wires", async () => {
    await mount(
      diagram({
        frames: [
          {
            key: "sent",
            title: "Order sent",
            label: "SENT",
            moves: [{ from: "app", to: "orders", label: "POST" }],
          },
          {
            key: "stored",
            title: "Order stored",
            label: "STORED",
            moves: [{ from: "orders", to: "store" }],
          },
        ],
      }),
    );

    expect(await settled(() => current() === "SENT", 8000)).toBe(true);
    await act(async () => button("STORED")!.click());
    expect(await settled(() => current() === "STORED")).toBe(true);

    // Reached by hand, the last stop is the end: the line runs full.
    const stretches = () => [
      ...document.querySelector("[role='slider'][aria-label='Frame']")!
        .firstElementChild!.children,
    ];

    expect(stretches().map((stretch) => stretch.childElementCount)).toEqual([
      1,
    ]);
    expect(button("Replay")).toBeDefined();

    // The arrows on the track step between frames.
    const press = (key: string) =>
      act(async () => {
        document
          .querySelector("[role='slider'][aria-label='Frame']")!
          .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });

    await press("ArrowLeft");
    expect(await settled(() => current() === "SENT")).toBe(true);
    await press("ArrowRight");
    expect(await settled(() => current() === "STORED")).toBe(true);

    // The moves play once; the reader asks to see them again.
    await act(async () => button("Replay step")!.click());
    expect(current()).toBe("STORED");
    expect(alertText()).toBeNull();
  });

  it("lets wb.onFrame light a node on a step with no moves", async () => {
    await mount(
      diagram({
        script: `${DRAWING}
          wb.onFrame((frame) => {
            if (frame?.key !== "quiet") return;
            store.dataset.state = "active";
            setTimeout(() => {
              if (store.dataset.state !== "active")
                throw new Error("The stage reset the state onFrame set.");
            }, 300);
          });
        `,
        frames: [
          {
            key: "sent",
            title: "Order sent",
            label: "SENT",
            moves: [{ from: "app", to: "orders" }],
          },
          { key: "quiet", title: "The store holds it", label: "QUIET" },
        ],
      }),
    );

    expect(await settled(() => current() === "SENT", 8000)).toBe(true);
    await act(async () => button("QUIET")!.click());
    expect(await settled(() => current() === "QUIET")).toBe(true);
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(alertText()).toBeNull();
  });

  it("plays a timeline through its chapters", async () => {
    await mount(
      diagram({
        timeline: {
          chapters: [
            { key: "ask", title: "Ask", duration: 400 },
            { key: "answer", title: "Answer", duration: 400 },
          ],
        },
      }),
    );

    const play = () => button("Play") ?? button("Pause") ?? button("Replay");

    // The stage reports its size once its script has run.
    expect(await settled(drawn, 8000)).toBe(true);
    await act(async () => play()!.click());
    expect(await settled(() => button("Replay") !== undefined, 4000)).toBe(
      true,
    );
    expect(alertText()).toBeNull();
  });

  it("moves a timeline's playhead from its track", async () => {
    await mount(
      diagram({
        timeline: {
          chapters: [
            { key: "ask", title: "Ask", duration: 2000 },
            { key: "answer", title: "Answer", duration: 2000 },
          ],
        },
      }),
    );

    expect(await settled(drawn, 8000)).toBe(true);

    const slider = () =>
      document.querySelector<HTMLElement>("[role='slider']")!;

    const current = () =>
      document.querySelector("[aria-current='step']")?.textContent;

    const press = (key: string) =>
      act(async () => {
        slider().dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });

    const valueNow = () => Number(slider().getAttribute("aria-valuenow"));

    // Right snaps to the next frame's start, Left back to the one before.
    await press("ArrowRight");
    expect(await settled(() => current() === "Answer" && valueNow() > 0)).toBe(
      true,
    );
    const answer = valueNow();
    await press("ArrowLeft");
    expect(await settled(() => valueNow() === 0)).toBe(true);
    await press("ArrowRight");
    expect(await settled(() => valueNow() === answer)).toBe(true);

    // The chapter's name jumps back to its start.
    await act(async () => button("Ask")!.click());
    expect(await settled(() => valueNow() === 0)).toBe(true);

    await press("End");
    expect(await settled(() => button("Replay") !== undefined)).toBe(true);
  });
});
