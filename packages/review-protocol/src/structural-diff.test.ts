import { decodeStructuralDiffEvent } from "@dev.fast/diffr";
import { expect, test } from "vitest";

import { decodeReviewStructuralDiffEvent } from "./structural-diff.js";

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
