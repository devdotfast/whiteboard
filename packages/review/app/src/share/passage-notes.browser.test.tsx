import { type Passages, layOutNotes, mergeNotes } from "@canvas/host-passages";
import { mountWhiteboard, settled } from "@canvas/whiteboard-fixture";
import { act } from "react";
import { afterEach, expect, it } from "vitest";

import { boardView } from "./board-data";
import { type ShareHost, readOnlyHost } from "./share-host";

const PROSE = "The rail draws ticks for every change.";

const prose = (id = "a", text = PROSE) => ({
  id,
  type: "markdown",
  markdown: text,
});

const anchor = (blockId: string, quote: string, text = PROSE) => ({
  blockId,
  start: text.indexOf(quote),
  end: text.indexOf(quote) + quote.length,
  text,
});

let canvas: ReturnType<typeof mountWhiteboard> | undefined;

let host: ShareHost | undefined;

let frozen: HTMLStyleElement | undefined;

afterEach(async () => {
  await act(async () => canvas?.dispose());
  canvas = undefined;
  host?.dispose();
  frozen?.remove();
  frozen = undefined;
  document.body.replaceChildren();
});

/** Every transition done at once: layout is read at rest. */
function freezeTransitions() {
  frozen = document.head.appendChild(document.createElement("style"));
  frozen.textContent =
    "*, *::before, *::after { transition: none !important; }";
}

const frames = async (count = 4) => {
  for (let index = 0; index < count; index++)
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
};

/** A board in a region `width` wide, its passages swappable. */
async function open(
  document_: readonly unknown[],
  width: number,
  passages: Passages,
) {
  const container = document.body.appendChild(document.createElement("div"));

  const data = boardView({
    reviewId: "notes",
    version: 1,
    title: "Notes",
    createdAt: "2026-11-10T00:00:00.000Z",
    document: document_,
  });

  container.style.width = `${width}px`;
  host = readOnlyHost();
  await act(async () => {
    canvas = mountWhiteboard(container, data, { host, passages });
  });
  await settled(() => container.textContent?.includes("Notes"));

  let shown = passages;

  const view = {
    container,
    get article() {
      return container.querySelector<HTMLElement>(".review-document")!;
    },
    get region() {
      return container.querySelector<HTMLElement>(".review-view-region")!;
    },
    notes: () => [
      ...container.querySelectorAll<HTMLElement>("[data-passage-note]"),
    ],
    note: (id: string) =>
      container.querySelector<HTMLElement>(`[data-passage-note="${id}"]`),
    block: (id: string) =>
      container.querySelector<HTMLElement>(`[data-review-node-id="${id}"]`)!,
    async resize(next: number) {
      container.style.width = `${next}px`;
      await frames();
    },
    async pass(next: Partial<Passages>) {
      shown = { ...shown, ...next };
      await act(async () => canvas!.update(data, shown));
      await frames();
    },
  };

  return view;
}

type View = Awaited<ReturnType<typeof open>>;

const slid = (view: View) =>
  Number.parseFloat(getComputedStyle(view.article).translate) || 0;

/** The region's content box, and how far notes keep from its right. */
function edges(view: View) {
  const { region } = view;
  const box = region.getBoundingClientRect();
  const style = getComputedStyle(region);
  const left = box.left + region.clientLeft;

  return {
    content: left + Number.parseFloat(style.paddingLeft),
    right: left + region.clientWidth,
    inset: Math.max(
      16,
      Number.parseFloat(style.getPropertyValue("--review-rail-gutter")) || 0,
    ),
  };
}

/** What the article draws, found without the canvas's help: text, and boxes
 * that paint a background, a border or a graphic. */
function contentBoxes(article: HTMLElement): DOMRect[] {
  const skip = "[data-passage-notes], [data-ask-pins]";
  const boxes: DOMRect[] = [];
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const range = document.createRange();

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim() || node.parentElement?.closest(skip))
      continue;
    range.selectNodeContents(node);
    boxes.push(...range.getClientRects());
  }

  for (const element of article.querySelectorAll<Element>("*")) {
    if (element.closest(skip)) continue;
    const style = getComputedStyle(element);

    const paints =
      element instanceof SVGSVGElement ||
      element instanceof HTMLImageElement ||
      element instanceof HTMLCanvasElement ||
      style.backgroundColor !== "rgba(0, 0, 0, 0)" ||
      Number.parseFloat(style.borderLeftWidth) > 0;

    if (!paints || style.visibility === "hidden") continue;
    const box = element.getBoundingClientRect();

    if (box.width && box.height) boxes.push(box);
  }

  return boxes.filter((box) => box.width > 0 && box.height > 0);
}

const contentLeft = (view: View) =>
  Math.min(...contentBoxes(view.article).map((box) => box.left));

/** The first line of the marked `quote`, where its note should sit. */
const markTop = (quote: string) => {
  const ranges = [...(CSS.highlights.get("host-passage") ?? [])] as Range[];

  return ranges.find((range) => String(range) === quote)!.getClientRects()[0]!
    .top;
};

