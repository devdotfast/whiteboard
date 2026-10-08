import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDiffFile, leaf, root } from "../protocol/fixture";
import { rowsForFile, type ViewerRow } from "./rows";
import { agentReference, copySelection, selectedRanges, selectionLead, type Side, type SourceSelection } from "./selection";
import { dark } from "../theme/themes";
import type { DiffFile } from "../protocol/wire";

const againstMain = { lhs: { type: "revision" as const, rev: "main" }, rhs: { type: "working_tree" as const } };

/*
 * The fixture, demo.ts:
 *   old: 1 start();  2 send("old");  3 finish();
 *   new: 1 start();  2 send("new");  3 extra();  4 finish();
 */
type Point = [(row: ViewerRow) => boolean, Side];
function drag(rows: ViewerRow[], from: Point, to: Point): SourceSelection {
  const key = ([at]: Point) => rows.find(at)!.key;
  return { anchor: key(from), anchorSide: from[1], end: key(to), endSide: to[1] };
}
const unifiedOld = (line: number) => (row: ViewerRow) => row.cell?.oldLineNumber === line && row.cell.newLineNumber === undefined;
const unifiedNew = (line: number) => (row: ViewerRow) => row.cell?.newLineNumber === line;
const left = (line: number) => (row: ViewerRow) => row.left?.lineNumber === line;
const right = (line: number) => (row: ViewerRow) => row.right?.lineNumber === line;

test("a unified drag from a removed line to an added one takes both sides, as a Git patch with base and head sides", () => {
  const file = createTestDiffFile();
  const rows = rowsForFile(file, 0, "unified", dark);
  const selection = drag(rows, [unifiedOld(2), "left"], [unifiedNew(3), "right"]);
  expect(agentReference([file], againstMain, rows, selection)).toBe([
    "Base: main",
    "Head: working tree (uncommitted)",
    "",
    "diff --git a/demo.ts b/demo.ts",
    "index 1111111..2222222 100644",
    "--- a/demo.ts",
    "+++ b/demo.ts",
    "@@ -2 +2,2 @@",
    '-send("old");',
    '+send("new");',
    "+extra();",
    "",
  ].join("\n"));
  // A plain copy is the new version's lines, for pasting into code.
  expect(copySelection([file], rows, selection)).toBe('send("new");\nextra();');
});

test("unchanged lines are both old and new; added lines alone are all R, at the old line they follow", () => {
  const file = createTestDiffFile();
  const rows = rowsForFile(file, 0, "unified", dark);
  const withContext = agentReference([file], againstMain, rows, drag(rows, [unifiedNew(1), "right"], [unifiedNew(3), "right"]));
  expect(withContext).toContain("@@ -1,2 +1,3 @@\n start();\n-send(\"old\");\n+send(\"new\");\n+extra();\n");
  const added = agentReference([file], againstMain, rows, drag(rows, [unifiedNew(2), "right"], [unifiedNew(3), "right"]));
  expect(added).toContain("@@ -2,0 +2,2 @@\n+send(\"new\");\n+extra();\n");
});

test("a split drag from the left column to the right takes everything between, removed lines first", () => {
  const file = createTestDiffFile();
  const unified = rowsForFile(file, 0, "unified", dark);
  const rows = rowsForFile(file, 0, "split", dark);
  expect(agentReference([file], againstMain, rows, drag(rows, [left(2), "left"], [right(3), "right"])))
    .toBe(agentReference([file], againstMain, unified, drag(unified, [unifiedOld(2), "left"], [unifiedNew(3), "right"])));
  // Dragged the other way, from right to left, it leaves out the added line right of its end.
  // An unchanged row is one line on both sides, whichever half the drag covers.
  const [range] = selectedRanges([file], rows, drag(rows, [right(1), "right"], [left(2), "left"]));
  expect(range!.lines).toEqual([{ old: 1, new: 1 }, { old: 2 }]);
});

