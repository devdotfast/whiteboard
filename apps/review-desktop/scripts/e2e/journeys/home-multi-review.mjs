/** Three reviews over two worktrees: Home lists, searches, filters and opens them, and Trash / Undo / delete reach the store. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createReview,
  openHome,
  orderReviewBlocks,
  pickReview,
} from "../harness.mjs";

export const name = "home-multi-review";

export const phase = 1;

export const options = {
  settings: { "window.menuStyle": "custom", "window.dialogStyle": "custom" },
};

/** Every locator this journey uses, rebuilt from the current `ctx.page` after each return to Home. */
function homeUi(ctx) {
  const home = ctx.page.locator("main.review-home");

  return {
    home,
    rows: home.locator("[data-home-row]"),
    // One canvas part renders whichever review is active, so the heading says which review the reader is on.
    canvas: ctx.page.locator(".review-canvas-root [data-review-api]"),
  };
}

/** The review ids the store lists; `apiOk` keeps "the deleted review is gone" from passing on an error body. */
async function listedReviewIds(ctx) {
  return (await ctx.apiOk("/reviews-api")).map((summary) => summary.reviewId);
}

async function isTrashed(ctx, reviewId) {
  return Boolean(
    (await ctx.apiOk("/reviews-api")).find(
      (summary) => summary.reviewId === reviewId,
    )?.trashedAt,
  );
}

export async function run(ctx) {
  const { git, root, until } = ctx;

  const first = await createReview(ctx, {
    title: "Order review",
    blocks: orderReviewBlocks,
  });

  const second = await createReview(ctx, {
    title: "Second review",
    blocks: [{ type: "markdown", markdown: "Second look at the same change." }],
  });

  // A second worktree of the same repository, which Home filters on by checkout.
  const other = path.join(root, "repo-b");

  await git("worktree", "add", "-q", "-b", "feature-b", other, ctx.head);
  await writeFile(
    path.join(other, "order.ts"),
    'export const status = "shipped";\n',
  );
  await git("-C", other, "commit", "-qam", "Ship");

  const headB = await git("-C", other, "rev-parse", "HEAD");

  const third = await createReview(ctx, {
    title: "Worktree B review",
    repoPath: other,
    base: ctx.head,
    head: headB,
    blocks: [{ type: "markdown", markdown: "Shipped." }],
  });

  await openHome(ctx);

  let { home, rows, canvas } = homeUi(ctx);

  const rowFor = (title) => rows.filter({ hasText: title });

  const rowCount = (count, what) =>
    until(async () => (await rows.count()) === count, what);

  await rowCount(3, "three review rows");
  ctx.check("Home lists three reviews from two worktrees");

  await ctx.page.keyboard.press("ControlOrMeta+KeyF");
  await home
    .getByRole("searchbox", { name: "Search whiteboards" })
    .fill("Worktree B");
  await rowCount(1, "search narrows to one row");
  await home.getByLabel("Clear filters", { exact: true }).click();
  await rowCount(3, "clear restores three rows");

  await rowFor(third.title)
    .getByRole("button", { name: `More actions for ${third.title}` })
    .click();

  await ctx.page
    .getByRole("menuitem", { name: "Filter worktree: repo-b" })
    .click({ delay: 150 });
  await rowCount(1, "the worktree filter narrows to worktree B");
  await rowFor(third.title).waitFor();
  await home.getByLabel("Clear filters", { exact: true }).click();
  await rowCount(3, "clear restores three rows");
  ctx.check("Home search, worktree filter and clear behave");

  await home
    .getByRole("button", { name: `Open ${second.title}`, exact: true })
    .click();
  await canvas.getByRole("heading", { name: second.title }).waitFor();
  await pickReview(ctx, first.reviewId);
  await canvas.getByRole("heading", { name: first.title }).waitFor();
  ctx.check("Home opens a review and app pick switches to another");

  await openHome(ctx);
  ({ home, rows } = homeUi(ctx));

  const trash = async () => {
    await rowFor(third.title)
      .getByRole("checkbox", { name: `Select ${third.title}` })
      .click();
    await home
      .getByRole("toolbar", { name: "Selected whiteboards" })
      .getByRole("button", { name: /^Trash/ })
      .click();
    await rowCount(2, "the trashed review leaves the list");
    await until(() => isTrashed(ctx, third.reviewId), "the store to trash it");
  };

  await trash();
  await ctx.page
    .locator(".notification-toast")
    .filter({ hasText: "Moved 1 whiteboard to Trash." })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await rowCount(3, "Undo restores the review");
  await until(
    async () => !(await isTrashed(ctx, third.reviewId)),
    "the store to restore it",
  );
  ctx.check("Trash from Home leaves the list and Undo restores it");

  // Cancellation preserves the review; confirmation deletes only that review.
  await trash();
  await home.getByRole("button", { name: /in Trash/ }).click();
  await home.getByRole("heading", { name: /Trash/ }).waitFor();
  await rowFor(third.title).click();

  const deleteButton = home
    .getByRole("toolbar", { name: "Selected whiteboards" })
    .getByRole("button", { name: /^Delete…/ });

  const dialog = ctx.page.getByRole("dialog").filter({
    hasText: `Delete “${third.title}”?`,
  });

  assert.ok(
    (await listedReviewIds(ctx)).includes(third.reviewId),
    `${third.reviewId} is not listed before the delete`,
  );
  await deleteButton.click();
  await dialog.getByText(`Delete “${third.title}”?`, { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.ok((await listedReviewIds(ctx)).includes(third.reviewId));
  await deleteButton.click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await until(
    async () => (await rowFor(third.title).count()) === 0,
    "the deleted review leaves Trash",
  );
  await home.getByRole("button", { name: "Whiteboards", exact: true }).click();
  await rowCount(2, "two review rows after the delete");

  const remaining = await listedReviewIds(ctx);

  assert.ok(
    !remaining.includes(third.reviewId),
    `${third.reviewId} is still listed after deletion`,
  );
  assert.deepEqual(
    [first.reviewId, second.reviewId].filter((id) => !remaining.includes(id)),
    [],
    "deleting one review must not unlist the others",
  );
  ctx.check("confirmed deletion from Trash updates Home and the store");
}
