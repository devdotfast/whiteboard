import { anchorSelection } from "@review/lens-selection";
import { call_stack_diff } from "@review/review-api/blocks/call_stack_diff";
import { expect, it } from "vitest";

import { callTreeStops } from "./call-tree";

it("keeps separate calls into the same file as separate sections and combines matched base/head evidence", () => {
  const source = "head/shared.ts#L5-L20";

  const block = call_stack_diff.schema.parse({
    type: "call_stack_diff",
    id: "calls",
    title: "Request",
    head: [
      { key: "root", label: "handle", source: source },
      { key: "first", parentKey: "root", label: "read", source: source },
      { key: "second", parentKey: "root", label: "write", source: source },
    ],
    base: [
      {
        key: "first",
        source: "base/shared.ts#L5-L20",
      },
    ],
  });

  call_stack_diff.check(block);
  const stops = callTreeStops(block);
  expect(stops.map((stop) => [stop.label, stop.depth])).toEqual([
    ["handle", 0],
    ["read", 1],
    ["write", 1],
  ]);
  expect(stops[1].sources.map((source) => source.start.side)).toEqual([
    "head",
    "base",
  ]);
  expect(stops[1].last).toBe(false);
  expect(stops[2].last).toBe(true);
  expect(new Set(stops.map((stop) => stop.id)).size).toBe(3);
  expect(stops.every((stop) => stop.sources[0].file === "shared.ts")).toBe(
    true,
  );
});

it("rejects a parent reference that would create a cyclic call tree", () => {
  const block = call_stack_diff.schema.parse({
    type: "call_stack_diff",
    title: "Cycle",
    base: [],
    head: [
      {
        key: "self",
        parentKey: "self",
        source: "head/a.ts#L1-L3",
      },
    ],
  });

  expect(() => call_stack_diff.check(block)).toThrow("earlier frame");
});

it("keeps supporting source ranges in the owning frame without adding call edges", () => {
  const source = "head/view.ts#L10-L20";
  const fields = "head/view.ts#L2-L5";

  const stops = callTreeStops({
    type: "call_stack_diff",
    id: "tree",
    title: "Create view",
    base: [],
    head: [
      {
        key: "view",
        parentKey: null,
        source: source,
        contextSources: [fields],
      },
    ],
  });

  expect(stops).toHaveLength(1);
  expect(stops[0].sources).toEqual([
    anchorSelection(source),
    anchorSelection(fields),
  ]);
  expect(stops[0].parentId).toBeUndefined();
});
