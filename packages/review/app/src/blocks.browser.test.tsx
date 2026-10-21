import {
  type JsonValue,
  type ReviewCanvasTutorialBridge,
  parseJsonText,
} from "@dev.fast/review-protocol";
import {
  FIXTURE_IMAGE_ID,
  FIXTURE_MAP_ID,
  FIXTURE_TRACE_EVENT_ID,
  FIXTURE_TRACE_ID,
} from "@review/fixtures/blocks/ids";
import { selectionKey } from "@review/lens-selection";
import {
  assignFreshIds,
  documentSchema,
  elements,
  isUnit,
} from "@review/review-api/document";
import type { ReviewProgress } from "@review/review-api/review-progress";
import type { Snapshot } from "@review/review-api/store";
import { defineSoftwareMap } from "@review/software-map-model";
import { type ReactNode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import tutorialDocument from "../../tutorial/document.json";
import {
  BlockErrorBoundary,
  type StoredBlock,
  blockComponents,
} from "./blocks";
import { mountReviewCanvas as mount } from "./desktop-entry";
import { fixtureReviewBridge, settled } from "./fixture-review-bridge";

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

const savedMap = parseJsonText(
  JSON.stringify({
    elements: model.elements,
    relationships: model.relationships,
    side: "head",
    commit: "head",
    countsByElementPath: {},
    unmappedByElementPath: {},
  }),
);

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
  tutorial: (c) =>
    has(c, ".tutorial-keymap-picker") &&
    has(c, '[data-tour-target="open-diff"]'),
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
  options: { trace?: null; document?: Snapshot["document"] } = {},
  tutorial?: ReviewCanvasTutorialBridge,
  shippedTutorial = false,
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
    document: shippedTutorial
      ? documentSchema.parse(tutorialDocument.document)
      : (options.document ?? fixtures.get(kind)!),
    origin: shippedTutorial ? { tutorial: true } : undefined,
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  if (shippedTutorial) {
    let nextId = 0;

    for (const block of snapshot.document)
      assignFreshIds(block, (prefix) => `${prefix}-${++nextId}`);
  }

  const image = { bytes: png, type: "image/png" };

  const bridge = fixtureReviewBridge({
    snapshot,
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
    files: [{ path: "a.ts", status: "modified", additions: 1, deletions: 0 }],
    resources:
      options.trace === null
        ? { [FIXTURE_IMAGE_ID]: image }
        : {
            [FIXTURE_IMAGE_ID]: image,
            [FIXTURE_TRACE_ID]: trace,
          },
    maps: { [FIXTURE_MAP_ID]: savedMap },
  });

  const request = vi.spyOn(bridge, "request");
  const container = document.createElement("div");

  if (hostStyle) container.style.cssText = hostStyle;
  document.body.append(container);
  await act(async () => {
    canvas = mount(container, {
      kind: "api",
      tutorial:
        tutorial ??
        (kind === "tutorial"
          ? {
              content: {
                reviewUuid: snapshot.reviewId,
                progress: { version: 1, checked: [], dismissed: false },
                keymap: "none",
              },
              setStep() {},
              dismiss() {},
              reopen() {},
              async selectKeymap() {},
              close() {},
            }
          : undefined),
      softwareMapEnabled: true,
      reviewId: snapshot.reviewId,
      version: 0,
      bridge,
    });
  });

  return { container, snapshot, request };
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

      const { container, request } = await mountFixture(kind, {
        document: documentBlocks,
      });

      expect(
        await settled(() => container.querySelector(selector) !== null),
      ).toBe(true);
      const selected = container.querySelector(selector)!;

      const quote =
        kind === "code" || kind === "markdown" ? code : selected.textContent!;

      request.mockClear();
      request.mockResolvedValueOnce(Response.json({ text: `> ${quote}` }));

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
        request.mockRestore();
        write.mockRestore();
      }
    },
  );

  it("keeps shipped tutorial keybindings and view buttons interactive in the JSON canvas", async () => {
    const selectKeymap = vi.fn<ReviewCanvasTutorialBridge["selectKeymap"]>(
      async () => {},
    );

    const tutorial: ReviewCanvasTutorialBridge = {
      content: {
        reviewUuid: "fixture-tutorial",
        progress: { version: 1, checked: [], dismissed: true },
        keymap: "none",
      },
      setStep() {},
      dismiss() {},
      reopen() {},
      selectKeymap,
      close() {},
    };

    const { container } = await mountFixture("tutorial", {}, tutorial, true);
    expect(
      await settled(
        () =>
          has(container, ".tutorial-keymap-picker") &&
          has(container, '[data-tour-target="open-diff"]'),
      ),
    ).toBe(true);

    const vim = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".tutorial-keymap-picker button",
      ),
    ].find((button) => button.textContent === "Vim")!;

    expect(vim.disabled).toBe(false);
    await act(async () => vim.click());
    expect(selectKeymap).toHaveBeenCalledWith("vim");

    const diff = container.querySelector<HTMLButtonElement>(
      '[data-tour-target="open-diff"]',
    )!;

    expect(diff).not.toBeNull();
    await act(async () => diff.click());
    expect(
      container
        .querySelector('[aria-label="Diff"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

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
          ? ".sequence-diagram .react-flow__node span[title]"
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

    await settled(() => container.querySelector("iframe"));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Next frame']")!
        .click(),
    );
    expect(
      await settled(() =>
        container.querySelector<HTMLElement>("[data-animation-slot='code']")
          ?.style.width === "200px"
          ? true
          : undefined,
      ),
    ).toBe(true);
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

describe("tutorial guide placement", () => {
  it("keeps the guide inside the host when status rows sit above the document", async () => {
    const tutorial: ReviewCanvasTutorialBridge = {
      content: {
        reviewUuid: "fixture-tutorial",
        progress: { version: 1, checked: [], dismissed: false },
        keymap: "none",
      },
      setStep() {},
      dismiss() {},
      reopen() {},
      async selectKeymap() {},
      close() {},
    };

    const { container } = await mountFixture(
      "tutorial",
      {},
      tutorial,
      true,
      "position: relative; height: 700px; overflow: hidden;",
    );

    expect(
      await settled(() => has(container, 'aside[aria-label="Tutorial guide"]')),
    ).toBe(true);

    const contentsElement = container.querySelector("#review-toc")!;
    const appElement = container.querySelector(".review-app")!;

    const contentsOffset =
      contentsElement.getBoundingClientRect().top -
      appElement.getBoundingClientRect().top;

    const statusRow = document.createElement("p");
    statusRow.setAttribute("role", "status");
    statusRow.textContent = "Refresh failed; showing the last saved review.";
    statusRow.style.minHeight = "200px";
    container.querySelector("[data-review-api]")!.prepend(statusRow);

    const host = container.getBoundingClientRect();
    const app = container.querySelector(".review-app")!.getBoundingClientRect();
    const status = statusRow.getBoundingClientRect();

    const contents = container
      .querySelector("#review-toc")!
      .getBoundingClientRect();

    const guide = container
      .querySelector('aside[aria-label="Tutorial guide"]')!
      .getBoundingClientRect();

    expect(app.bottom).toBeLessThanOrEqual(host.bottom);
    expect(app.top).toBeGreaterThanOrEqual(status.bottom);
    expect(contents.top).toBeGreaterThanOrEqual(app.top);
    expect(contents.top - app.top).toBeCloseTo(contentsOffset);
    expect(guide.top).toBeGreaterThanOrEqual(host.top);
    expect(guide.bottom).toBeLessThanOrEqual(host.bottom);
  });
});

it("opens a flow node in a full-screen tour with all its code attachments", async () => {
  const { container } = await mountFixture("flow_diagram");
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
    undefined,
    false,
    "position: relative; height: 700px; overflow: hidden",
  );

  const body = await settled(
    () =>
      container.querySelector<HTMLElement>(".sequence-diagram .react-flow")
        ?.parentElement,
  );

  await settled(() => body!.querySelector(".react-flow__node"));

  // Eight lanes overflow sideways; ten steps stand 914px tall.
  expect(body!.scrollWidth).toBeGreaterThan(body!.clientWidth);
  expect(body!.clientHeight).toBeGreaterThanOrEqual(914);
  expect(body!.scrollHeight).toBe(body!.clientHeight);
});