test("a split drag kept to one column emits only that side's selected changes", () => {
  const file = createTestDiffFile();
  const rows = rowsForFile(file, 0, "split", dark);
  const added = agentReference([file], againstMain, rows, drag(rows, [right(3), "right"], [right(2), "right"]));
  expect(added).toEndWith('@@ -2,0 +2,2 @@\n+send("new");\n+extra();\n');
  expect(added).not.toContain('-send("old");');
  const removed = agentReference([file], againstMain, rows, drag(rows, [left(2), "left"], [left(2), "left"]));
  expect(removed).toEndWith('@@ -2 +1,0 @@\n-send("old");\n');
  expect(removed).not.toContain('+send("new");');
  const staged = { lhs: { type: "index" as const }, rhs: { type: "working_tree" as const } };
  expect(agentReference([file], staged, rows, drag(rows, [left(1), "left"], [left(1), "left"])))
    .toEndWith("@@ -1 +1 @@\n start();\n");
});

test("mutable snapshots are identified without inventing commit SHAs", () => {
  const file = createTestDiffFile();
  file.file.rhs!.oid = "0".repeat(40);
  const rows = rowsForFile(file, 0, "unified", dark);
  const staged = { lhs: { type: "index" as const }, rhs: { type: "working_tree" as const } };
  const context = agentReference([file], staged, rows, drag(rows, [unifiedOld(2), "left"], [unifiedNew(3), "right"]));
  expect(context).toStartWith("Base: index (staged)\nHead: working tree (uncommitted)\n\n");
  expect(context).toContain(`index ${file.file.lhs!.oid}..${file.file.rhs!.oid} 100644\n`);
});

test("a folded stretch inside the selection ends one hunk and starts the next", () => {
  const file = createTestDiffFile();
  if (file.diff.type !== "text") throw new Error("The fixture is a text diff");
  const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
  const regions = () => {
    const gap = leaf(2, 2, 7);
    gap.visibility = { collapsed: true, label: "5 unchanged lines" };
    return [leaf(1, 0, 2), gap, leaf(3, 7, 10)];
  };
  file.diff.lhs = { text, syntax: [], root: root(regions()) };
  file.diff.rhs = { text, syntax: [], root: root(regions(), 1001) };
  const rows = rowsForFile(file, 0, "unified", dark, new Set([2]));
  const selection = drag(rows, [unifiedNew(1), "right"], [unifiedNew(10), "right"]);
  expect(agentReference([file], againstMain, rows, selection)).toBe([
    "Base: main",
    "Head: working tree (uncommitted)",
    "",
    "diff --git a/demo.ts b/demo.ts",
    "index 1111111..2222222 100644",
    "--- a/demo.ts",
    "+++ b/demo.ts",
    "@@ -1,2 +1,2 @@",
    " line 1",
    " line 2",
    "@@ -8,3 +8,3 @@",
    " line 8",
    " line 9",
    " line 10",
    "\\ No newline at end of file",
    "",
  ].join("\n"));
  expect(selectionLead("", selectedRanges([file], rows, selection), 80)).toBe(" demo.ts:R1-10 · 5 lines ");
});

test("backticks in selected code remain literal patch content", () => {
  const file = createTestDiffFile();
  if (file.diff.type !== "text" || !file.diff.rhs) throw new Error("The fixture is a text diff");
  file.diff.rhs = { ...file.diff.rhs, text: 'start();\nsend("new");\n```\nfinish();\n', syntax: [] };
  const rows = rowsForFile(file, 0, "split", dark);
  expect(agentReference([file], againstMain, rows, drag(rows, [right(3), "right"], [right(3), "right"])))
    .toEndWith("@@ -2,0 +3 @@\n+```\n");
});

test("the selection bar names the range with its path, or just its file's name when the path won't fit", () => {
  const file = (path: string) => {
    const each = createTestDiffFile();
    each.file.lhs!.path = each.file.rhs!.path = path;
    return each;
  };
  const files: DiffFile[] = [file("diffr/packages/claude-code/plugin/hooks/diffr.test.ts"), file("b.ts")];
  const rows = [...rowsForFile(files[0]!, 0, "split", dark), ...rowsForFile(files[1]!, 1, "split", dark)];
  const one = selectedRanges(files, rows, drag(rows, [right(1), "right"], [right(3), "right"]));
  expect(selectionLead("", one, 80)).toBe(" diffr/packages/claude-code/plugin/hooks/diffr.test.ts:R1-3 · 3 lines ");
  expect(selectionLead("", one, 40)).toBe(" diffr.test.ts:R1-3 · 3 lines ");
  const across = drag(rows, [right(1), "right"], [(row) => row.fileIndex === 1 && row.right?.lineNumber === 2, "right"]);
  expect(selectionLead("Copied for agent", selectedRanges(files, rows, across), 80)).toBe(" Copied for agent · 2 files · 6 lines ");
});

