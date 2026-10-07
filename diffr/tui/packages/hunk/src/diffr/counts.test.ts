import { expect, test } from "bun:test";
import { blockBar, comparisonLabel } from "./counts";
test("the block bar splits five blocks by share and keeps a block for any non-zero side", () => {
  expect(blockBar({ added: 0, removed: 0 })).toEqual(["neutral", "neutral", "neutral", "neutral", "neutral"]);
  expect(blockBar({ added: 10, removed: 0 })).toEqual(["added", "added", "added", "added", "added"]);
  expect(blockBar({ added: 3, removed: 1 })).toEqual(["added", "added", "added", "removed", "neutral"]);
  expect(blockBar({ added: 1, removed: 1 })).toEqual(["added", "added", "removed", "removed", "neutral"]);
  expect(blockBar({ added: 99, removed: 1 })).toEqual(["added", "added", "added", "added", "removed"]);
  expect(blockBar({ added: 13, removed: 6 })).toEqual(["added", "added", "added", "removed", "neutral"]);
  expect(blockBar({ added: 1, removed: 99 })).toEqual(["added", "removed", "removed", "removed", "removed"]);
});
test("comparison labels shorten shas and name the special snapshots", () => {
  expect(comparisonLabel({ type: "revision", rev: "main" }, { type: "revision", rev: "0123456789abcdef0123456789abcdef01234567" }))
    .toBe("main…0123456");
  expect(comparisonLabel({ type: "index" }, { type: "working_tree" })).toBe("index…working tree");
  expect(comparisonLabel({ type: "empty_tree" }, { type: "path", path: "after.ts" })).toBe("empty tree…after.ts");
});
