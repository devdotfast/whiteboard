import { expect, it } from "vitest";

import { type Note, mergeNotes, stackNotes } from "./host-passages";

const note = (id: string, order: number, top: number, more?: Partial<Note>) =>
  ({
    id,
    order,
    top,
    left: 800,
    placement: "margin",
    shown: true,
    ...more,
  }) satisfies Note;

it("stacks notes 8px under the one above, in document order, past hidden and leaving ones", () => {
  const tops = stackNotes(
    [
      note("c", 3, 40),
      note("hidden", 1, 10, { shown: false }),
      note("a", 0, 0),
      note("leaving", 2, 15, { leaving: { top: 15, node: null } }),
      note("b", 2, 20),
      note("far", 4, 500),
    ],
    new Map([
      ["a", 100],
      ["hidden", 300],
      ["leaving", 300],
      ["b", 60],
      ["c", 10],
    ]),
  );

  expect(Object.fromEntries(tops)).toEqual({ a: 0, b: 108, c: 176, far: 500 });
});

it("stacks margin and edge notes apart", () => {
  const tops = stackNotes(
    [
      note("a", 0, 0),
      note("b", 1, 10, { placement: "edge" }),
      note("c", 2, 20),
      note("d", 3, 30, { placement: "edge" }),
    ],
    new Map([
      ["a", 100],
      ["b", 40],
    ]),
  );

  expect(Object.fromEntries(tops)).toEqual({ a: 0, b: 10, c: 108, d: 58 });
});

it("keeps a removed note where it was drawn, in its place, if it was drawn", () => {
  const drawn = { top: 108, node: "B" };

  const after = mergeNotes(
    [note("a", 0, 0), note("b", 1, 100), note("c", 2, 200), note("d", 3, 300)],
    [note("a", 0, 0), note("c", 1, 200)],
    new Map([["b", drawn]]),
  );

  expect(after.map(({ id, leaving }) => [id, leaving])).toEqual([
    ["a", undefined],
    ["b", drawn],
    ["c", undefined],
  ]);
});