test("a line diffr pairs as only reformatted is removed and added in the patch, which needs unchanged lines to match", () => {
  const file = createTestDiffFile();
  if (file.diff.type !== "text") throw new Error("The fixture is a text diff");
  file.diff.lhs = { text: "  call();\n", syntax: [], root: root([leaf(1, 0, 1)]) };
  file.diff.rhs = { text: "    call();\n", syntax: [], root: root([leaf(1, 0, 1)], 1001) };
  const rows = rowsForFile(file, 0, "unified", dark);
  const selection = drag(rows, [unifiedNew(1), "right"], [unifiedNew(1), "right"]);
  expect(agentReference([file], againstMain, rows, selection)).toEndWith("@@ -1 +1 @@\n-  call();\n+    call();\n");
});

test("a hunk's place on a side it has no lines on is counted from the whole diff, lines folded away included", () => {
  // old: a, x, y   new: a, c   x and y are removed and folded away; c is added after them.
  const file = createTestDiffFile();
  if (file.diff.type !== "text") throw new Error("The fixture is a text diff");
  const removed = leaf(2, 1, 3);
  removed.visibility = { collapsed: true, label: "2 removed lines" };
  file.diff.lhs = { text: "a\nx\ny", syntax: [], root: root([leaf(1, 0, 1), removed]) };
  file.diff.rhs = { text: "a\nc", syntax: [], root: root([leaf(1, 0, 1), leaf(3, 1, 2)], 1001) };
  const rows = rowsForFile(file, 0, "unified", dark, new Set([2]));
  expect(rows.some((row) => row.cell?.oldLineNumber === 2)).toBe(false);
  const reference = agentReference([file], againstMain, rows, drag(rows, [unifiedNew(1), "right"], [unifiedNew(2), "right"]));
  // c goes after old line 3, not after the last old line on screen.
  expect(reference).toContain("@@ -1 +1 @@\n a\n@@ -3,0 +2 @@\n+c\n\\ No newline at end of file\n");
  // With the fold open, the same lines and the removed ones between them make one hunk.
  const open = rowsForFile(file, 0, "unified", dark);
  expect(agentReference([file], againstMain, open, drag(open, [unifiedNew(1), "right"], [unifiedNew(2), "right"])))
    .toContain("@@ -1,3 +1,2 @@\n a\n-x\n-y\n\\ No newline at end of file\n+c\n\\ No newline at end of file\n");
});

// Exercise Git's parser and application, including final-newline and quoted-path handling.
test("Git can apply the selected patch to its base and recover the head", () => {
  const directory = mkdtempSync(join(tmpdir(), "diffr-patch-"));
  try {
    for (const ending of ["\n", ""]) {
      const file = createTestDiffFile();
      if (file.diff.type !== "text" || !file.diff.lhs || !file.diff.rhs) throw new Error("Text fixture required");
      const path = 'a file"name.ts';
      file.file.lhs!.path = file.file.rhs!.path = path;
      file.diff.rhs.text = file.diff.rhs.text.trimEnd() + ending;
      const rows = rowsForFile(file, 0, "unified", dark);
      const comparison = { lhs: { type: "revision" as const, rev: "a".repeat(40) }, rhs: { type: "revision" as const, rev: "b".repeat(40) } };
      const patch = agentReference([file], comparison, rows, drag(rows, [unifiedNew(1), "right"], [unifiedNew(4), "right"]));
      expect(patch).toStartWith(`Base: ${comparison.lhs.rev}\nHead: ${comparison.rhs.rev}\n\n`);
      expect(patch).toContain(`index ${file.file.lhs!.oid}..${file.file.rhs!.oid} 100644\n`);
      writeFileSync(join(directory, path), file.diff.lhs.text);
      const applied = Bun.spawnSync(["git", "apply", "--unidiff-zero", "-"], { cwd: directory, stdin: Buffer.from(patch) });
      expect(applied.stderr.toString()).toBe("");
      expect(applied.exitCode).toBe(0);
      expect(readFileSync(join(directory, path), "utf8")).toBe(file.diff.rhs.text);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
