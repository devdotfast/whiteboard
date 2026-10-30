import type { JsonValue } from "@dev.fast/review-protocol";
import {
  assignFreshIds,
  documentSchema,
  elements,
  isUnit,
  selectionKey,
} from "@dev.fast/whiteboard-document";
import {
  FIXTURE_IMAGE_ID,
  FIXTURE_MAP_ID,
  FIXTURE_TRACE_EVENT_ID,
  FIXTURE_TRACE_ID,
} from "@review/fixtures/blocks/ids";
import type { ReviewProgress } from "@review/review-api/review-progress";
import type { Snapshot } from "@review/review-api/store";
import { defineSoftwareMap } from "@review/software-map-model";
import { type ReactNode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STAGE_MAX_HEIGHT, STAGE_MAX_SLOTS } from "./animation/stage-protocol";
import type { SavedMap } from "./api-document";
import {
  BlockErrorBoundary,
  type StoredBlock,
  blockComponents,
} from "./blocks";
import type { WhiteboardHost } from "./whiteboard";
import {
  fixtureHost,
  loadFixture,
  mountWhiteboard as mount,
  settled,
} from "./whiteboard-fixture";

import "./styles.css";

type Kind = keyof typeof blockComponents;

// Vite inlines the fixture files, one array of blocks per kind.
const fixtureFiles = import.meta.glob<{ default: JsonValue }>(
  "../../src/fixtures/blocks/*.json",
  { eager: true },
);

const fixtures = new Map(
  Object.entries(fixtureFiles).map(([file, module]) => [
    file.slice(file.lastIndexOf("/") + 1, -".json".length),
    documentSchema.parse(module.default),
  ]),
);

const trace = {
  label: "Fixture conversation",
  events: [
    {
      id: FIXTURE_TRACE_EVENT_ID,
      role: "assistant",
      text: "Please queue the order once the row is written.",
    },
  ],
};

// A 1x1 PNG.
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

// What the host serves for an uploaded map: the normalized elements and
// relationships as JSON, resolved with empty diff counts.
const model = defineSoftwareMap({
  systems: {
    orders: {
      label: "Order service",
      containers: { api: { label: "Order API", components: { save: {} } } },
    },
  },
});

const savedMap: SavedMap = {
  elements: model.elements,
  relationships: model.relationships,
  side: "head",
  commit: "head",
  countsByElementPath: {},
  unmappedByElementPath: {},
};

// The fixture compares the single status line in order.ts on both sides.
const fixtureProgress: ReviewProgress = {
  files: [],
  lenses: [],
  resolvedSelections: Object.fromEntries(
    (["base", "head"] as const).map((side) => [
      selectionKey({
        file: "order.ts",
        start: { side, line: 1 },
        end: { side, line: 1 },
      }),
      [
        { file: "order.ts", side: "base", fromLine: 1, toLine: 1 },
        { file: "order.ts", side: "head", fromLine: 1, toLine: 1 },
      ],
    ]),
  ),
};

const text = (container: HTMLElement) => container.textContent ?? "";

const has = (container: HTMLElement, selector: string) =>
  container.querySelector(selector) !== null;

/**
 * What each kind must have rendered from its fixture. The NodeReveal wrapper
 * exists for every block, so these look inside it: real content, and for the
 * diagrams a finished layout.
 */
const rendered: Record<
  Exclude<Kind, "call_stack_diff">,
  (container: HTMLElement) => boolean
> = {
  markdown: (c) =>
    c.querySelector("h1")?.textContent === "Order status" &&
    has(c, "a[href*='review-source:']"),
  code: (c) =>
    (c.querySelector("pre")?.textContent ?? "").includes(
      'export const status = "queued";',
    ) && text(c).includes("The new status"),
  divider: (c) => has(c, "hr"),
  // The peek asked the host for an inline editor on the fixture's file.
  code_peek: (c) =>
    has(
      c,
      "[data-code-rendering] .fixture-inline-editor[data-path='order.ts']",
    ),
  // Every step is laid out as a routed message once the diagram settles.
  sequence: (c) =>
    has(c, ".sequence-diagram .react-flow") &&
    has(c, "[data-review-anchor-id='step-1']") &&
    has(c, "[data-review-anchor-id='step-2']") &&
    text(c).includes("set status"),
  database_lens: (c) =>
    has(c, ".database-lens select") &&
    text(c).includes("Queue an order") &&
    text(c).includes("write queued"),
  image: (c) =>
    has(c, "figure img[src^='blob:']") && text(c).includes("An image"),
  trace_quote: (c) =>
    has(c, 'a[href^="#trace-"]') && text(c).includes("queue the order"),
  // The map has drawn its system and is neither refreshing nor failed.
  flow_diagram: (c) =>
    has(c, ".lens-flow-node") &&
    text(c).includes("Queue order") &&
    !text(c).includes("Laying out"),
  software_map: (c) =>
    has(c, ".software-map-canvas") &&
    text(c).includes("Order service") &&
    !has(c, ".software-map-code-status"),
  section: (c) =>
    has(c, "button[aria-expanded='true']") && text(c).includes("Hello."),
  callout: (c) =>
    c.querySelector("blockquote[data-tone='warning'] strong")?.textContent ===
      "Note" && text(c).includes("Careful."),
  // The stage ran its script and laid out the code placeholder, which the
  // canvas filled with a peek; it shows from its enter frame on.
  animation: (c) =>
    has(
      c,
      "[data-animation-slot='code'] .fixture-inline-editor[data-path='order.ts']",
    ) && text(c).includes("An order arrives"),
};

let canvas: ReturnType<typeof mount> | undefined;

afterEach(async () => {
  await act(async () => canvas?.dispose());
  canvas = undefined;
});

