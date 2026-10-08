import { expect, test } from "bun:test";
import { createTestDiffFile } from "../protocol/fixture";
import { rowsForFile } from "./rows";
import { agentReference, type SourceSelection } from "./selection";
import { dark } from "../theme/themes";
import type { DiffFile } from "../protocol/wire";

const comparison = { lhs: { type: "index" as const }, rhs: { type: "working_tree" as const } };

/** Select from the row showing line `from` to the row showing line `to` on one side of a split. */
function select(file: DiffFile, side: SourceSelection["side"], from: number, to: number) {
  const rows = rowsForFile(file, 0, "split", dark);
  const at = (line: number) => rows.find((row) => row[side]?.lineNumber === line)!.key;
  return { rows, selection: { anchor: at(to), end: at(from), side } };
}

test("a head selection names its path, lines and snapshot, then fences the new source", () => {
  const file = createTestDiffFile();
  const { rows, selection } = select(file, "right", 2, 3);
  expect(agentReference([file], comparison, rows, selection)).toBe(
    'head: demo.ts:2-3 (working tree)\n```ts\nsend("new");\nextra();\n```',
  );
});

test("a one-line base selection quotes the old source with a single line number", () => {
  const file = createTestDiffFile();
  const { rows, selection } = select(file, "left", 2, 2);
  expect(agentReference([file], comparison, rows, selection)).toBe(
    'base: demo.ts:2 (index)\n```ts\nsend("old");\n```',
  );
});

test("the fence outgrows any run of backticks in the code", () => {
  const file = createTestDiffFile();
  if (file.diff.type !== "text" || !file.diff.rhs) throw new Error("The fixture is a text diff");
  file.diff.rhs = { ...file.diff.rhs, text: 'start();\nsend("new");\n```\nfinish();\n', syntax: [] };
  const { rows, selection } = select(file, "right", 3, 3);
  expect(agentReference([file], comparison, rows, selection)).toBe(
    "head: demo.ts:3 (working tree)\n````ts\n```\n````",
  );
});
