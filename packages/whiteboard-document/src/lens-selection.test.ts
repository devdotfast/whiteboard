import { expect, it } from "vitest";

import { patchRows } from "./lens-selection.js";

it("pairs a patch's lines, unchanged gaps and the tail included", () => {
  expect(
    patchRows(
      "@@ -2,2 +2,1 @@\n-deleted\n context\n\\ No newline at end of file",
      4,
      3,
    ),
  ).toEqual([
    [0, 0],
    [1, null],
    [2, 1],
    [3, 2],
  ]);
});

it("pairs an added file's lines with nothing, skipping the git headers", () => {
  expect(
    patchRows("--- /dev/null\n+++ b/a\n@@ -0,0 +1,2 @@\n+a\n+b", 0, 2),
  ).toEqual([
    [null, 0],
    [null, 1],
  ]);
});

it("pairs each line with itself without a patch", () => {
  expect(patchRows("", 2, 2)).toEqual([
    [0, 0],
    [1, 1],
  ]);
});
