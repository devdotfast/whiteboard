import { expect, test } from "bun:test";
import { createGuideDiffFile, startFor } from "./protocol/fixture";
import { DiffStore } from "./protocol/store";
import { visibleRows } from "./viewport/geometry";
import { dark } from "./theme/themes";
import { Viewer, type KeyPress } from "./viewer";

/** The guide file: `log();` and `keep();` sit in a folded gap, `one();` and `two();` in a folded body. */
function open() {
  const store = new DiffStore(), file = createGuideDiffFile();
  store.accept(startFor([file]));
  store.accept(file);
  const viewer = new Viewer(store, dark, 100);
  viewer.lay({ columns: 160, rows: 4 });
  const type = (...keys: string[]) => keys.forEach((key) => viewer.press({ key } satisfies KeyPress));
  const top = () => {
    const at = viewer.lay({ columns: 160, rows: 4 });
    return visibleRows(at.geometry, at.top, 1)[0]!.row;
  };
  const shown = () => viewer.lay({ columns: 160, rows: 4 }).rows;
  return { viewer, type, top, shown };
}

test("/ opens a prompt that takes every key, counts as it goes, and Enter lands on the first match", () => {
  const { viewer, type, top } = open();
  type("/", "k", "e", "e", "p");
  expect(viewer.prompting).toBe(true);
  // Split view: the line is on both sides, so two matches.
  expect(viewer.searchState()).toEqual({ prompt: "keep", count: 2 });
  type("return");
  expect(viewer.prompting).toBe(false);
  expect(viewer.searchState()).toEqual({ pattern: "keep", at: 1, total: 2, files: 1 });
  // The match was in a folded gap: landing on it opens the gap and puts its row on top.
  expect(top().left?.lineNumber).toBe(7);
  // The match the view is on is solid; the same word on the other side is only washed.
  const litBg = (spans: { text: string; bg?: string }[]) => spans.filter((span) => span.text === "keep").map((span) => span.bg);
  expect(litBg(top().left!.spans)).toEqual([dark.searchCurrent]);
  expect(litBg(top().right!.spans)).toEqual([dark.searchMatch]);
});

test("of several matches on one line, only the one the view is on is solid, in a different hue from the rest", () => {
  const { viewer, type, top } = open();
  expect(dark.searchCurrent).not.toBe(dark.searchMatch);
  // `if event.open {` has three e's: two in `event`, one in `open`.
  type("/", "e", "v", "e", "n", "t", "return");
  type("/", "e", "return");
  // Split view reads the left side first, so the walk reaches the line's left copy first.
  const line = () => top().left!.spans;
  while (!line().map((span) => span.text).join("").includes("if event.open")) type("n");
  const lit = () => line().filter((span) => span.lit).map((span) => span.bg);
  expect(lit()).toEqual([dark.searchCurrent, dark.searchMatch, dark.searchMatch]);
  type("n");
  expect(lit()).toEqual([dark.searchMatch, dark.searchCurrent, dark.searchMatch]);
});

test("n opens the fold hiding the next match, and N walks back, wrapping at either end", () => {
  const { viewer, type, top, shown } = open();
  expect(shown().some((row) => row.right?.spans.map((span) => span.text).join("").includes("two();"))).toBe(false);
  type("/", "t", "w", "o", "(", "return");
  expect(viewer.searchState()).toMatchObject({ at: 1, total: 2 });
  expect(top().right?.lineNumber).toBe(12);
  expect(shown().some((row) => row.right?.spans.map((span) => span.text).join("").includes("two();"))).toBe(true);
  type("n");
  expect(viewer.searchState()).toMatchObject({ at: 2 });
  type("n");
  expect(viewer.searchState()).toMatchObject({ at: 1 });
  type("N");
  expect(viewer.searchState()).toMatchObject({ at: 2 });
});

test("file paths are searched too, and a capital makes the pattern match case", () => {
  const { viewer, type, top } = open();
  type("/", "d", "e", "m", "o", "return");
  expect(viewer.searchState()).toEqual({ pattern: "demo", at: 1, total: 1, files: 1 });
  expect(top().key).toBe("0:header");
  type("/", "K", "e", "e", "p", "return");
  expect(viewer.searchState()).toEqual({ pattern: "Keep", at: 0, total: 0, files: 0 });
});

test("Escape leaves the prompt without searching, and Backspace on an empty prompt leaves it too", () => {
  const { viewer, type } = open();
  type("/", "o", "escape");
  expect(viewer.prompting).toBe(false);
  expect(viewer.searchState()).toBeUndefined();
  type("/", "o", "backspace");
  expect(viewer.searchState()).toEqual({ prompt: "", count: 0 });
  type("backspace");
  expect(viewer.prompting).toBe(false);
  // q is text while typing, not a command.
  type("/", "q");
  expect(viewer.searchState()).toEqual({ prompt: "q", count: 0 });
});