async function mountFixture(
  kind: Kind,
  options: {
    trace?: null;
    diagramFullscreenOnClick?: boolean;
    document?: Snapshot["document"];
    host?: Partial<WhiteboardHost>;
  } = {},
  hostStyle?: string,
) {
  const snapshot: Snapshot = {
    reviewId: `fixture-${kind}`,
    version: 0,
    title: "Fixture review",
    pins: { repositoryId: "repo", base: "base", head: "head" },
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
    document: options.document ?? fixtures.get(kind)!,
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const image = { bytes: png, type: "image/png" };

  const load = (saved: Snapshot) =>
    loadFixture({
      snapshot: saved,
      progress: fixtureProgress,
      commits: [
        {
          commit: "a".repeat(40),
          parentCommit: "b".repeat(40),
          subject: "Fixture",
          author: "Developer",
          authoredAt: "2026-09-16T00:00:00.000Z",
          fileCount: 1,
          additions: 1,
          deletions: 0,
        },
      ],
      images: { [FIXTURE_IMAGE_ID]: image },
      traces: options.trace === null ? {} : { [FIXTURE_TRACE_ID]: trace },
      maps: { [FIXTURE_MAP_ID]: savedMap },
    });

  const data = load(snapshot);

  const container = document.createElement("div");

  if (hostStyle) container.style.cssText = hostStyle;
  document.body.append(container);
  await act(async () => {
    canvas = mount(container, data, {
      host: fixtureHost({
        diffView: {
          files: async () => [
            { path: "a.ts", status: "modified", additions: 1, deletions: 0 },
          ],
          create: () => {
            throw new Error("Diff is not mounted by this test.");
          },
        },
        ...options.host,
      }),
      settings: {
        softwareMapEnabled: true,
        diagramFullscreenOnClick: options.diagramFullscreenOnClick,
      },
    });
  });

  // A later version of the document, as the canvas receives an edit.
  const edit = (document: Snapshot["document"]) =>
    act(async () =>
      canvas?.update(
        load({ ...snapshot, version: snapshot.version + 1, document }),
      ),
    );

  return { container, snapshot, edit };
}

describe("block components", () => {
  it.each([
    {
      kind: "sequence",
      selector: "figure [data-review-copy-prose]",
      label: "sequence title",
    },
    {
      kind: "flow_diagram",
      selector: "figure [data-review-copy-prose]",
      label: "flow title",
    },
    {
      kind: "database_lens",
      selector: "figure [data-review-copy-prose]",
      label: "database title",
    },
    {
      kind: "software_map",
      selector: "figure [data-review-copy-prose]",
      label: "map title",
    },
    {
      kind: "code",
      selector: "pre > code[data-review-copy-prose]",
      label: "authored code",
    },
    {
      kind: "markdown",
      selector: "pre > code[data-review-copy-prose]",
      label: "fenced Markdown code",
    },
  ] as const)(
    "copies selected $label text for the agent",
    async ({ kind, selector }) => {
      const code = 'export const status = "queued";\n  save(status);';

      const documentBlocks: Snapshot["document"] | undefined =
        kind === "code"
          ? [
              {
                id: "block-1",
                type: "code",
                language: "ts",
                text: code,
                caption: "The new status",
              },
            ]
          : kind === "markdown"
            ? [
                {
                  id: "block-1",
                  type: "markdown",
                  markdown: "```ts\n" + code + "\n```",
                },
              ]
            : undefined;

      // Copy ref asks the host's review API for the agent's context.
      let reply = "";

      const request = vi.fn<NonNullable<WhiteboardHost["request"]>>(
        async (path) =>
          path.includes("/copy-context")
            ? Response.json({ text: reply })
            : Response.json({ error: "Not in this test." }, { status: 404 }),
      );

      const { container } = await mountFixture(kind, {
        document: documentBlocks,
        host: { request },
      });

      expect(
        await settled(() => container.querySelector(selector) !== null),
      ).toBe(true);
      const selected = container.querySelector(selector)!;

      const quote =
        kind === "code" || kind === "markdown" ? code : selected.textContent!;

      request.mockClear();
      reply = `> ${quote}`;

      const write = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue();

      const selection = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(selected);

      try {
        await act(async () => {
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
        });

        const copy = container.querySelector<HTMLButtonElement>(
          '[aria-label="Copy ref"]',
        );

        expect(copy).not.toBeNull();
        await act(async () => copy!.click());
        expect(request).toHaveBeenCalledWith(
          expect.stringContaining("/copy-context"),
          expect.objectContaining({
            method: "POST",
            body: expect.any(String),
          }),
        );
        expect(
          JSON.parse(request.mock.lastCall![1]!.body as string),
        ).toMatchObject({
          target: { kind: "text", quote },
          title: quote.slice(0, 100),
        });
        expect(write).toHaveBeenCalledWith(`> ${quote}`);
      } finally {
        selection.removeAllRanges();
        write.mockRestore();
      }
    },
  );

  it.each(["sequence", "database_lens", "software_map"] as const)(
    "keeps %s interactions without offering Copy ref",
    async (kind) => {
      const { container } = await mountFixture(kind);
      expect(await settled(() => rendered[kind](container))).toBe(true);
      const buttons = [...container.querySelectorAll("button")];
      expect(
        buttons.some((button) =>
          button.textContent?.includes("Select for Agent"),
        ),
      ).toBe(false);

      const target = container.querySelector<HTMLElement>(
        kind === "sequence"
          ? ".sequence-diagram .react-flow__node button[title]"
          : kind === "database_lens"
            ? ".database-lens header"
            : ".software-map .react-flow__node",
      );

      expect(target).not.toBeNull();
      await act(async () => target!.click());
      expect(
        [...container.querySelectorAll("button")].some(
          (button) => button.textContent === "Copy ref",
        ),
      ).toBe(false);
    },
  );

  it("has a component for every fixture kind", () => {
    expect(Object.keys(blockComponents).sort()).toEqual(
      [...fixtures.keys()].sort(),
    );
  });

  it.each(Object.keys(rendered) as (keyof typeof rendered)[])(
    "renders the %s fixtures with their content and a finished layout",
    async (kind) => {
      const { container, snapshot } = await mountFixture(kind);

      expect(await settled(() => rendered[kind](container))).toBe(true);
      expect(text(container)).not.toContain("Layout failed");
      expect(container.querySelector("[data-block-error]")).toBeNull();

      // Every visible block, nested ones included, mounts a node with content.
      const empty = elements(snapshot.document)
        .filter((element) => !isUnit(element))
        .map((element) => element.id)
        .filter((id) => {
          const node = container.querySelector(`[data-review-node-id="${id}"]`);

          return !node || node.innerHTML.trim() === "";
        });

      expect(empty).toEqual([]);
    },
  );

  it("shows an animation's code peek from the frame it enters on", async () => {
    const { container } = await mountFixture("animation");

    const slot = () =>
      container.querySelector<HTMLElement>("[data-animation-slot='code']");

    expect(await settled(() => slot()?.style.visibility === "hidden")).toBe(
      true,
    );

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
        .click(),
    );

    expect(await settled(() => slot()?.style.visibility === "visible")).toBe(
      true,
    );
    expect(text(container)).toContain("Its status is queued");
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("sizes an animation to host code peeks and shrinks when content is removed", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Auto size",
          height: "auto",
          frames: [
            { key: "peek", title: "Code" },
            { key: "small", title: "Small" },
          ],
          code: { status: "head/order.ts#L1" },
          html: '<style>html[data-frame="small"] [data-wb-code] { display: none; }</style><div style="padding: 24px"><div style="height: 100px">Content</div><div data-wb-code="status"></div></div>',
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    const iframe = (await settled(() => container.querySelector("iframe")))!;
    const stage = iframe.parentElement!;

    const slot = () =>
      container.querySelector<HTMLElement>("[data-animation-slot='code']");

    expect(
      await settled(() => {
        const peek = slot();

        return (
          peek &&
          peek.offsetHeight > 0 &&
          stage.getBoundingClientRect().bottom >=
            peek.getBoundingClientRect().bottom + 23
        );
      }),
    ).toBe(true);
    const expanded = stage.offsetHeight;
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
        .click(),
    );
    expect(
      await settled(
        () => stage.offsetHeight === 148 && stage.offsetHeight < expanded,
      ),
    ).toBe(true);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          "button[aria-label='Previous frame']",
        )!
        .click(),
    );
    expect(await settled(() => stage.offsetHeight === expanded)).toBe(true);
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("animates a later interaction after the initial instant frame", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Interactive motion",
          height: 240,
          frames: [{ key: "idle", title: "Ready for input" }],
          code: { status: "head/order.ts#L1" },
          html: [
            '<button id="run">Move</button>',
            '<div id="peek" data-wb-code="status" style="width:200px;margin:0 16px"></div>',
            "<script>",
            'document.querySelector("#run").addEventListener("click", () => {',
            'whiteboard.animate("#peek", [{transform:"translateX(0px)"},{transform:"translateX(120px)"}], {duration:1500,easing:"linear"});',
            "});",
            // The sandbox receives its first frame instantly. A later DOM event
            // must still play motion, as a slider or button interaction would.
            'whiteboard.on("idle", () => { setTimeout(() => document.querySelector("#run").click(), 500); });',
            "</script>",
          ].join(""),
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    const x = () => {
      const slot = container.querySelector<HTMLElement>(
        "[data-animation-slot='code']",
      );

      return (
        slot && Number(/translate\(([-\d.]+)px/.exec(slot.style.transform)?.[1])
      );
    };

    const start = await settled(x);

    expect(start).toBeGreaterThan(0);
    expect(
      await settled(() => {
        const position = x();

        return (
          position !== null &&
          position !== undefined &&
          position > start! + 5 &&
          position < start! + 115
        );
      }, 2500),
    ).toBe(true);
    expect(await settled(() => x() === start! + 120)).toBe(true);
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("plays an animation's frame timeline forward and seeks it back", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Timeline",
          height: 240,
          frames: [
            { key: "a", title: "Two services" },
            { key: "b", title: "A calls B" },
            { key: "c", title: "The peek moves" },
          ],
          code: { status: "head/order.ts#L1" },
          html: [
            '<div class="wb-row"><div class="wb-node" id="a">A</div><div class="wb-node" id="b">B</div></div>',
            '<div id="peek" data-wb-code="status" style="width: 200px; margin: 0 16px"></div>',
            "<script>",
            'const arrow = whiteboard.arrow("#a", "#b", { label: "call", enter: "b" });',
            'whiteboard.travel(whiteboard.token({ label: "req" }), arrow, "b");',
            'whiteboard.timeline("c").set("#peek", { translateX: 60 }).add("#peek", { translateX: 120, duration: 300 });',
            "</script>",
          ].join(""),
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    // The slot overlay copies the placeholder's position in the stage.
    const x = () => {
      const slot = container.querySelector<HTMLElement>(
        "[data-animation-slot='code']",
      );

      return (
        slot && Number(/translate\(([-\d.]+)px/.exec(slot.style.transform)?.[1])
      );
    };

    const next = (label: string) =>
      act(async () =>
        container
          .querySelector<HTMLButtonElement>(`button[aria-label='${label}']`)!
          .click(),
      );

    const start = await settled(x);

    expect(start).toBeGreaterThan(0);
    await next("Next frame");
    // Landing on frame b's end must not apply frame c's first set().
    expect(await settled(() => x() === start)).toBe(true);
    await next("Next frame");
    expect(await settled(() => x() === start! + 120)).toBe(true);
    await next("Previous frame");
    expect(await settled(() => x() === start)).toBe(true);
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("shows an animation's data-only element during its frames alone", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Only",
          height: 240,
          frames: [
            { key: "a", title: "Before" },
            { key: "b", title: "During" },
            { key: "c", title: "After" },
          ],
          code: { status: "head/order.ts#L1" },
          html: '<div data-wb-code="status" data-only="b" style="width: 200px"></div>',
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    const visibility = () =>
      container.querySelector<HTMLElement>("[data-animation-slot='code']")
        ?.style.visibility;

    const next = () =>
      act(async () =>
        container
          .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
          .click(),
      );

    expect(await settled(() => visibility() === "hidden")).toBe(true);
    await next();
    expect(await settled(() => visibility() === "visible")).toBe(true);
    await next();
    expect(await settled(() => visibility() === "hidden")).toBe(true);
  });

  it("animates new frame content after the shared renderer creates it", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Rendered pack motion",
          height: "auto",
          pins: { repositoryId: "repo", base: "base", head: "head" },
          frames: [
            { key: "idle", title: "Ready" },
            { key: "arrival", title: "Arrival", duration: 1400 },
          ],
          code: { proof: "head/order.ts#L1" },
          html: [
            '<div id="packs"></div><script>',
            'const packs=document.querySelector("#packs");const proof=whiteboard.code("proof");proof.style.width="10px";document.body.append(proof);',
            'whiteboard.on("*",()=>{packs.innerHTML="<div class=pack>Incoming pack</div>"});',
            'whiteboard.on("arrival",()=>{const pack=packs.querySelector(".pack");const a=whiteboard.animate(pack,[{opacity:.2},{opacity:1}],{duration:1000});setTimeout(()=>{const opacity=Number(getComputedStyle(pack).opacity);proof.style.width=pack.isConnected&&opacity>.2&&opacity<.95?"200px":"100px"},200);return a;});',
            "</script>",
          ].join(""),
        },
      ],
    });

    const width = () =>
      container.querySelector<HTMLElement>("[data-animation-slot='code']")
        ?.style.width;

    // The stage's script has run once its placeholder reports its width.
    expect(await settled(() => width() === "10px")).toBe(true);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
        .click(),
    );
    expect(await settled(() => (width() === "200px" ? true : undefined))).toBe(
      true,
    );
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("hides packets for a responsive layout until its endpoints are displayed", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Responsive packet visibility",
          height: "auto",
          pins: { repositoryId: "repo", base: "base", head: "head" },
          frames: [
            { key: "hidden", title: "Hidden layout" },
            { key: "visible", title: "Visible layout", duration: 1000 },
          ],
          code: { proof: "head/order.ts#L1" },
          html: [
            '<div id="layout" style="display:none"><div id="a" style="width:80px;height:40px">Client</div><div id="b" style="width:80px;height:40px;margin-left:180px">Server</div></div>',
            "<script>",
            'const a=document.querySelector("#a"),b=document.querySelector("#b"),layout=document.querySelector("#layout");',
            "const edge=whiteboard.arrow(a,b);const chip=whiteboard.token();",
            'whiteboard.travel(chip,edge,"hidden",{duration:400,position:0,stay:true});whiteboard.travel(chip,edge,"visible",{duration:800,position:0,stay:true});',
            'const proof=whiteboard.code("proof");proof.style.width="10px";document.body.append(proof);',
            'whiteboard.on("*",({frame})=>{layout.style.display=frame.key==="hidden"?"none":"block";setTimeout(()=>{const hidden=getComputedStyle(chip).visibility==="hidden";proof.style.width=hidden===(frame.key==="hidden")?(hidden?"200px":"240px"):"100px"},200)});',
            "</script>",
          ].join(""),
        },
      ],
    });

    const width = () =>
      container.querySelector<HTMLElement>("[data-animation-slot='code']")
        ?.style.width;

    expect(await settled(() => (width() === "200px" ? true : undefined))).toBe(
      true,
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
        .click(),
    );
    expect(await settled(() => (width() === "240px" ? true : undefined))).toBe(
      true,
    );
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("keeps an edge label clear of a travelling packet", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Readable message motion",
          height: "auto",
          pins: { repositoryId: "repo", base: "base", head: "head" },
          frames: [
            { key: "idle", title: "Ready" },
            { key: "travel", title: "Request", duration: 1800 },
          ],
          code: { proof: "head/order.ts#L1" },
          html: [
            '<div id="diagram" style="width:320px"></div>',
            "<script>",
            'const s=whiteboard.scene({columns:3,container:"#diagram"});',
            'const a=s.actor({id:"a",at:[1,1],title:"Client"});',
            'const b=s.actor({id:"b",at:[1,2],title:"Store"});',
            'const edge=s.link(a,b,{label:"GET c8f3"});',
            'const chip=whiteboard.token({label:"request",only:["travel"]});',
            'whiteboard.travel(chip,edge,"travel",{duration:1200});',
            'const proof=whiteboard.code("proof");proof.style.width="10px";document.body.append(proof);',
            'whiteboard.on("travel",()=>{setTimeout(()=>{const l=edge.querySelector("text").getBoundingClientRect(),r=chip.getBoundingClientRect();const overlap=l.left<r.right&&l.right>r.left&&l.top<r.bottom&&l.bottom>r.top;const visible=Number(getComputedStyle(chip).opacity)>.5;proof.style.width=!overlap&&visible?"200px":"100px"},600)});',
            "</script>",
          ].join(""),
        },
      ],
    });

    const width = () =>
      container.querySelector<HTMLElement>("[data-animation-slot='code']")
        ?.style.width;

    expect(await settled(() => width() === "10px")).toBe(true);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
        .click(),
    );
    expect(
      await settled(() =>
        width() === "100px" || width() === "200px" ? width() : undefined,
      ),
    ).toBe("200px");
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("clears a later frame's note when the reader steps back", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Notes",
          height: "auto",
          pins: { repositoryId: "repo", base: "base", head: "head" },
          frames: [
            { key: "before", title: "Before" },
            { key: "after", title: "After" },
          ],
          code: { proof: "head/order.ts#L1" },
          html: [
            "<script>",
            "const s=whiteboard.scene({columns:1});",
            'const canvas=s.actor({id:"canvas",at:[1,1],title:"Canvas"});',
            's.on("after",canvas,{note:"redrawn"});',
            'const proof=whiteboard.code("proof");proof.style.width="10px";document.body.append(proof);',
            'whiteboard.on("*",({frame})=>{setTimeout(()=>{const note=canvas.element.querySelector(".wb-card-note").textContent;proof.style.width=frame.key==="after"?(note==="redrawn"?"240px":"100px"):(note===""?"200px":"100px")},50)});',
            "</script>",
          ].join(""),
        },
      ],
    });

    const width = () =>
      container.querySelector<HTMLElement>("[data-animation-slot='code']")
        ?.style.width;

    const step = (label: string) =>
      act(async () =>
        container
          .querySelector<HTMLButtonElement>(`button[aria-label='${label}']`)!
          .click(),
      );

    expect(await settled(() => width() === "200px")).toBe(true);
    await step("Next frame");
    expect(await settled(() => width() === "240px")).toBe(true);
    await step("Previous frame");
    expect(
      await settled(() =>
        width() === "100px" || width() === "200px" ? width() : undefined,
      ),
    ).toBe("200px");
  });

  it("draws the stage in the whiteboard's faces and color scheme", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Faces",
          height: "auto",
          pins: { repositoryId: "repo", base: "base", head: "head" },
          frames: [{ key: "only", title: "Only" }],
          code: { proof: "head/order.ts#L1" },
          html: [
            '<div class="wb-card"><span class="wb-mono">mono</span></div>',
            "<script>",
            'const proof=whiteboard.code("proof");proof.style.width="10px";document.body.append(proof);',
            'document.fonts.load(\'12px "Geist Mono"\').then(()=>{const loaded=[...document.fonts].some(face=>face.family.includes("Geist Mono")&&face.status==="loaded");const scheme=getComputedStyle(document.documentElement).colorScheme===whiteboard.colorScheme;proof.style.width=loaded&&scheme?"200px":"100px"});',
            "</script>",
          ].join(""),
        },
      ],
    });

    const width = () =>
      container.querySelector<HTMLElement>("[data-animation-slot='code']")
        ?.style.width;

    expect(
      await settled(() =>
        width() === "100px" || width() === "200px" ? width() : undefined,
      ),
    ).toBe("200px");
  });

  it("does not report a ResizeObserver that resizes its own target", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Resize loop",
          height: "auto",
          pins: { repositoryId: "repo", base: "base", head: "head" },
          frames: [{ key: "only", title: "Only" }],
          code: { proof: "head/order.ts#L1" },
          html: [
            '<div id="grow" style="height:10px"></div><script>',
            'const grow=document.querySelector("#grow");let n=0;',
            "new ResizeObserver(()=>{if(n++<5)grow.style.height=`${10+n*10}px`}).observe(grow);",
            'const proof=whiteboard.code("proof");proof.style.width="10px";document.body.append(proof);',
            'setTimeout(()=>{proof.style.width="200px"},300);',
            "</script>",
          ].join(""),
        },
      ],
    });

    const width = () =>
      container.querySelector<HTMLElement>("[data-animation-slot='code']")
        ?.style.width;

    expect(await settled(() => width() === "200px")).toBe(true);
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  const alertText = (container: HTMLElement) =>
    container.querySelector("[role='alert']")?.textContent ?? "";

  it("stops measuring a still stage and measures again for a frame change", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Idle",
          height: "auto",
          frames: [
            { key: "still", title: "Still" },
            { key: "moved", title: "Moved" },
          ],
          code: { status: "head/order.ts#L1" },
          html: [
            '<div id="peek" data-wb-code="status" style="width:200px"></div>',
            "<script>",
            "let n=0;const raf=window.requestAnimationFrame.bind(window);",
            "window.requestAnimationFrame=(cb)=>{n++;return raf(cb)};",
            "const report=(label)=>{const s=n;setTimeout(()=>{throw new Error(`${label} ${n-s} frames`)},500)};",
            'whiteboard.on("still",()=>setTimeout(()=>report("still"),1000));',
            'whiteboard.on("moved",()=>{whiteboard.animate("#peek",[{transform:"translateX(0px)"},{transform:"translateX(80px)"}],300);setTimeout(()=>report("moved"),1000)});',
            "</script>",
          ].join(""),
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    const x = () => {
      const slot = container.querySelector<HTMLElement>(
        "[data-animation-slot='code']",
      );

      return (
        slot && Number(/translate\(([-\d.]+)px/.exec(slot.style.transform)?.[1])
      );
    };

    expect(
      await settled(() => /still \d+ frames/.exec(alertText(container))),
    ).toBeTruthy();
    expect(alertText(container)).toContain("still 0 frames");
    const start = x()!;
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
        .click(),
    );
    expect(await settled(() => x() === start + 80)).toBe(true);
    expect(
      await settled(() => /moved \d+ frames/.exec(alertText(container))),
    ).toBeTruthy();
    expect(alertText(container)).toContain("moved 0 frames");
  });

  // Records the type of every message a stage posts to its block.
  const tapStages = () => {
    const posted: string[] = [];
    const Channel = window.MessageChannel;

    window.MessageChannel = class extends Channel {
      constructor() {
        super();
        this.port1.addEventListener("message", (event: MessageEvent) =>
          posted.push(event.data?.type),
        );
      }
    };

    return {
      posted,
      count: (type: string) => posted.filter((item) => item === type).length,
      [Symbol.dispose]: () => (window.MessageChannel = Channel),
    };
  };

  it("does not resend slots for sub-pixel motion", async () => {
    using stages = tapStages();

    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Jitter",
          height: 240,
          frames: [{ key: "only", title: "Only" }],
          code: { status: "head/order.ts#L1" },
          html: [
            "<style>@keyframes jitter { from { transform: translate(0.1px, 0.1px); opacity: 0.999; } to { transform: translate(0.4px, 0.4px); opacity: 0.996; } }</style>",
            '<div data-wb-code="status" style="width:200px;animation:jitter 100ms linear infinite alternate"></div>',
          ].join(""),
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    expect(
      await settled(() =>
        container.querySelector("[data-animation-slot='code']"),
      ),
    ).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const before = stages.count("slots");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(stages.count("slots")).toBe(before);
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("caps an auto-sized stage's height", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Tall",
          height: "auto",
          frames: [{ key: "only", title: "Only" }],
          code: {},
          html: '<div style="height:10000000px">Tall</div>',
        },
      ],
    });

    const iframe = (await settled(() => container.querySelector("iframe")))!;

    expect(
      await settled(
        () => iframe.parentElement!.offsetHeight === STAGE_MAX_HEIGHT,
      ),
    ).toBe(true);
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("lets go of a frame's finished animations on the next frame and keeps their end state", async () => {
    using stages = tapStages();

    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Held",
          height: 240,
          frames: ["a", "b", "c", "d"].map((key) => ({ key, title: key })),
          code: {},
          html: [
            ...["a", "b", "c", "d"].map(
              (key) => `<div id="box-${key}" style="opacity:0">${key}</div>`,
            ),
            "<script>",
            'whiteboard.on("*",({frame})=>whiteboard.animate(`#box-${frame.key}`,[{opacity:0},{opacity:1}],50));',
            'whiteboard.on("d",()=>setTimeout(()=>{throw new Error(`held ${document.getAnimations().length}, a at ${getComputedStyle(document.querySelector("#box-a")).opacity}`)},400));',
            "</script>",
          ].join(""),
        },
      ],
    });

    const next = async (meta: string) => {
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
          .click(),
      );
      expect(await settled(() => text(container).includes(meta))).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 200));
    };

    // The count shows before the stage boots: wait for the stage itself, so
    // frame a's animation has run before stepping on.
    expect(await settled(() => stages.count("ready") === 1)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await next("2 / 4");
    await next("3 / 4");
    await next("4 / 4");
    expect(await settled(() => alertText(container).includes("held"))).toBe(
      true,
    );
    expect(alertText(container)).toContain("held 1, a at 1");
  });

  it("does not boot a page the stage navigates to", async () => {
    using stages = tapStages();

    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Wanders",
          height: 240,
          frames: [{ key: "only", title: "Only" }],
          code: { status: "head/order.ts#L1" },
          html: '<div data-wb-code="status"></div><script>setTimeout(()=>location.reload(),300)</script>',
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    expect(
      await settled(() =>
        container.querySelector("[data-animation-slot='code']"),
      ),
    ).toBeTruthy();
    expect(
      await settled(() =>
        alertText(container).includes("The animation left its stage."),
      ),
    ).toBe(true);
    expect(container.querySelector("[data-animation-slot]")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(stages.count("ready")).toBe(1);
  });

  it("folds a scene into fewer columns before one, and opens columns to fit a row's link labels", async () => {
    const scene = (box: string) =>
      `const ${box} = whiteboard.scene({ columns: 4, container: "#${box}" });` +
      ["a", "b", "c", "d"]
        .map(
          (id, i) =>
            `${box}.actor({ id: "${box}-${id}", at: [${i + 1}, 1], title: "${id}" });`,
        )
        .join("") +
      `${box}.link("${box}-a", "${box}-b", { label: "init + port to the stage" });` +
      `${box}.peek("status", { at: [1, 2, 1, 4] });`;

    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Folds",
          height: "auto",
          frames: [{ key: "only", title: "Only" }],
          code: { status: "head/order.ts#L1" },
          // Each scene reports its column count and gap through the error line.
          html:
            '<div id="narrow" style="width: 760px"></div><div id="wide" style="width: 1400px"></div><script>' +
            scene("narrow") +
            scene("wide") +
            'const report = (id) => { const s = getComputedStyle(document.querySelector(`#${id} .wb-scene`)); return `${id} ${s.gridTemplateColumns.split(" ").length} gap ${parseFloat(s.columnGap) > 48}`; };' +
            'setTimeout(() => { throw new Error(`${report("narrow")}, ${report("wide")}`); }, 600);' +
            "</script>",
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    expect(await settled(() => alertText(container).includes("narrow"))).toBe(
      true,
    );
    expect(alertText(container)).toContain(
      "narrow 2 gap true, wide 4 gap true",
    );
  });

  it("starts on the first scenario and switches the stage's path from the picker", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Branches",
          height: "auto",
          frames: [
            { key: "a", title: "Start", label: "START" },
            { key: "b", title: "Delivered", label: "DELIVER" },
            { key: "c", title: "Dropped", label: "DROP" },
          ],
          scenarios: [
            { key: "ok", label: "Delivered", frames: ["a", "b"] },
            { key: "lost", label: "Dropped packet", frames: ["a", "c"] },
          ],
          code: {},
          // The stage reports the path it was given through its error line.
          html: '<script>whiteboard.on("*", () => { if (whiteboard.frames.some((f) => f.key === "c")) throw new Error("stage on dropped"); });</script>',
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    const steps = () =>
      [...container.querySelectorAll("[aria-label='Steps'] button")].map(
        (step) => step.textContent,
      );

    const picker = (name: string) =>
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          "[role='group'][aria-label='Scenario'] button",
        ),
      ].find((button) => button.textContent === name)!;

    expect(text(container)).toContain("Scenario");
    expect(await settled(() => steps().join() === "1START,2DELIVER")).toBe(
      true,
    );
    expect(picker("Delivered").getAttribute("aria-pressed")).toBe("true");

    await act(async () => picker("Dropped packet").click());

    expect(await settled(() => steps().join() === "1START,2DROP")).toBe(true);
    expect(picker("Dropped packet").getAttribute("aria-pressed")).toBe("true");
    expect(
      await settled(() => alertText(container).includes("stage on dropped")),
    ).toBe(true);
  });

  it("draws an edited animation again from its first frame", async () => {
    const animation = (caption: string) => ({
      id: "block-1",
      type: "animation" as const,
      title: "Raft",
      height: "auto" as const,
      frames: [
        { key: "a", title: "Start", label: "START" },
        { key: "b", title: "Middle", label: "MIDDLE", caption },
        { key: "c", title: "End", label: "END" },
      ],
      code: {},
      html: "<p>Stage</p>",
      pins: { repositoryId: "repo", base: "base", head: "head" },
    });

    const { container, edit } = await mountFixture("animation", {
      document: [animation("First draft")],
    });

    const step = (name: string) =>
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          "[aria-label='Steps'] button",
        ),
      ].find((button) => button.textContent?.includes(name))!;

    await settled(() => step("END"));
    await act(async () => step("END").click());
    expect(await settled(() => text(container).includes("3 / 3"))).toBe(true);

    await edit([animation("Second draft")]);

    expect(await settled(() => text(container).includes("1 / 3"))).toBe(true);
    expect(container.querySelector("[data-block-error]")).toBeNull();
  });

  it("hands the stage each frame's own data", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Raft",
          height: "auto",
          frames: [
            {
              key: "steady",
              title: "Steady",
              data: { leader: "S1", terms: [1] },
            },
          ],
          code: {},
          // The stage reports the data it was given through its error line.
          html: '<script>whiteboard.on("*", ({ frame }) => { throw new Error(`leader ${frame.data.leader} terms ${whiteboard.frames[0].data.terms}`); });</script>',
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    expect(
      await settled(() => alertText(container).includes("leader S1 terms 1")),
    ).toBe(true);
  });

  it("tells the server what its script did, so the agent that wrote it can see", async () => {
    const reports: { path: string; error: string | null }[] = [];

    const throwing = (name: string): Snapshot["document"][number] => ({
      id: "block-1",
      type: "animation",
      title: "Throws",
      height: "auto",
      frames: [{ key: "only", title: "Only" }],
      code: {},
      html: `<script>whiteboard.on("*", () => { throw new Error("${name} is not defined"); });</script>`,
      pins: { repositoryId: "repo", base: "base", head: "head" },
    });

    const { edit } = await mountFixture("animation", {
      document: [throwing("render")],
      host: {
        request: async (path, init) => {
          if (path.includes("/animation-run"))
            reports.push({
              path,
              ...JSON.parse(String(init?.body)),
            });

          return Response.json({ ok: true });
        },
      },
    });

    await settled(() => reports.length >= 2);
    expect(reports).toEqual(
      expect.arrayContaining([
        {
          path: expect.stringContaining("/animation-run?version=0"),
          blockId: "block-1",
          error: null,
        },
        {
          path: expect.stringContaining("/animation-run?version=0"),
          blockId: "block-1",
          error: expect.stringContaining("render is not defined"),
        },
      ]),
    );

    // An edit's new script reports at the version the canvas now shows.
    await edit([throwing("draw")]);
    expect(
      await settled(() =>
        reports.some(
          ({ path, error }) =>
            path.includes("version=1") &&
            error?.includes("draw is not defined"),
        ),
      ),
    ).toBe(true);
  });

  it("links a frame's code beside its caption and opens it", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Checks out",
          height: "auto",
          frames: [
            { key: "write", title: "Writes", code: "write" },
            { key: "edit", title: "Edits" },
          ],
          code: { write: "head/src/drafts.ts#L12-L40" },
          html: "<p>Folder</p>",
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    const link = () =>
      container.querySelector<HTMLAnchorElement>(
        "[data-review-anchor-id='block-1:code:write']",
      );

    expect(await settled(() => link()?.textContent === "drafts.ts:12")).toBe(
      true,
    );

    await act(async () => link()!.click());
    expect(
      await settled(() => link()?.dataset.reviewAnchorOpen === "true"),
    ).toBe(true);

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
        .click(),
    );
    expect(await settled(() => link() === null)).toBe(true);
  });

  it("boots the stage again each time it goes fullscreen and back", async () => {
    using stages = tapStages();

    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Expands",
          height: "auto",
          frames: [{ key: "only", title: "Only" }],
          code: { status: "head/order.ts#L1" },
          html: '<div data-wb-code="status"></div>',
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    const slot = () => document.querySelector("[data-animation-slot='code']");
    expect(await settled(slot)).toBeTruthy();

    for (const [boots, label] of [
      [2, "Expand animation"],
      [3, "Close expanded animation"],
    ] as const) {
      await act(async () =>
        document
          .querySelector<HTMLButtonElement>(`button[aria-label='${label}']`)!
          .click(),
      );
      expect(await settled(() => stages.count("ready") === boots)).toBe(true);
      expect(document.querySelectorAll("iframe")).toHaveLength(1);
    }

    expect(await settled(slot)).toBeTruthy();
    expect(alertText(container)).toBe("");
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("draws the first slots of a stage with too many and says so", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Crowded",
          height: 240,
          frames: [{ key: "only", title: "Only" }],
          code: { status: "head/order.ts#L1" },
          html: `<script>for(let i=0;i<${STAGE_MAX_SLOTS + 1};i++)document.body.append(whiteboard.code("status"));</script>`,
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    expect(
      await settled(() =>
        alertText(container).includes(
          `at most ${STAGE_MAX_SLOTS} code or block slots`,
        ),
      ),
    ).toBe(true);
    expect(
      await settled(
        () =>
          container.querySelectorAll("[data-animation-slot]").length ===
          STAGE_MAX_SLOTS,
      ),
    ).toBe(true);
  });

  it("mounts a scene in its container and keeps narrow tables readable", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Responsive scene",
          height: "auto",
          pins: { repositoryId: "repo", base: "base", head: "head" },
          frames: [
            { key: "narrow", title: "Narrow" },
            { key: "wide", title: "Wide" },
            { key: "wide-idle", title: "Wide without future content" },
          ],
          code: { proof: "head/order.ts#L1" },
          html: [
            '<div id="scene-slot" style="width:320px"></div>',
            "<script>",
            'const shell=document.getElementById("scene-slot");',
            "const s=whiteboard.scene({columns:3,container:shell});",
            'const a=s.actor({id:"a",at:[1,1],title:"Reader",note:"Read an object response"});',
            'const b=s.actor({id:"b",at:[2,2],title:"Tree",only:["wide"]});s.send(a,b,"GET","wide");',
            'const files=s.table({id:"files",at:[3,1],title:"Files",columns:["path","blob"]});',
            'files.row(["server-with-a-long-name.ts","f7a9"]);',
            'const badge=s.badge({text:"Local repository"});',
            'const proof=whiteboard.code("proof");proof.style.width="10px";document.body.append(proof);',
            "function luminance(color){const c=color.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*c[0]+.7152*c[1]+.0722*c[2]}",
            "function readable(el){const x=luminance(getComputedStyle(el).color),y=luminance(getComputedStyle(a.element).backgroundColor);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)>=4.5}",
            'function report(key){const bounds=files.element.getBoundingClientRect();const fits=[...files.element.querySelectorAll("th,td")].every(cell=>{const r=document.createRange();r.selectNodeContents(cell);return [...r.getClientRects()].every(b=>b.left>=bounds.left&&b.right<=bounds.right)});const stacked=bounds.top>a.element.getBoundingClientRect().bottom;const note=[...a.element.children].find(el=>el.textContent==="Read an object response");const contrast=readable(note)&&readable(files.element.querySelector("th"));const okay=shell.contains(a.element)&&shell.contains(badge)&&fits&&stacked===(key==="narrow")&&contrast&&(key!=="wide-idle"||b.element.getBoundingClientRect().height===0);proof.style.width=okay?(key==="narrow"?"200px":key==="wide"?"240px":"280px"):"100px"}',
            'whiteboard.on("*",({frame})=>{shell.style.width=frame.key==="narrow"?"320px":"720px";setTimeout(()=>report(frame.key),100)});',
            "</script>",
          ].join(""),
        },
      ],
    });

    // Report real sandbox measurements through a public code placeholder,
    // whose host overlay is observable even with an opaque sandbox origin.
    const width = () =>
      container.querySelector<HTMLElement>("[data-animation-slot='code']")
        ?.style.width;

    expect(
      await settled(() =>
        width() === "100px" || width() === "200px" ? width() : undefined,
      ),
    ).toBe("200px");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
        .click(),
    );
    expect(
      await settled(() =>
        width() === "100px" || width() === "240px" ? width() : undefined,
      ),
    ).toBe("240px");
    const iframe = container.querySelector("iframe")!;
    const expandedHeight = iframe.getBoundingClientRect().height;

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
        .click(),
    );
    expect(
      await settled(() =>
        width() === "100px" || width() === "280px" ? width() : undefined,
      ),
    ).toBe("280px");
    expect(
      await settled(
        () => iframe.getBoundingClientRect().height < expandedHeight - 30,
      ),
    ).toBe(true);
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("lays out a scene and shows a peek the scene reveals on a later frame", async () => {
    const { container } = await mountFixture("animation", {
      document: [
        {
          id: "block-1",
          type: "animation",
          title: "Scene",
          height: 320,
          frames: [
            { key: "idle", title: "Idle", label: "IDLE" },
            { key: "run", title: "Running", label: "RUN" },
          ],
          code: { status: "head/order.ts#L1" },
          html: [
            "<script>",
            "const s = whiteboard.scene({ columns: 3 });",
            'const a = s.actor({ id: "a", at: [1, 1], title: "A" });',
            'const b = s.actor({ id: "b", at: [2, 1], title: "B", note: "idle" });',
            's.link(a, b, { label: "call" });',
            's.send(a, b, "req", "run");',
            's.on("run", b, { note: "done", tone: "added" });',
            's.peek("status", { at: [1, 2, 1, 3], only: ["run"] });',
            "</script>",
          ].join(""),
          pins: { repositoryId: "repo", base: "base", head: "head" },
        },
      ],
    });

    const visibility = () =>
      container.querySelector<HTMLElement>("[data-animation-slot='code']")
        ?.style.visibility;

    // The step strip names the frames and marks the current one.
    const strip = await settled(() =>
      container.querySelector('[role="group"][aria-label="Steps"]'),
    );

    expect(
      [...strip!.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["1IDLE", "2RUN"]);
    expect(strip!.querySelector('[aria-current="step"]')!.textContent).toBe(
      "1IDLE",
    );

    // The scene ran and placed a peek that only shows on the second frame.
    expect(await settled(() => visibility() === "hidden")).toBe(true);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
        .click(),
    );
    expect(await settled(() => visibility() === "visible")).toBe(true);
    expect(strip!.querySelector('[aria-current="step"]')!.textContent).toBe(
      "2RUN",
    );
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("opens the selected call-tree frame's code", async () => {
    const { container } = await mountFixture("call_stack_diff");

    const tree = await settled(() =>
      container.querySelector('nav[aria-label="Call tree"]'),
    );

    expect(tree).not.toBeNull();
    const frames = tree!.querySelectorAll("button");
    expect([...frames].map((frame) => frame.textContent)).toEqual([
      "status = queued",
    ]);
    await act(async () => frames[0]!.click());
    expect(
      await settled(() =>
        container.querySelector('.fixture-inline-editor[data-path="order.ts"]'),
      ),
    ).not.toBeNull();
  });

  it("renders a trace quote whose trace fails to load as a placeholder, not an error", async () => {
    const { container } = await mountFixture("trace_quote", { trace: null });

    expect(
      await settled(() =>
        container.querySelector("blockquote[data-unavailable='trace']"),
      ),
    ).toBeTruthy();
    expect(text(container)).toContain("queue the order");
    expect(container.querySelector("[data-block-error]")).toBeNull();
  });
});

