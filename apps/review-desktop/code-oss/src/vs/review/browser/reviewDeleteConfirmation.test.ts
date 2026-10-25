import assert from "node:assert/strict";
import test from "node:test";
import type { IConfirmation } from "../../platform/dialogs/common/dialogs.js";
import { confirmReviewDeletion } from "./reviewDeleteConfirmation.js";

test("only an explicit confirmation in the originating canvas permits deletion", async () => {
  for (const confirmed of [false, true]) {
    for (const current of [false, true]) {
      const result = await confirmReviewDeletion({confirm: async () => ({confirmed})}, ["A whiteboard"], () => current);
      assert.equal(result, confirmed && current);
    }
  }
});

test("a canvas closed during confirmation cannot delete", async () => {
  const pending = Promise.withResolvers<{confirmed: boolean}>();
  let current = true;
  const result = confirmReviewDeletion({confirm: () => pending.promise}, ["Original whiteboard"], () => current);
  current = false;
  pending.resolve({confirmed: true});
  assert.equal(await result, false);
});

test("moving to Trash asks only when other boards need the board", async () => {
  const asked: IConfirmation[] = [];
  const dialogs = { confirm: async (confirmation: IConfirmation) => (asked.push(confirmation), {confirmed: false}) };
  assert.equal(await confirmReviewDeletion(dialogs, ["Alone"], () => true, { linkedFrom: [] }, true), true);
  assert.equal(asked.length, 0);
  assert.equal(await confirmReviewDeletion(dialogs, ["Linked"], () => true, { linkedFrom: [{ title: "Notes" }] }, true), false);
  assert.equal(asked.length, 1);
});

test("names the children that move up and the whiteboards that link here", async () => {
  let shown: IConfirmation | undefined;
  const dialogs = { confirm: async (confirmation: IConfirmation) => ((shown = confirmation), {confirmed: true}) };
  await confirmReviewDeletion(dialogs, ["Parent", "Other"], () => true, {
    linkedFrom: [{ title: "Notes", pullRequestNumber: 7 }],
    movesUp: [{ title: "Child" }],
  });
  const details = typeof shown?.custom === "object" ? shown.custom.markdownDetails?.map(({ markdown }) => markdown.value) : [];
  assert.equal(details?.length, 2);
  assert.match(details![0], /nested under them[\s\S]*- Child/);
  assert.match(details![1], /1 whiteboard links here[\s\S]*- Notes #7/);
});
