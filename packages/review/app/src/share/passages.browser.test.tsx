import type { Passages, SelectedPassage } from "@canvas/host-passages";
import { mountWhiteboard, settled } from "@canvas/whiteboard-fixture";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { type BoardSnapshot, boardView } from "./board-data";
import { type ShareHost, readOnlyHost } from "./share-host";

const TEXT = "The rail draws ticks for every change.";

const board = (markdown = TEXT): BoardSnapshot => ({
  reviewId: "passages",
  version: 1,
  title: "Passages",
  createdAt: "2026-11-10T00:00:00.000Z",
  document: [{ id: "a", type: "markdown", markdown }],
});

const anchor = (quote: string, text = TEXT) => ({
  blockId: "a",
  start: text.indexOf(quote),
  end: text.indexOf(quote) + quote.length,
  text,
});

let canvas: ReturnType<typeof mountWhiteboard> | undefined;

let host: ShareHost | undefined;

afterEach(async () => {
  await act(async () => canvas?.dispose());
  canvas = undefined;
  host?.dispose();
  document.body.replaceChildren();
});

let passages: Passages = {};

const mount = async (given: Passages, width?: number) => {
  const container = document.body.appendChild(document.createElement("div"));

  if (width) container.style.width = `${width}px`;

  host = readOnlyHost();
  passages = given;
  await act(async () => {
    canvas = mountWhiteboard(container, boardView(board()), { host, passages });
  });
  await settled(() => container.textContent?.includes(TEXT));

  return container;
};

const setMarks = (marks: Passages["marks"], data = boardView(board())) =>
  act(async () => canvas!.update(data, (passages = { ...passages, marks })));

const washed = (name: string) =>
  [...(CSS.highlights.get(name) ?? [])].map((range) => String(range));

const block = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-review-node-id="a"]')!;

async function selectWords(container: HTMLElement, quote: string) {
  const walker = document.createTreeWalker(
    block(container),
    NodeFilter.SHOW_TEXT,
  );

  let node = walker.nextNode() as Text | null;

  while (node && !node.data.includes(quote)) node = walker.nextNode() as Text;
  const range = document.createRange();

  range.setStart(node!, node!.data.indexOf(quote));
  range.setEnd(node!, node!.data.indexOf(quote) + quote.length);

  await act(async () => {
    const selection = document.getSelection()!;

    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.trim() === name ||
      element.getAttribute("aria-label") === name,
  );

it("offers the host's actions with the passage, and can leave Copy ref off", async () => {
  const picked = vi.fn<(passage: SelectedPassage) => void>();

  const container = await mount({
    copyRef: false,
    selectionActions: [{ label: "Comment", onSelect: picked }],
  });

  await selectWords(container, "draws ticks");
  await settled(() => button(container, "Comment"));
  expect(button(container, "Copy ref")).toBeUndefined();

  await act(async () => button(container, "Comment")!.click());
  expect(picked).toHaveBeenCalledWith({
    anchor: anchor("draws ticks"),
    quote: "draws ticks",
  });
  expect(button(container, "Comment")).toBeUndefined();
});

it("washes the host's marks, the active one apart, and names the lost", async () => {
  const lost = vi.fn<(ids: string[]) => void>();
  const container = await mount({ onMarksResolved: lost });

  await setMarks([
    { id: "one", anchor: anchor("rail") },
    { id: "two", anchor: anchor("every change"), active: true },
    { id: "gone", anchor: { ...anchor("rail"), blockId: "missing" } },
  ]);
  await settled(() => washed("host-passage").length);
  expect(washed("host-passage")).toEqual(["rail"]);
  expect(washed("host-passage-active")).toEqual(["every change"]);
  expect(lost).toHaveBeenLastCalledWith(["gone"]);

  await setMarks([]);
  await settled(() => !washed("host-passage").length);
  expect(washed("host-passage-active")).toEqual([]);
  expect(container.textContent).toContain(TEXT);
});

it("keeps a mark on its words after an edit ahead of them", async () => {
  const container = await mount({});

  await setMarks([{ id: "one", anchor: anchor("ticks") }]);
  await settled(() => washed("host-passage").length);

  const edited = `Now ${TEXT}`;

  await act(async () =>
    canvas!.update(boardView({ ...board(edited), version: 2 }), passages),
  );
  await settled(() => container.textContent?.includes(edited));
  await settled(() => washed("host-passage")[0] === "ticks");
  expect(washed("host-passage")).toEqual(["ticks"]);
});

it("tells the host of a plain click on marked words", async () => {
  const clicked = vi.fn<(ids: string[]) => void>();
  const container = await mount({ onMarkClick: clicked });

  await setMarks([{ id: "one", anchor: anchor("rail") }]);
  await settled(() => washed("host-passage").length);

  const [words] = CSS.highlights.get("host-passage")!;
  // SAFETY: the canvas washes live Ranges.
  const rect = (words as Range).getBoundingClientRect();

  const at = {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    bubbles: true,
    button: 0,
    detail: 1,
  };

  const target = block(container);

  await act(async () => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", { ...at, isPrimary: true }),
    );
    target.dispatchEvent(new MouseEvent("click", at));
  });
  expect(clicked).toHaveBeenCalledWith(["one"]);
});