describe("BlockErrorBoundary", () => {
  const Broken = () => {
    throw new Error("bad props reached render");
  };

  it("contains one throwing block, reports it, and leaves its siblings rendered", async () => {
    const onError = vi.fn<(error: Error) => void>();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      root.render(
        <>
          <BlockErrorBoundary
            block={{ id: "a", type: "markdown", markdown: "" }}
            onError={onError}
          >
            <p>Healthy sibling</p>
          </BlockErrorBoundary>
          <BlockErrorBoundary
            block={{
              id: "b",
              type: "flow_diagram",
              title: "",
              nodes: [],
              edges: [],
            }}
            onError={onError}
          >
            <Broken />
          </BlockErrorBoundary>
        </>,
      );
    });

    expect(text(container)).toContain("Healthy sibling");
    expect(
      container.querySelector("[role='alert'][data-block-error='flow_diagram']")
        ?.textContent,
    ).toContain("bad props reached render");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].message).toBe("bad props reached render");
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  });

  it("renders the replacement once the failing block is edited", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const render = (block: StoredBlock, children: ReactNode) =>
      act(async () => {
        root.render(
          <BlockErrorBoundary block={block} onError={() => {}}>
            {children}
          </BlockErrorBoundary>,
        );
      });

    const broken: StoredBlock = { id: "a", type: "markdown", markdown: "" };
    await render(broken, <Broken />);
    await render(broken, <p>Unrelated rerender</p>);
    expect(container.querySelector("[data-block-error]")).toBeTruthy();

    await render({ ...broken, markdown: "fixed" }, <p>Fixed block</p>);
    expect(container.querySelector("[data-block-error]")).toBeNull();
    expect(text(container)).toContain("Fixed block");
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  });
});

