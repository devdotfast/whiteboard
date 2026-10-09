import { expect, test } from "vitest";
import { createBundledDiffFile, createFoldedDiffFile, createTestDiffFile, fold, leaf, line, root } from "../protocol/fixture";
import { collapsedFolds, defaultCollapsed, flatten, foldHeaders, foldIds, foldTint, gapIds, hiddenLines, pairedIds } from "./regions";
import { rowsForFile } from "./rows";
import { dark } from "../theme/themes";
import type { Region } from "../protocol/wire";
import { foldBackground } from "./rows";
test("a fold covers its body, so collapsing it hides every line it holds", () => {
  const file = createFoldedDiffFile();
  if (file.diff.type !== "text") throw new Error();
  const { folds, leaves } = flatten(file.diff);
  expect(folds[1].map((f) => [f.foldStateId, f.startLine, f.lastHidden])).toEqual([[10, 1, 6], [11, 2, 3], [12, 5, 6]]);
  expect(folds[1][0].nested).toEqual([11, 12]);
  expect(leaves[1].map((l) => [l.foldStateId, l.startLine, l.endLine]))
    .toEqual([[1, 0, 1], [7, 1, 2], [2, 2, 3], [3, 3, 4], [4, 4, 5], [5, 5, 7], [6, 7, 8]]);
  expect([...hiddenLines(folds[1], new Set([11, 12]))].sort()).toEqual([2, 3, 5, 6]);
  // Everything an outer fold covers goes with it, the folds inside included.
  expect([...hiddenLines(folds[1], new Set([10, 11]))].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  // A collapsed fold is a row of its own; only open folds mark a source line.
  expect(collapsedFolds(folds[1], new Set([11])).get(2)?.foldStateId).toBe(11);
  expect([...collapsedFolds(folds[1], new Set([10, 11])).keys()]).toEqual([1]);
  expect(foldHeaders(folds[1], leaves[1], new Set([11]), pairedIds(file.diff)[1]).get(1))
    .toEqual({ id: 10, label: "Body", collapsed: false, tint: "neutral" });
});
test("visibility seeds collapsed ids, and context gaps are collapsed untagged regions holding no change", () => {
  const file = createFoldedDiffFile();
  if (file.diff.type !== "text") throw new Error();
  const collapse = (region: Region, label: string) => { region.visibility = { collapsed: true, label }; };
  for (const side of [file.diff.lhs!, file.diff.rhs!]) {
    const outer = side.root.children[1];
    // Leaf 6: paired and unchanged, cut out by the context plugin.
    collapse(side.root.children[2], "1 unchanged line");
    // Fold 12: an untagged fold wrapping unchanged lines, as context groups several siblings.
    outer.children[3].tags = [];
    collapse(outer.children[3], "2 unchanged lines");
    // Leaf 3: collapsed, but the right side paints a change in it.
    collapse(outer.children[1].children[1], "1 line");
  }
  // Fold 10: collapsed by a plugin that tagged it, so not a gap even where nothing changed.
  file.diff.rhs!.root.children[1].visibility = { collapsed: true, label: "Body" };
  expect([...defaultCollapsed(file.diff)].sort((a, b) => a - b)).toEqual([3, 6, 10, 12]);
  expect(gapIds(file.diff).sort((a, b) => a - b)).toEqual([6, 12]);
  // A collapsed stretch on one side only (a removed run) is not a gap either.
  const removed = createFoldedDiffFile();
  if (removed.diff.type !== "text") throw new Error();
  const lonely = leaf(60, 7, 8);
  collapse(lonely, "1 line removed");
  removed.diff.lhs!.root.children[2] = lonely;
  expect(gapIds(removed.diff)).toEqual([]);
});
test("a fold on one side leaves the other side's lines beside blank cells", () => {
  const file = createFoldedDiffFile();
  if (file.diff.type !== "text") throw new Error();
  // The right-hand closure body is a novel fold with its own leaves; the left keeps flat leaves.
  file.diff.lhs!.root.children = [leaf(1, 0, 1), leaf(7, 1, 2), leaf(2, 2, 3), leaf(3, 3, 4), leaf(4, 4, 5), leaf(5, 5, 7), leaf(6, 7, 8)];
  const rows = rowsForFile(file, 0, "split", dark, new Set([11])).filter((r) => r.left);
  expect(rows.map((r) => [r.left!.lineNumber, r.right!.lineNumber])).toEqual([
    [1, 1], [2, 2], [undefined, undefined], [3, undefined], [4, undefined], [5, 5], [6, 6], [7, 7], [8, 8],
  ]);
  expect(rows[3].right!.kind).toBe("empty");
  // The fold's own row: collapsed on the right, blank on the left, which has no such fold.
  expect(rows[2].right!.fold?.collapsed).toBe(true);
  expect(rows[2].left!.fold).toBeUndefined();
});
test("rows carry fold headers on both layouts and drop hidden lines", () => {
  const file = createFoldedDiffFile();
  const split = rowsForFile(file, 0, "split", dark, new Set([11])).filter((r) => r.right);
  expect(split.map((r) => r.right!.lineNumber)).toEqual([1, 2, undefined, 5, 6, 7, 8]);
  // The body hides the right side's changed line, so both sides take the modification tint.
  expect(split[2].right!.fold).toEqual({ id: 11, label: "Body", collapsed: true, tint: "modified" });
  expect(split[2].left!.fold).toEqual({ id: 11, label: "Body", collapsed: true, tint: "modified" });
  // The open outer fold marks the first line it covers, so it can be collapsed from there.
  expect(split[1].right!.fold).toEqual({ id: 10, label: "Body", collapsed: false, tint: "neutral" });
  const unified = rowsForFile(file, 0, "unified", dark, new Set([10])).filter((r) => r.cell);
  expect(unified.map((r) => r.cell!.newLineNumber)).toEqual([1, undefined, 8]);
  expect(unified[1].cell!.fold?.id).toBe(10);
});
test("a multi-line label uses the declared enclosing indent inside the fold tint", () => {
  const file = createFoldedDiffFile();
  if (file.diff.type !== "text") throw new Error();
  const pseudocode = "call a\ncall b\nreturn";
  file.diff.rhs!.root.children[1].children[1].visibility = { collapsed: false, label: pseudocode };
  file.diff.lhs!.root.children[1].children[1].visibility = { collapsed: false, label: pseudocode };
  const rows = rowsForFile(file, 0, "split", dark, new Set([11]));
  const labels = rows.filter((r) => r.right?.foldLabel);
  expect(labels.map((r) => r.right!.spans.map(s => s.text).join(""))).toEqual(["call a", "call b", "return"]);
  expect(labels.map((r) => r.left!.spans.map(s => s.text).join(""))).toEqual(["call a", "call b", "return"]);
  expect(rows.indexOf(labels[0])).toBe(rows.findIndex((r) => r.right?.fold?.id === 11) + 1);
  const unified = rowsForFile(file, 0, "unified", dark, new Set([11]));
  expect(unified.filter((r) => r.cell?.foldLabel)).toHaveLength(3);
});
test("a collapsed leaf is one fold row with the chevron, its label, and no line number", () => {
  const file = createTestDiffFile();
  if (file.diff.type !== "text") throw new Error();
  file.diff.lhs!.root.children[0].visibility = file.diff.rhs!.root.children[0].visibility = { collapsed: true, label: "1 unchanged line" };
  const split = rowsForFile(file, 0, "split", dark, new Set([1]));
  expect(split[1].left!.fold).toEqual({ id: 1, label: "1 unchanged line", collapsed: true, tint: "neutral" });
  expect(split[1].left!.lineNumber).toBeUndefined();
  expect(split[1].right!.fold).toEqual({ id: 1, label: "1 unchanged line", collapsed: true, tint: "neutral" });
  expect(split.filter((r) => r.left?.fold?.id === 1)).toHaveLength(1);
  const unified = rowsForFile(file, 0, "unified", dark, new Set([1]));
  expect(unified[1].cell).toMatchObject({ fold: { id: 1, collapsed: true } });
  // Open, the leaf's first line carries the chevron so it can be collapsed again.
  expect(rowsForFile(file, 0, "split", dark, new Set())[1].left!.fold).toEqual({ id: 1, label: "1 unchanged line", collapsed: false, tint: "neutral" });
  // A leaf diffr neither collapsed nor labelled is not foldable.
  const rows = rowsForFile(createTestDiffFile(), 0, "split", dark, new Set());
  expect(rows[1].right!.fold).toBeUndefined();
  expect(rows[1].left!.fold).toBeUndefined();
});

test("a fold that runs to the end of the file may end one past its last line", () => {
  const file = createTestDiffFile();
  if (file.diff.type !== "text") throw new Error("fixture is not a text diff");
  const text = "fn a() {\n    b();\n}\n";
  // Three lines; the fold's hull ends at (3, 0), just past the last line.
  const regions: Region[] = [fold(10, [0, 0], [3, 0], [leaf(1, 0, 1), leaf(2, 1, 3)])];
  file.diff.lhs = { text, syntax: [], root: root(regions) };
  file.diff.rhs = { text, syntax: [], root: root(regions) };
  const { folds } = flatten(file.diff);
  expect(folds[0][0]?.lastHidden).toBe(2);
});

test("regions sharing a fold_state_id collapse and expand as one bundle", () => {
  const file = createTestDiffFile();
  if (file.diff.type !== "text") throw new Error("fixture is not a text diff");
  const text = [
    "/// Adds two numbers.", // 0
    "/// Wraps on overflow.", // 1
    "fn add(a: u8, b: u8) -> u8 {", // 2
    "    a.wrapping_add(b)", // 3
    "}", // 4
  ].join("\n") + "\n";
  // The docstring (id 20) and the function body (id 21) share fold state 21.
  const docstring: Region = { ...fold(20, [0, 0], [2, 0], [leaf(1, 0, 2)], "", ["comment"], true), fold_state_id: 21 };
  const body = fold(21, [3, 0], [4, 0], [leaf(2, 3, 4)], "s = a + b\nreturn s", ["body", "function"], true);
  const regions: Region[] = [docstring, leaf(4, 2, 3), body, leaf(3, 4, 5)];
  file.diff.lhs = { text, syntax: [], root: root(regions) };
  file.diff.rhs = { text, syntax: [], root: root(regions) };
  const collapsed = defaultCollapsed(file.diff);
  expect([...collapsed]).toEqual([21]);
  const { folds } = flatten(file.diff);
  // One id hides the whole docstring and the whole body.
  expect([...hiddenLines(folds[1], collapsed)].sort()).toEqual([0, 1, 3]);
  expect([...hiddenLines(folds[1], new Set())]).toEqual([]);
  const rows = rowsForFile(file, 0, "split", dark, collapsed).filter((r) => r.right && !r.right.foldLabel);
  // The docstring is a one-row ⋯ fold (empty label)), the signature stays visible between the two
  // rows, and both carry the same id, so either chevron toggles the pair.
  const headers = rows.filter((r) => r.right!.fold).map((r) => [r.right!.lineNumber, r.right!.fold!.id, r.right!.fold!.label, r.right!.fold!.collapsed]);
  expect(headers).toEqual([[undefined, 21, "", true], [undefined, 21, "s = a + b\nreturn s", true]]);
  expect(rows.map((r) => r.right!.lineNumber)).toEqual([undefined, 3, undefined, 5]);
});

test("a collapsed docstring leaf bundled with its function renders as a bare ⋯ row", () => {
  const file = createBundledDiffFile();
  if (file.diff.type !== "text") throw new Error("fixture is not a text diff");
  const collapsed = defaultCollapsed(file.diff);
  expect([...collapsed]).toEqual([4]);
  expect(foldIds(file.diff)).toContain(4);
  const rows = rowsForFile(file, 0, "split", dark, collapsed).filter((r) => r.right && !r.right.foldLabel);
  // Line 1 ("];"), the docstring as one ⋯ fold row, the signature, then the body's own row.
  expect(rows.map((r) => [r.right!.lineNumber, r.right!.fold?.id, r.right!.fold?.label, r.right!.fold?.collapsed]))
    .toEqual([[1, undefined, undefined, undefined], [undefined, 4, "", true], [3, undefined, undefined, undefined],
      [undefined, 4, "look up path\nreturn None", true], [5, undefined, undefined, undefined]]);
  // Right side only, so both the ⋯ row and the summary take the added tint.
  expect(rows.filter((r) => r.right!.fold).map((r) => r.right!.fold!.tint)).toEqual(["inserted", "inserted"]);
  // Expanding the shared id reveals the docstring line too.
  const open = rowsForFile(file, 0, "split", dark, new Set()).filter((r) => r.right && !r.right.foldLabel);
  expect(open.map((r) => r.right!.lineNumber)).toEqual([1, 2, 3, 4, 5]);
});

test("a collapsed fold takes its side's change tint when one-sided and stays neutral when paired", () => {
  const text = "fn a() {\n    x\n}\n";
  const body = (id: number, label: string) => fold(id, [1, 0], [2, 0], [leaf(id + 100, 1, 2)], label, ["deleted-bodies:function", "summarize:function"], true);
  const rowsFor = (lhs: Region[] | undefined, rhs: Region[] | undefined) => {
    const file = createTestDiffFile();
    if (file.diff.type !== "text") throw new Error();
    file.diff.lhs = lhs && { text, syntax: [], root: root([leaf(88, 0, 1), ...lhs, leaf(9, 2, 3)])};
    file.diff.rhs = rhs && { text, syntax: [], root: root([leaf(88, 0, 1), ...rhs, leaf(9, 2, 3)])};
    return rowsForFile(file, 0, "split", dark, defaultCollapsed(file.diff));
  };
  // Inserted: a summary on the right with no counterpart. The header and every label row are green.
  const inserted = rowsFor(undefined, [body(7, "x = 1\nreturn x")]);
  const header = inserted.find((r) => r.right?.fold)!.right!;
  expect(header.fold!.tint).toBe("inserted");
  expect(inserted.filter((r) => r.right?.foldLabel).map((r) => r.right!.band)).toEqual(["inserted", "inserted"]);
  expect(foldBackground(dark, "inserted")).toBe(dark.addition);
  // Removed: the same body only on the left.
  const removed = rowsFor([body(7, "2 lines removed")], undefined);
  expect(removed.find((r) => r.left?.fold)!.left!.fold!.tint).toBe("removed");
  expect(foldBackground(dark, "removed")).toBe(dark.deletion);
  // Paired: a matched fold pair, each fold with its own id and one fold state between
  // them, sits on the code's own background.
  const paired = rowsFor([body(7, "Body")], [{ ...body(8, "Body"), fold_state_id: 7, children: body(7, "Body").children }]);
  const both = paired.find((r) => r.left?.fold && r.right?.fold)!;
  expect([both.left!.fold!.tint, both.right!.fold!.tint]).toEqual(["neutral", "neutral"]);
  expect(foldBackground(dark, "neutral")).toBe(dark.bg);
  // Modified: the same pair hiding a changed line takes the modification tint and counts it.
  const changedBody = (id: number) => ({ ...body(id, "Body"), children: [leaf(107, 1, 2, [line(1, 4, 5)])] });
  const modified = rowsFor([changedBody(7)], [{ ...changedBody(8), fold_state_id: 7 }]);
  const changedRow = modified.find((r) => r.left?.fold && r.right?.fold)!;
  expect([changedRow.left!.fold!.tint, changedRow.right!.fold!.tint]).toEqual(["modified", "modified"]);
  expect(changedRow.right!.spans.map((s) => s.text).join("")).toContain("⋯ Body · 1 line changed");
  expect(foldBackground(dark, "modified")).toBe(dark.modification);
  // A fold state shared only on its own side does not pair a fold.
  const linked = rowsFor([{ ...body(7, "Body"), children: [{ ...leaf(107, 1, 2), fold_state_id: 7 }] }], [body(8, "Body")]);
  expect(linked.find((r) => r.left?.fold)!.left!.fold!.tint).toBe("removed");
  expect(foldTint(7, 1, new Set([7]))).toBe("neutral");
  expect(foldTint(7, 1, new Set())).toBe("inserted");
  expect(foldTint(7, 0, new Set())).toBe("removed");
});

test("a group is one row that stands for every collapsed region under it", () => {
  // The shape of three adjacent deleted functions after the group plugin, left side only.
  const text = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n") + "\n";
  const body = (id: number, start: number) =>
    fold(id, [start, 0], [start + 3, 0], [leaf(id + 100, start, start + 3)], "3 lines removed", ["deleted-bodies:function"], true);
  const group = fold(20, [1, 0], [12, 0], [body(1, 1), leaf(2, 4, 5), body(3, 5), leaf(4, 8, 9), body(5, 9)], "3 collapsed regions · 11 lines", [], true);
  const file = createTestDiffFile();
  if (file.diff.type !== "text") throw new Error();
  file.diff.lhs = { text, syntax: [], root: root([leaf(0, 0, 1), group])};
  file.diff.rhs = { text: "line 0\n", syntax: [], root: root([leaf(0, 0, 1)])};
  const bands = (collapsed: Set<number>) =>
    rowsForFile(file, 0, "split", dark, collapsed)
      .filter((r) => r.left?.fold?.collapsed)
      .map((r) => [r.left!.fold!.id, r.left!.fold!.label]);
  const initial = defaultCollapsed(file.diff);
  // Collapsed, the group is the only row: everything it wraps is inside it.
  expect(bands(initial)).toEqual([[20, "3 collapsed regions · 11 lines"]]);
  // Opening it reveals each member's own collapsed row, and the lines between them.
  initial.delete(20);
  expect(bands(initial)).toEqual([[1, "3 lines removed"], [3, "3 lines removed"], [5, "3 lines removed"]]);
  expect(rowsForFile(file, 0, "split", dark, initial).filter((r) => r.left?.lineNumber).map((r) => r.left!.lineNumber))
    .toEqual([1, 5, 9]);
  // Fully open, the group marks the first line it covers so it can be closed again.
  expect(rowsForFile(file, 0, "split", dark, new Set()).find((r) => r.left?.lineNumber === 2)!.left!.fold)
    .toMatchObject({ id: 20, collapsed: false });
  expect(gapIds(file.diff)).toEqual([]);
});
test("a scope opened on a line takes its chevron from a statement fold starting there", () => {
  const base = { side: 1 as const, label: "", tags: [], collapsed: false, nested: [], parentColumn: 0 };
  const statement = { ...base, id: 1, foldStateId: 1, startLine: 4, lastHidden: 20 };
  const scope = { ...base, id: 2, foldStateId: 2, startLine: 5, lastHidden: 19,
    syntax: { start: { line: 4, column: 30 }, end: { line: 20, column: 0 } } };
  expect(foldHeaders([statement, scope], [], new Set(), new Set()).get(4)?.id).toBe(2);
  // Without a scope on the line, the outermost fold keeps it.
  expect(foldHeaders([statement, { ...scope, syntax: undefined }], [], new Set(), new Set()).get(4)?.id).toBe(1);
});
