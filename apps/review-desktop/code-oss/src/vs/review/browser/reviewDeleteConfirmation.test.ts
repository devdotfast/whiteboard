import assert from "node:assert/strict";
import test from "node:test";
import { confirmReviewDeletion } from "./reviewDeleteConfirmation.js";

test("only an explicit confirmation in the originating canvas permits deletion", async () => {
  for (const confirmed of [false, true]) {
    for (const current of [false, true]) {
      const result = await confirmReviewDeletion({confirm: async () => ({confirmed})}, "A session", () => current);
      assert.equal(result, confirmed && current);
    }
  }
});

test("a canvas closed during confirmation cannot delete", async () => {
  const pending = Promise.withResolvers<{confirmed: boolean}>();
  let current = true;
  const result = confirmReviewDeletion({confirm: () => pending.promise}, "Original session", () => current);
  current = false;
  pending.resolve({confirmed: true});
  assert.equal(await result, false);
});