it("opens a flow node in a full-screen tour with all its code attachments", async () => {
  const { container } = await mountFixture("flow_diagram", {
    diagramFullscreenOnClick: true,
  });

  await settled(() => container.querySelector(".lens-flow-node"));
  await act(async () =>
    container
      .querySelector(".lens-flow-node")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(
    await settled(
      () =>
        container.querySelectorAll(
          '[role="dialog"] > :last-child .fixture-inline-editor',
        ).length === 2,
    ),
  ).toBe(true);
  expect(
    container.querySelector('[role="dialog"] > :last-child')?.textContent,
  ).toContain("Validation");
  expect(
    container.querySelector('[role="dialog"][aria-modal="true"]'),
  ).not.toBeNull();
  expect(container.querySelector("figure aside")).toBeNull();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector(".lens-flow-node")).not.toBeNull();
});

it.each([
  {
    kind: "database_lens" as const,
    selector: ".database-lens .react-flow__node [role='group'][aria-label]",
    editors: 1,
    pressed: null,
  },
  {
    kind: "flow_diagram" as const,
    selector: ".lens-flow-node",
    editors: 2,
    pressed: "true",
  },
  {
    kind: "sequence" as const,
    selector: ".react-flow__node button[title='API']",
    editors: 1,
    pressed: null,
  },
  {
    kind: "sequence" as const,
    selector: "button[data-review-anchor-id='step-1']",
    editors: 1,
    pressed: "true",
  },
])(
  "opens $kind selections inline when expansion is off",
  async ({ kind, selector, editors, pressed }) => {
    const { container } = await mountFixture(kind, {
      diagramFullscreenOnClick: false,
    });

    const node = await settled(() => container.querySelector(selector));

    expect(node).toBeTruthy();
    await act(async () =>
      node!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(
      await settled(() => container.querySelector(".fixture-inline-editor")),
    ).toBeTruthy();
    expect(
      container.querySelector('[role="dialog"][aria-modal="true"]'),
    ).toBeNull();

    expect(node!.getAttribute("aria-pressed")).toBe(pressed);
    expect(
      await settled(
        () =>
          container.querySelectorAll(".fixture-inline-editor").length ===
          editors,
      ),
    ).toBe(true);

    const expand = container.querySelector<HTMLButtonElement>(
      ".diagram-tour-button",
    );

    await act(async () => expand!.click());
    expect(
      await settled(() =>
        container.querySelector('[role="dialog"][aria-modal="true"]'),
      ),
    ).toBeTruthy();
  },
);

it.each(["sequence", "flow_diagram"] as const)(
  "tracks the highlighted %s stop while scrolling the inline tour",
  async (kind) => {
    const explanation = Array.from(
      { length: 30 },
      (_, index) => `Detail ${index + 1}: follow this step before continuing.`,
    ).join("\n\n");

    const block =
      kind === "sequence"
        ? {
            id: "scroll-sequence",
            type: "sequence" as const,
            title: "Scrollable sequence",
            actors: { a: "Caller", b: "Worker" },
            steps: Array.from({ length: 5 }, (_, index) => ({
              id: `scroll-step-${index}`,
              type: "step" as const,
              from: "a",
              to: "b",
              label: `Stage ${index + 1}`,
              explanation,
            })),
          }
        : {
            id: "scroll-flow",
            type: "flow_diagram" as const,
            title: "Scrollable flow",
            nodes: Array.from({ length: 5 }, (_, index) => ({
              key: `node-${index}`,
              label: `Stage ${index + 1}`,
              description: explanation,
              attachments: [],
            })),
            edges: Array.from({ length: 4 }, (_, index) => ({
              from: `node-${index}`,
              to: `node-${index + 1}`,
            })),
          };

    const { container } = await mountFixture(
      kind,
      {
        document: documentSchema.parse([
          block,
          {
            id: "scroll-filler",
            type: "markdown",
            markdown: explanation.repeat(3),
          },
        ]),
      },
      "height:800px;max-height:800px;overflow:hidden",
    );

    const trigger = await settled(() =>
      container.querySelector<HTMLElement>(
        kind === "sequence"
          ? "button[data-review-anchor-id='scroll-step-0']"
          : ".lens-flow-node",
      ),
    );

    await act(async () => trigger!.click());

    const sections = await settled(() => {
      const result = container.querySelectorAll<HTMLElement>(
        "aside section[data-review-anchor-id]",
      );

      return result.length === 5 ? result : null;
    });

    expect(sections).toBeTruthy();
    let scroller = sections![0]!.parentElement;

    while (
      scroller &&
      !/auto|scroll/.test(getComputedStyle(scroller).overflowY)
    )
      scroller = scroller.parentElement;
    expect(scroller).toBeTruthy();
    const figure = container.querySelector("figure")!;
    let boardScroller = figure.parentElement;

    while (
      boardScroller &&
      !/auto|scroll/.test(getComputedStyle(boardScroller).overflowY)
    )
      boardScroller = boardScroller.parentElement;
    expect(boardScroller).toBeTruthy();
    await act(async () => {
      boardScroller!.scrollTop = boardScroller!.scrollHeight;
    });
    expect(figure.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      boardScroller!.getBoundingClientRect().top,
    );
    await act(async () => {
      scroller!.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scroller!.scrollTop +=
        sections![3]!.getBoundingClientRect().top -
        scroller!.getBoundingClientRect().top;
      scroller!.dispatchEvent(new Event("scroll"));
    });
    expect(
      await settled(
        () =>
          container.querySelector(".tour-pill-count")?.textContent === "4/5",
      ),
    ).toBe(true);

    const selected =
      kind === "sequence"
        ? container.querySelector(
            "button[data-review-anchor-id='scroll-step-3']",
          )
        : container.querySelectorAll(".lens-flow-node")[3];

    expect(selected?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".diagram-tour-overlay")).toBeNull();
    expect(
      await settled(
        () =>
          figure.getBoundingClientRect().bottom >
          boardScroller!.getBoundingClientRect().top,
      ),
    ).toBe(true);
  },
);

it("grows a tall, wide sequence diagram to its height instead of scrolling it vertically", async () => {
  const actors = ["a", "b", "c", "d", "e", "f", "g", "h"];

  const { container } = await mountFixture(
    "sequence",
    {
      document: documentSchema.parse([
        {
          id: "diagram-1",
          type: "sequence",
          title: "Ten steps across eight actors",
          actors: Object.fromEntries(actors.map((key) => [key, key])),
          steps: Array.from({ length: 10 }, (_, index) => ({
            id: `step-${index}`,
            from: actors[index % 8]!,
            to: actors[(index + 1) % 8]!,
            label: `step ${index}`,
            explanation: "One step.",
          })),
        },
      ]),
    },
    "position: relative; height: 700px; overflow: hidden",
  );

  const body = await settled(
    () =>
      container.querySelector<HTMLElement>(".sequence-diagram .react-flow")
        ?.parentElement,
  );

  await settled(() => body!.querySelector(".react-flow__node"));

  // Eight lanes overflow sideways; ten steps stand taller than the page.
  expect(body!.scrollWidth).toBeGreaterThan(body!.clientWidth);
  expect(body!.clientHeight).toBeGreaterThan(700);
  expect(body!.scrollHeight).toBe(body!.clientHeight);
});
