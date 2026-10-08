import { expect, test } from "bun:test";
import { createTestDiffFile } from "../protocol/fixture";
import { rowsForFile } from "./rows";
import { agentReference, type SourceSelection } from "./selection";
import { dark } from "../theme/themes";
import type { DiffFile } from "../protocol/wire";

const againstMain = { lhs: { type: "revision" as const, rev: "main" }, rhs: { type: "working_tree" as const } };

/** Select from the row showing line `from` to the row showing line `to` on one side of a split. */
function select(file: DiffFile, side: SourceSelection["side"], from: number, to: number) {
  const rows = rowsForFile(file, 0, "split", dark);
  const at = (line: number) => rows.find((row) => row[side]?.lineNumber === line)!.key;
  return { rows, selection: { anchor: at(to), end: at(from), side } };
}

test("lines from the file on disk are named by path and range alone, then fenced", () => {
  const file = createTestDiffFile();
  const { rows, selection } = select(file, "right", 2, 3);
  expect(agentReference([file], againstMain, rows, selection)).toBe(
    'demo.ts:2-3\n```ts\nsend("new");\nextra();\n```',
  );
});

test("lines from a revision name the revision, so an agent can find that version", () => {
  const file = createTestDiffFile();
  const { rows, selection } = select(file, "left", 2, 2);
  expect(agentReference([file], againstMain, rows, selection)).toBe(
    'demo.ts:2 at main\n```ts\nsend("old");\n```',
  );
});

test("lines from the index say they are staged", () => {
  const file = createTestDiffFile();
  const { rows, selection } = select(file, "left", 1, 1);
  const staged = { lhs: { type: "index" as const }, rhs: { type: "working_tree" as const } };
  expect(agentReference([file], staged, rows, selection)).toBe(
    "demo.ts:1 in the git index (staged)\n```ts\nstart();\n```",
  );
});

test("the fence outgrows any run of backticks in the code", () => {
  const file = createTestDiffFile();
  if (file.diff.type !== "text" || !file.diff.rhs) throw new Error("The fixture is a text diff");
  file.diff.rhs = { ...file.diff.rhs, text: 'start();\nsend("new");\n```\nfinish();\n', syntax: [] };
  const { rows, selection } = select(file, "right", 3, 3);
  expect(agentReference([file], againstMain, rows, selection)).toBe(
    "demo.ts:3\n````ts\n```\n````",
  );
});
