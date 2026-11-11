import { describe, expect, it } from "vitest";

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

const heights = (entries: Record<string, number>) =>
  new Map(Object.entries(entries));

describe("stackNotes", () => {
  it("keeps notes level with their marks while they are apart", () => {
    const tops = stackNotes(
      [note("a", 0, 0), note("b", 1, 200)],
      heights({ a: 100, b: 50 }),
    );

    expect([...tops]).toEqual([
      ["a", 0],
      ["b", 200],
    ]);
  });

  it("pushes a note 8px under the one above it, down a chain", () => {
    const tops = stackNotes(
      [note("a", 0, 0), note("b", 1, 20), note("c", 2, 40)],
      heights({ a: 100, b: 60, c: 10 }),
    );

    expect(tops.get("b")).toBe(108);
    expect(tops.get("c")).toBe(176);
  });

  it("stacks margin and edge notes apart", () => {
    const tops = stackNotes(
      [
        note("a", 0, 0),
        note("b", 1, 10, { placement: "edge" }),
        note("c", 2, 20),
        note("d", 3, 30, { placement: "edge" }),
      ],
      heights({ a: 100, b: 40, c: 10, d: 10 }),
    );

    expect(tops.get("b")).toBe(10);
    expect(tops.get("c")).toBe(108);
    expect(tops.get("d")).toBe(58);
  });

  it("gives hidden and leaving notes no room", () => {
    const tops = stackNotes(
      [
        note("a", 0, 0, { shown: false }),
        note("b", 1, 10, { leaving: { top: 10, node: null } }),
        note("c", 2, 20),
      ],
      heights({ a: 100, b: 100, c: 10 }),
    );

    expect([...tops]).toEqual([["c", 20]]);
  });

  it("stacks in document order, not list order", () => {
    const tops = stackNotes(
      [note("below", 1, 10), note("above", 0, 0)],
      heights({ above: 50, below: 50 }),
    );

    expect(tops.get("above")).toBe(0);
    expect(tops.get("below")).toBe(58);
  });

  it("counts a note not yet measured as no height", () => {
    const tops = stackNotes([note("a", 0, 0), note("b", 1, 0)], heights({}));

    expect(tops.get("b")).toBe(8);
  });
});

describe("mergeNotes", () => {
  it("keeps a removed note, where it was drawn and in its place", () => {
    const before = [note("a", 0, 0), note("b", 1, 100), note("c", 2, 200)];
    const drawn = { top: 108, node: "B" };

    const after = mergeNotes(
      before,
      [note("a", 0, 0), note("c", 1, 200)],
      new Map([["b", drawn]]),
    );

    expect(after.map((each) => each.id)).toEqual(["a", "b", "c"]);
    expect(after[1]!.leaving).toBe(drawn);
    expect(after[2]!.leaving).toBeUndefined();
  });

  it("lays out again a note whose mark returns while it leaves", () => {
    const before = [note("a", 0, 0, { leaving: { top: 0, node: "A" } })];
    const after = mergeNotes(before, [note("a", 0, 30)], new Map());

    expect(after).toEqual([note("a", 0, 30)]);
  });

  it("drops a removed note that was never drawn", () => {
    expect(mergeNotes([note("a", 0, 0)], [], new Map())).toEqual([]);
  });

  it("appends a new note after those kept", () => {
    const after = mergeNotes(
      [note("b", 0, 100)],
      [note("a", 0, 0), note("b", 1, 100)],
      new Map(),
    );

    expect(after.map((each) => each.id)).toEqual(["b", "a"]);
  });

  it("returns the same list when nothing changed", () => {
    const leaving = { top: 5, node: "L" };
    const before = [note("a", 0, 0), note("gone", 1, 5, { leaving })];

    expect(mergeNotes(before, [note("a", 0, 0)], new Map())).toBe(before);
  });
});