it("draws the host's note in the margin beside each placed mark", async () => {
  const container = await mount({
    renderMarkNote: (id) => `A thread on ${id}`,
  });

  const notes = () => [
    ...container.querySelectorAll<HTMLElement>("[data-passage-note]"),
  ];

  await setMarks([
    { id: "one", anchor: anchor("rail") },
    { id: "gone", anchor: { ...anchor("rail"), blockId: "missing" } },
  ]);
  await settled(() => notes().length);
  expect(notes().map((note) => note.textContent)).toEqual(["A thread on one"]);

  const note = notes()[0]!;
  const words = block(container).getBoundingClientRect();

  expect(note.getBoundingClientRect().left).toBeGreaterThan(words.left);
  expect(note.getBoundingClientRect().top).toBeGreaterThanOrEqual(words.top);
  expect(note.getBoundingClientRect().top).toBeLessThan(words.bottom);

  await setMarks([]);
  await settled(() => !notes().length);
});

const notes = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>("[data-passage-note]"),
];

const article = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".review-document")!;

const region = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".review-view-region")!;

const slid = (container: HTMLElement) =>
  Number.parseFloat(getComputedStyle(article(container)).translate) || 0;

it("slides the document left until the margin's note fits, and back", async () => {
  const drawn = vi.fn<NonNullable<Passages["renderMarkNote"]>>(
    (id) => `A thread on ${id}`,
  );

  const container = await mount({ renderMarkNote: drawn }, 1360);
  const before = article(container).getBoundingClientRect().left;

  await setMarks([{ id: "one", anchor: anchor("rail") }]);

  const fits = () => {
    const note = notes(container)[0]?.getBoundingClientRect();
    const edge = region(container).getBoundingClientRect();

    return note && note.right <= edge.right - 15 && note.left >= edge.left;
  };

  await settled(() => fits() && slid(container) < 0);
  expect(fits()).toBe(true);
  expect(drawn).toHaveBeenLastCalledWith("one", { placement: "margin" });
  expect(article(container).getBoundingClientRect().left).toBeLessThan(before);

  await setMarks([]);
  await settled(() => !notes(container).length && !slid(container));
  expect(notes(container)).toEqual([]);
  await settled(() => !article(container).style.translate);
  expect(getComputedStyle(article(container)).translate).toBe("none");
});

it("leaves the document alone without notes to draw", async () => {
  const container = await mount({});
  const style = article(container).getAttribute("style");

  await setMarks([{ id: "one", anchor: anchor("rail") }]);
  await settled(() => washed("host-passage").length);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(article(container).getAttribute("style")).toBe(style);
  expect(getComputedStyle(article(container)).translate).toBe("none");
});

it("stacks a note under the one above it, and moves it as that grows", async () => {
  const heights = new Map([
    ["one", 60],
    ["two", 40],
  ]);

  const drawn: Passages = {
    renderMarkNote: (id) => <div style={{ height: heights.get(id) }} />,
  };

  const container = await mount(drawn);

  await setMarks([
    { id: "one", anchor: anchor("rail") },
    { id: "two", anchor: anchor("ticks") },
  ]);

  const gap = () => {
    const [one, two] = notes(container).map((note) =>
      note.getBoundingClientRect(),
    );

    return one && two ? two.top - one.bottom : NaN;
  };

  await settled(() => Math.abs(gap() - 8) < 0.5);
  expect(gap()).toBeCloseTo(8, 0);

  const [one, two] = notes(container);
  const top = two!.getBoundingClientRect().top;

  heights.set("one", 200);
  await act(async () =>
    canvas!.update(boardView(board()), (passages = { ...passages })),
  );
  await settled(() => Math.abs(gap() - 8) < 0.5 && one!.offsetHeight === 200);
  expect(gap()).toBeCloseTo(8, 0);
  expect(two!.getBoundingClientRect().top).toBeCloseTo(top + 140, 0);
});

it("draws a note at the edge where the margin has no room", async () => {
  const drawn = vi.fn<NonNullable<Passages["renderMarkNote"]>>(
    (id) => `A thread on ${id}`,
  );

  const container = await mount({ renderMarkNote: drawn }, 800);

  await setMarks([{ id: "one", anchor: anchor("rail") }]);
  await settled(() => notes(container).length);
  expect(notes(container)[0]!.dataset.placement).toBe("edge");
  expect(drawn).toHaveBeenLastCalledWith("one", { placement: "edge" });
  expect(slid(container)).toBe(0);
});
