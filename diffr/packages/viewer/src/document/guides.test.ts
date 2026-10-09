import { expect, test } from "vitest";
import {createGuideDiffFile, createTestDiffFile, leaf, line, root} from "../protocol/fixture";
import {rowsForFile} from "./rows";
import { dark } from "../theme/themes";
import {byteColumn, defaultCollapsed} from "./regions";
const sourceText = (cell: {spans: {text: string}[]} | undefined) => cell?.spans.map(s => s.text).join("");
test("Paper: enclosing guides cross blank lines and indented gap bands; syntax folds join opener and closer", () => {
  const file = createGuideDiffFile();
  if (file.diff.type !== "text") throw new Error();
  const rows = rowsForFile(file, 0, "split", dark, defaultCollapsed(file.diff));
  const blank = rows.find(r => r.right?.lineNumber === 5)!.right!;
  expect(sourceText(blank)).toBe("│   │   │");
  expect(blank.kind).toBe("context"); // Its leaf contains a change on another line.
  const band = rows.find(r => r.right?.fold?.id === 5)!.right!;
  expect(sourceText(band)).toBe("│   │   │   ⋯ 2 unchanged lines");
  expect(band.spans.filter(s => s.guide !== undefined).map(s => s.guide)).toEqual([10, 20, 30]);
  const other = rows.find(r => r.right?.fold?.id === 40)!;
  expect(sourceText(other.right)).toBe("│   fn other() { ⋯ 2 lines }");
  expect(other.right?.lineNumber).toBe(10);
  expect(rows.some(r => r.right?.lineNumber === 13)).toBe(false);
  expect(rows.find(r => r.right?.lineNumber === 3)?.right?.fold?.id).toBe(30);
});
test("folding one side masks it without changing correspondence on the other side", () => {
  const file = createGuideDiffFile();
  if (file.diff.type !== "text") throw new Error();
  const rightIf = file.diff.rhs!.root.children[1].children[1].children[1];
  rightIf.fold_state_id = 303;
  const rows = rowsForFile(file, 0, "split", dark, new Set([303]));
  const changed = rows.find(r => r.left?.lineNumber === 4)!;
  expect(changed.right?.kind).toBe("empty");
  expect(sourceText(rows.find(r => r.right?.lineNumber === 3)?.right)).toContain("if event.open { ⋯ 2 lines }");
  expect(rows.find(r => r.left?.lineNumber === 9)?.right?.lineNumber).toBe(9);
});
test("paired leaves tint only lines with change spans, never neighboring unchanged lines", () => {
  const file = createTestDiffFile();
  if (file.diff.type !== "text") throw new Error();
  file.diff.lhs = {text: "before\nold\nafter\n", syntax: [], root: root([leaf(1, 0, 3, [line(1, 0, 3)])])};
  file.diff.rhs = {text: "before\nnew\nafter\n", syntax: [], root: root([leaf(1, 0, 3, [line(1, 0, 3)])])};
  const rows = rowsForFile(file, 0, "split", dark).slice(1);
  expect(rows.map(r => r.right?.kind)).toEqual(["context", "addition", "context"]);
  expect(rows.map(r => r.left?.kind)).toEqual(["context", "deletion", "context"]);
});
test("wire byte columns use the code row's tab stops and Unicode cell widths", () => {
  expect(byteColumn("\t界 café {", 4)).toBe(6);
  expect(byteColumn("\t界 café {", 10)).toBe(11);
});
test("a scope runs from its opener to its closer: each line knows its innermost scope, and its brackets carry its id", () => {
  const file = createGuideDiffFile();
  if (file.diff.type !== "text") throw new Error();
  const rows = rowsForFile(file, 0, "split", dark, defaultCollapsed(file.diff));
  const at = (line: number) => rows.find(r => r.right?.lineNumber === line)!.right!;
  // The opener's line and the closer's line belong to the scope itself, not its parent.
  expect([at(3).scope, at(8).scope, at(4).scope, at(9).scope]).toEqual([30, 30, 30, 20]);
  // Only the lines between opener and closer are the body that folding hides.
  expect(at(4).body).toEqual([10, 20, 30]);
  expect(at(3).body).toEqual([10, 20]);
  const braces = (line: number) => at(line).spans.filter(s => s.brace !== undefined).map(s => [s.text, s.brace]);
  expect(braces(3)).toEqual([["{", 30]]);
  expect(braces(8)).toEqual([["}", 30]]);
  // The chevron on an opener's line folds that scope, the one its rail and brackets show.
  expect(at(3).fold?.id).toBe(30);
});
test("a fold diffr left unlabelled says how many lines it hides, inline or as its own row", () => {
  const file = createGuideDiffFile();
  if (file.diff.type !== "text") throw new Error();
  const other = file.diff.rhs!.root.children[1].children.find(r => r.fold_state_id === 40)!;
  other.visibility = {collapsed: true, label: ""};
  const gap = file.diff.rhs!.root.children[1].children[1].children[1].children[1];
  gap.visibility = {collapsed: true, label: ""};
  const rows = rowsForFile(file, 0, "split", dark, defaultCollapsed(file.diff));
  expect(sourceText(rows.find(r => r.right?.fold?.id === 40)!.right)).toBe("│   fn other() { ⋯ 2 lines }");
  expect(sourceText(rows.find(r => r.right?.fold?.id === 5)!.right)).toBe("│   │   │   ⋯ 2 lines");
});
