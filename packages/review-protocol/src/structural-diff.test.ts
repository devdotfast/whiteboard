import {
  type StructuralDiff,
  decodeStructuralDiffEvent,
} from "@dev.fast/diffr";
import { expect, test } from "vitest";

import {
  applyStructuralUpdate,
  decodeReviewStructuralDiffEvent,
} from "./structural-diff.js";

test("keeps host transport errors distinct from diffr file errors", () => {
  const error = JSON.stringify({ type: "error", message: "launch failed" });
  expect(decodeReviewStructuralDiffEvent(error)).toEqual({
    type: "error",
    message: "launch failed",
  });
  expect(() => decodeStructuralDiffEvent(error)).toThrow(
    "Malformed diffr protocol record.",
  );
});

test("applies an update to a copy, replacing each listed region's visibility", () => {
  const at = { line: 0, column: 0 };

  const diff: Extract<StructuralDiff, { type: "text" }> = {
    type: "text",
    structural_changes: { base: [], head: [] },
    rhs: {
      text: "",
      root: {
        kind: "fold",
        id: 1,
        fold_state_id: 1,
        indent: at,
        start: at,
        end: at,
        children: [
          {
            kind: "leaf",
            id: 2,
            fold_state_id: 2,
            alignment_id: 1,
            start: at,
            end: at,
            visibility: { collapsed: true, label: "Old" },
          },
        ],
      },
    },
    stats: {
      textual: { added: 1, removed: 0 },
      visible: { added: 0, removed: 0 },
    },
  };

  const original = structuredClone(diff);

  const updated = applyStructuralUpdate(diff, {
    regions: [{ id: 1, label: "File" }, { id: 2 }],
    visible: { added: 1, removed: 0 },
  });

  expect(diff).toEqual(original);
  expect(updated.stats.visible).toEqual({ added: 1, removed: 0 });
  expect(updated.rhs!.root.visibility).toEqual({ label: "File" });

  expect(
    updated.rhs!.root.kind === "fold" && updated.rhs!.root.children[0],
  ).not.toHaveProperty("visibility");
});
