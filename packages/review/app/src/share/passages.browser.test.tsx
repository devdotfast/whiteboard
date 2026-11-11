import type { SelectedPassage } from "@canvas/host-passages";
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

const mount = async (options: Parameters<typeof readOnlyHost>[0]) => {
  const container = document.body.appendChild(document.createElement("div"));

  host = readOnlyHost(options);
  await act(async () => {
    canvas = mountWhiteboard(container, boardView(board()), { host });
  });
  await settled(() => container.textContent?.includes(TEXT));

  return container;
};

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

  await act(async () =>
    host!.setMarks([
      { id: "one", anchor: anchor("rail") },
      { id: "two", anchor: anchor("every change"), active: true },
      { id: "gone", anchor: { ...anchor("rail"), blockId: "missing" } },
    ]),
  );
  await settled(() => washed("host-passage").length);
  expect(washed("host-passage")).toEqual(["rail"]);
  expect(washed("host-passage-active")).toEqual(["every change"]);
  expect(lost).toHaveBeenLastCalledWith(["gone"]);

  await act(async () => host!.setMarks([]));
  await settled(() => !washed("host-passage").length);
  expect(washed("host-passage-active")).toEqual([]);
  expect(container.textContent).toContain(TEXT);
});

it("keeps a mark on its words after an edit ahead of them", async () => {
  const container = await mount({});

  await act(async () =>
    host!.setMarks([{ id: "one", anchor: anchor("ticks") }]),
  );
  await settled(() => washed("host-passage").length);

  const edited = `Now ${TEXT}`;

  await act(async () =>
    canvas!.update(boardView({ ...board(edited), version: 2 })),
  );
  await settled(() => container.textContent?.includes(edited));
  await settled(() => washed("host-passage")[0] === "ticks");
  expect(washed("host-passage")).toEqual(["ticks"]);
});

it("tells the host of a plain click on marked words", async () => {
  const clicked = vi.fn<(ids: string[]) => void>();
  const container = await mount({ onMarkClick: clicked });

  await act(async () =>
    host!.setMarks([{ id: "one", anchor: anchor("rail") }]),
  );
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

  await act(async () =>
    host!.setMarks([
      { id: "one", anchor: anchor("rail") },
      { id: "gone", anchor: { ...anchor("rail"), blockId: "missing" } },
    ]),
  );
  await settled(() => notes().length);
  expect(notes().map((note) => note.textContent)).toEqual(["A thread on one"]);

  const note = notes()[0]!;
  const words = block(container).getBoundingClientRect();

  expect(note.getBoundingClientRect().left).toBeGreaterThan(words.left);
  expect(note.getBoundingClientRect().top).toBeGreaterThanOrEqual(words.top);
  expect(note.getBoundingClientRect().top).toBeLessThan(words.bottom);

  await act(async () => host!.setMarks([]));
  await settled(() => !notes().length);
});