/** What a reader sees of the margin at one width, each fact true. */
function seeMargin(view: View) {
  const note = view.notes()[0]!;
  const box = note.getBoundingClientRect();
  const { content, right, inset } = edges(view);
  const placement = note.dataset.placement;
  const shift = slid(view);
  const margin = placement === "margin";

  const proseRight = view
    .block("a")
    .querySelector("p")!
    .getBoundingClientRect().right;

  const width = view.region.clientWidth;

  const facts = {
    width,
    placed: placement === "margin" || placement === "edge",
    unscrolled: view.region.scrollWidth <= view.region.clientWidth,
    inside: !margin || box.right <= right - inset + 0.5,
    clearOfProse: !margin || box.left >= proseRight + 31,
    edgeUnslid: margin || shift === 0,
    // Slid no further than the note needs, and never past the content.
    slidAsNeeded: !shift || Math.abs(box.right - (right - inset)) <= 1,
    contentClear: !shift || contentLeft(view) >= content + 23.5,
  };

  expect(facts).toEqual({
    width,
    placed: true,
    unscrolled: true,
    inside: true,
    clearOfProse: true,
    edgeUnslid: true,
    slidAsNeeded: true,
    contentClear: true,
  });

  return { placement, shift };
}

const textNote: Passages["renderMarkNote"] = (id) => `A thread on ${id}`;

it("keeps every invariant of the margin from 600px to 1700px", async () => {
  freezeTransitions();

  let asked: string | undefined;

  const view = await open([prose()], 600, {
    renderMarkNote: (id, { placement }) => {
      asked = placement;

      return id;
    },
    marks: [{ id: "one", anchor: anchor("a", "rail") }],
  });

  await settled(() => view.notes().length);

  const seen: { width: number; placement?: string; shift: number }[] = [];

  for (let width = 600; width <= 1700; width += 50) {
    await view.resize(width);

    const at = seeMargin(view);

    expect(asked).toBe(at.placement);
    seen.push({ width, ...at });
  }

  const edge = seen.filter((at) => at.placement === "edge");
  const margin = seen.filter((at) => at.placement === "margin");

  expect(edge.length).toBeGreaterThan(0);
  expect(margin.length).toBeGreaterThan(0);
  // Edge below some width, margin above it: never back and forth.
  expect(Math.max(...edge.map((at) => at.width))).toBeLessThan(
    Math.min(...margin.map((at) => at.width)),
  );

  // Wider, the slide only shrinks, to none.
  const shifts = margin.map((at) => Math.abs(at.shift));

  expect(shifts).toEqual([...shifts].sort((a, b) => b - a));
  expect(shifts.at(-1)).toBe(0);
  expect(shifts[0]).toBeGreaterThan(0);
});

const md = (id: string, markdown: string) => ({
  id,
  type: "markdown",
  markdown,
});

const BOARDS = {
  code: [prose(), md("x", "```ts\nconst answer = 42;\n```")],
  table: [prose(), md("x", "| a | b |\n|---|---|\n| 1 | 2 |")],
  list: [prose(), md("x", "- one\n- two\n  - nested")],
  quote: [prose(), md("x", "> quoted at length")],
  section: [
    prose(),
    {
      id: "s",
      type: "section",
      title: "Implementation",
      children: [md("s1", "## Details\n\nNested text")],
    },
  ],
  sequence: [
    prose(),
    {
      id: "q",
      type: "sequence",
      title: "Renewal",
      actors: { a: "Agent", s: "Server" },
      steps: [
        {
          id: "st1",
          type: "step",
          from: "a",
          to: "s",
          label: "renew",
          explanation: "Fresh expiry.",
        },
      ],
    },
  ],
} satisfies Record<string, readonly unknown[]>;

it("slides no block's content nearer than 24px to the region's left", async () => {
  freezeTransitions();

  for (const [name, board] of Object.entries(BOARDS)) {
    const view = await open(board, 1100, {
      renderMarkNote: textNote,
      marks: [{ id: "one", anchor: anchor("a", "rail") }],
    });

    await settled(() => view.notes().length);
    let slidAt = 0;

    for (let width = 1100; width <= 1500; width += 40) {
      await view.resize(width);
      seeMargin(view);

      if (slid(view) && !slidAt) slidAt = width;
    }

    expect({ name, slid: slidAt > 0 }).toEqual({ name, slid: true });
    await act(async () => canvas?.dispose());
    canvas = undefined;
    document.body.replaceChildren();
  }
});

