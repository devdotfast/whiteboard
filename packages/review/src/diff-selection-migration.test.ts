import { expect, it } from "vitest";

import { anchorSelection, resolveDiffSelection } from "./lens-selection";
import { migrateStoredDocument } from "./stored-document-migration";

it("migrates retained peeks and lens endpoints without altering IDs or unrelated line data", () => {
  const old = {
    id: "frame",
    source: { file: "a.ts", side: "head", fromLine: 1, toLine: 2 },
    sourceRanges: [{ file: "a.ts", fromLine: 1, toLine: 2 }],
  };

  const migrated = migrateStoredDocument(old) as typeof old & {
    source: string;
  };

  expect(migrated.source).toBe("head/a.ts#L1-L2");
  const selection = anchorSelection(migrated.source);
  expect(migrated.id).toBe(old.id);
  expect(migrated.sourceRanges).toEqual(old.sourceRanges);
  expect(old.source).toHaveProperty("fromLine", 1);
  expect(
    resolveDiffSelection(
      selection,
      [
        [0, 0],
        [1, null],
        [2, 1],
      ],
      { path: "a.ts" },
    ),
  ).toEqual([
    { file: "a.ts", side: "base", fromLine: 1, toLine: 3 },
    { file: "a.ts", side: "head", fromLine: 1, toLine: 2 },
  ]);
  expect(migrateStoredDocument(migrated)).toEqual(migrated);
});

it("preserves deletion-only and insertion-only endpoint boundaries during migration", () => {
  const migrated = migrateStoredDocument({
    source: {
      file: "a.ts",
      start: { baseLine: 2, headLine: null },
      end: { baseLine: null, headLine: 3 },
    },
  }) as { source: string };

  expect(migrated.source).toBe("diff/a.ts#L2-R3");
  const selection = anchorSelection(migrated.source);
  expect(selection.start).toEqual({ side: "base", line: 2 });
  expect(selection.end).toEqual({ side: "head", line: 3 });
  expect(
    resolveDiffSelection(
      selection,
      [
        [0, 0],
        [1, null],
        [null, 1],
        [null, 2],
        [2, 3],
      ],
      { path: "a.ts" },
    ),
  ).toEqual([
    { file: "a.ts", side: "base", fromLine: 2, toLine: 2 },
    { file: "a.ts", side: "head", fromLine: 2, toLine: 3 },
  ]);
});

it("moves an anchor's own pins onto what holds it, unless they are its block's", () => {
  const other = { repositoryId: "repo", base: "b1", head: "h1" };
  const block = { repositoryId: "repo", base: "b0", head: "h0" };

  const anchor = (line: number, pins?: Record<string, string>) => ({
    file: "a.ts",
    start: { side: "head", line },
    end: { side: "head", line },
    ...(pins && { pins }),
  });

  expect(
    migrateStoredDocument([
      { type: "code_peek", source: anchor(1, other) },
      {
        type: "sequence",
        pins: block,
        steps: [
          { label: "own", source: anchor(2, other) },
          { label: "block's", source: anchor(3, block) },
        ],
      },
      {
        type: "call_stack_diff",
        base: [{ source: anchor(4, other), callSite: anchor(5, other) }],
        head: [{ source: anchor(6) }],
      },
    ]),
  ).toEqual([
    { type: "code_peek", source: "head/a.ts#L1", pins: other },
    {
      type: "sequence",
      pins: block,
      steps: [
        { label: "own", source: "head/a.ts#L2", pins: other },
        { label: "block's", source: "head/a.ts#L3" },
      ],
    },
    {
      type: "call_stack_diff",
      base: [{ source: "head/a.ts#L4", callSite: "head/a.ts#L5", pins: other }],
      head: [{ source: "head/a.ts#L6" }],
    },
  ]);
});
