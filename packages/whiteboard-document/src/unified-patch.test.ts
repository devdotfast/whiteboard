import { expect, it } from "vitest";

import { parseUnifiedPatch, patchChanges } from "./unified-patch.js";

it("parses each hunk's lines with their old and new line numbers", () => {
  const hunks = parseUnifiedPatch(
    "a.ts",
    "@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -10,2 +10,3 @@\n x\n+y\n z",
  );

  expect(hunks.map(({ oldStart, newStart }) => [oldStart, newStart])).toEqual([
    [1, 1],
    [10, 10],
  ]);
  expect(hunks[0].lines).toEqual([
    { kind: "remove", oldLine: 1, newLine: null, text: "a" },
    { kind: "add", oldLine: null, newLine: 1, text: "A" },
    { kind: "context", oldLine: 2, newLine: 2, text: "b" },
  ]);
  expect(hunks[1].lines).toEqual([
    { kind: "context", oldLine: 10, newLine: 10, text: "x" },
    { kind: "add", oldLine: null, newLine: 11, text: "y" },
    { kind: "context", oldLine: 11, newLine: 12, text: "z" },
  ]);
});

it("counts removed base lines and added head lines", () => {
  expect(
    patchChanges(
      "a.ts",
      "@@ -1,4 +1,5 @@\n one\n-two\n+TWO\n+2.5\n three\n four",
    ),
  ).toEqual({ base: [[1, 2]], head: [[1, 3]] });
});

it("has no changes without a patch", () => {
  expect(patchChanges("a.ts", null)).toEqual({ base: [], head: [] });
});

it("unions adjacent added lines across hunks", () => {
  expect(
    patchChanges("a.ts", "@@ -1,0 +1,1 @@\n+a\n@@ -1,0 +2,1 @@\n+b"),
  ).toEqual({ base: [], head: [[0, 2]] });
});