it("lays out the same mid-slide as at rest, and again changes nothing", async () => {
  const view = await open([prose()], 1280, {
    renderMarkNote: textNote,
  });

  const placed = () => {
    const [range] = [...(CSS.highlights.get("host-passage") ?? [])] as Range[];

    return new Map([["one", { range: range!, block: view.block("a") }]]);
  };

  const probe = () =>
    view.container.querySelector<HTMLElement>("[data-passage-notes] > span")!;

  // As numbers: a subpixel either side of zero rounds to -0 or 0.
  const layOut = () =>
    JSON.parse(
      JSON.stringify(
        layOutNotes(view.article, view.region, probe().offsetLeft, placed()),
      ),
    ) as ReturnType<typeof layOutNotes>;

  const during: { at: number; laid: ReturnType<typeof layOutNotes> }[] = [];
  let sampling = true;

  const sample = () => {
    if (!sampling) return;

    if (CSS.highlights.get("host-passage")?.size)
      during.push({ at: slid(view), laid: layOut() });
    requestAnimationFrame(sample);
  };

  requestAnimationFrame(sample);
  await view.pass({ marks: [{ id: "one", anchor: anchor("a", "rail") }] });
  await settled(() => {
    const shift = Number.parseFloat(view.article.style.translate);

    return shift && slid(view) === shift;
  });
  await frames();
  sampling = false;

  const rest = layOut();

  expect(rest.shift).toBeGreaterThan(0);
  expect(slid(view)).toBe(-rest.shift);
  // Some samples caught the article between home and its place.
  expect(during.some(({ at }) => at < 0 && at > -rest.shift)).toBe(true);

  for (const { at, laid } of during)
    expect({ at, ...laid }).toEqual({ at, ...rest });

  // A translate held still anywhere gives the same answer.
  freezeTransitions();

  for (const at of [0, -17, -rest.shift / 2, -rest.shift - 40]) {
    view.article.style.translate = `${at}px`;
    expect(layOut()).toEqual(rest);
  }

  view.article.style.translate = `${-rest.shift}px`;

  const again = layOut();

  expect(again).toEqual(rest);
  expect(mergeNotes(rest.notes, again.notes, new Map())).toBe(rest.notes);
});

it("hides a collapsed section's note, and the next note moves up", async () => {
  freezeTransitions();

  const tall: Passages["renderMarkNote"] = (id) => (
    <div style={{ height: 400 }}>{id}</div>
  );

  const view = await open(
    [
      prose(),
      {
        id: "s",
        type: "section",
        title: "Implementation",
        children: [prose("s1", "Inside the section.")],
      },
      prose("b", "After the section."),
    ],
    1500,
    {
      renderMarkNote: tall,
      marks: [
        { id: "in", anchor: anchor("s1", "Inside", "Inside the section.") },
        { id: "after", anchor: anchor("b", "After", "After the section.") },
      ],
    },
  );

  const top = (id: string) => view.note(id)!.getBoundingClientRect().top;
  const visible = (id: string) => view.note(id)!.checkVisibility();

  await settled(() => view.notes().length === 2 && visible("after"));
  await frames();
  expect(top("after")).toBeGreaterThan(top("in") + 400);

  const toggle = () =>
    act(async () =>
      view.container
        .querySelector<HTMLButtonElement>(
          "section.review-section button[aria-expanded]",
        )!
        .click(),
    );

  await toggle();
  await settled(() => !visible("in"));
  await frames();
  expect(visible("in")).toBe(false);
  expect(top("after")).toBeCloseTo(markTop("After"), -0.5);

  await toggle();
  await settled(() => visible("in"));
  await frames();
  expect(top("in")).toBeCloseTo(markTop("Inside"), -0.5);
  expect(top("after")).toBeGreaterThan(top("in") + 400);
});

it("stacks notes 8px apart as they grow, and closes up as one goes", async () => {
  freezeTransitions();

  const heights = new Map([
    ["one", 60],
    ["two", 40],
  ]);

  const sized = (): Passages["renderMarkNote"] => (id) => (
    <div style={{ height: heights.get(id) }}>{id}</div>
  );

  const view = await open([prose()], 1320, {
    renderMarkNote: sized(),
    marks: [
      { id: "one", anchor: anchor("a", "rail") },
      { id: "two", anchor: anchor("a", "ticks") },
    ],
  });

  const box = (id: string) => view.note(id)!.getBoundingClientRect();
  const gap = () => box("two").top - box("one").bottom;

  await settled(() => view.notes().length === 2 && Math.abs(gap() - 8) < 0.5);
  expect(gap()).toBeCloseTo(8, 0);

  const before = box("two").top;

  heights.set("one", 200);
  await view.pass({ renderMarkNote: sized() });
  await settled(() => box("one").height === 200);
  expect(gap()).toBeCloseTo(8, 0);
  expect(box("two").top).toBeCloseTo(before + 140, 0);

  await view.pass({ marks: [{ id: "two", anchor: anchor("a", "ticks") }] });
  expect(view.note("one")?.inert).toBe(true);
  await settled(() => !view.note("one"));
  expect(box("two").top).toBeCloseTo(markTop("ticks"), -0.5);

  await view.pass({ marks: [] });
  await settled(() => !view.notes().length && !view.article.style.translate);
  expect(getComputedStyle(view.article).translate).toBe("none");
});

it("never moves the article without renderMarkNote, at any width", async () => {
  const view = await open([prose()], 600, {
    marks: [{ id: "one", anchor: anchor("a", "rail") }],
  });

  const style = view.article.getAttribute("style");

  for (let width = 600; width <= 1700; width += 100) {
    await view.resize(width);
    expect(view.article.getAttribute("style")).toBe(style);
    expect(getComputedStyle(view.article).translate).toBe("none");
  }
});
