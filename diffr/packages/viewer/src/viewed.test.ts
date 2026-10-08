import { expect, test } from "bun:test";
import { createNestedChangesDiffFile as twoChanges, startFor } from "./protocol/fixture";
import { DiffStore } from "./protocol/store";
import type { DiffFile } from "./protocol/wire";
import { planCell } from "./viewport/cell";
import type { Progress } from "./document/viewed";
import { measureRows } from "./viewport/geometry";
import { dark } from "./theme/themes";
import { Viewer } from "./viewer";

function open(file: DiffFile) {
  const store = new DiffStore();
  store.accept(startFor([file]));
  store.accept(file);
  const viewer = new Viewer(store, dark, 100);
  viewer.lay({ columns: 160, rows: 40 });
  return viewer;
}

const unread = (added: number, removed: number): Progress => ({ remaining: { added, removed }, state: "unread" });
const partial = (added: number, removed: number): Progress => ({ remaining: { added, removed }, state: "partial" });
const viewed: Progress = { remaining: { added: 0, removed: 0 }, state: "viewed" };

test("marking an inner scope leaves the scope around it partial, and marking that one finishes the file", () => {
  const viewer = open(twoChanges());
  expect(viewer.fileProgress(0)).toEqual(unread(2, 2));
  viewer.toggleViewedScope(0, 30);
  expect(viewer.scopeProgress(0, 30)).toEqual(viewed);
  expect(viewer.scopeProgress(0, 20)).toEqual(partial(1, 1));
  expect(viewer.fileProgress(0)).toEqual(partial(1, 1));
  viewer.toggleViewedScope(0, 20);
  expect(viewer.fileProgress(0)).toEqual(viewed);
  expect(viewer.viewedFiles()).toEqual({ viewed: 1, total: 1 });
  // Unmarking the inner scope returns only its own lines.
  viewer.toggleViewedScope(0, 30);
  expect(viewer.scopeProgress(0, 20)).toEqual(partial(1, 1));
});

test("a marked scope folds, shows ✓ where it says what it hides, and unmarking opens it", () => {
  const viewer = open(twoChanges());
  viewer.toggleViewedScope(0, 30);
  const folded = viewer.lay({ columns: 160, rows: 40 }).rows.find((row) => row.right?.fold?.id === 30)!;
  expect(folded.right!.fold!.collapsed).toBe(true);
  const marks = viewer.cellMarks(0, folded.right!, 1, undefined);
  expect(marks.foldViewed).toBe(true);
  const painted = planCell(folded.right!, folded.right!.spans, 80, false,
    { theme: dark, geometry: measureRows([folded], 160, false, 0, 20), visualLine: 0, marks });
  const text = painted.runs.map((run) => run.text).join("");
  expect(text).toContain("✓");
  expect(text).not.toContain("⋯");
  viewer.toggleViewedScope(0, 30);
  const reopened = viewer.lay({ columns: 160, rows: 40 }).rows.find((row) => row.right?.fold?.id === 30)!;
  expect(reopened.right!.fold!.collapsed).toBe(false);
});

test("a viewed scope reopened by hand stays viewed, its changed lines faded", () => {
  const viewer = open(twoChanges());
  viewer.toggleViewedScope(0, 30);
  viewer.setFold(0, 30, false, false);
  const rows = viewer.lay({ columns: 160, rows: 40 }).rows;
  const at = (n: number) => rows.find((row) => row.right?.lineNumber === n)!.right!;
  expect(viewer.scopeProgress(0, 30)).toEqual(viewed);
  expect(viewer.cellMarks(0, at(4), 1, undefined).read).toBe(true);
  // `fn handle` is outside the marked scope, so it still reads as unread.
  expect(viewer.cellMarks(0, at(2), 1, undefined).read).toBe(false);
  const fadedBg = planCell(at(4), at(4).spans, 80, false,
    { theme: dark, geometry: measureRows(rows, 160, false, 0, 20), visualLine: 0, marks: viewer.cellMarks(0, at(4), 1, undefined) }).bg;
  expect(fadedBg).toBe(dark.readAddition);
});

test("v marks the scope under the pointer, whose header shows what's left and a box on the head side", () => {
  const viewer = open(twoChanges());
  viewer.setHover({ file: 0, id: 20, armed: false });
  const at = viewer.lay({ columns: 160, rows: 40 });
  expect(at.scope).toEqual({ file: 0, id: 20 });
  const header = at.rows.find((row) => row.right?.fold?.id === 20)!;
  expect(viewer.cellMarks(0, header.right!, 1, at.scope).box).toEqual(unread(2, 2));
  expect(viewer.cellMarks(0, header.left!, 0, at.scope).box).toBeUndefined();
  const plan = planCell(header.right!, header.right!.spans, 80, false,
    { theme: dark, geometry: at.geometry, visualLine: 0, marks: viewer.cellMarks(0, header.right!, 1, at.scope) });
  expect(plan.runs.map((run) => run.text).join("")).toEndWith(" +2 −2 [ ] ");
  expect(plan.runs.map((run) => run.text).join("")).toHaveLength(80);
  expect(plan.marks).toEqual([[69, 80, 20]]);
  viewer.press({ key: "v" });
  expect(viewer.scopeProgress(0, 20)).toEqual(viewed);
});

test("V marks the top file viewed and closes it; again unmarks and opens it", () => {
  const viewer = open(twoChanges());
  viewer.press({ key: "V" });
  const file = viewer.lay({ columns: 160, rows: 40 }).snapshot.files[0]!;
  expect(viewer.fileProgress(0)).toEqual(viewed);
  expect(viewer.isClosed(0, file)).toBe(true);
  viewer.press({ key: "V" });
  expect(viewer.fileProgress(0)).toEqual(unread(2, 2));
  expect(viewer.isClosed(0, file)).toBe(false);
});

test("a scope with no change has nothing to mark", () => {
  const viewer = open(twoChanges());
  // `fn other` is unchanged and starts folded.
  expect(viewer.scopeProgress(0, 40)).toBeUndefined();
  viewer.toggleViewedScope(0, 40);
  expect(viewer.fileProgress(0)).toEqual(unread(2, 2));
  expect(viewer.lay({ columns: 160, rows: 40 }).rows.find((row) => row.right?.fold?.id === 40)!.right!.fold!.collapsed).toBe(true);
});
