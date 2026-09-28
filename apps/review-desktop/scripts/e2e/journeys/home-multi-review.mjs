/** Three reviews over two worktrees: Home lists, searches and opens them, and dismiss / restore / delete reach the store. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
    rows: home.locator(".review-home-table tbody tr"),
    tabs: ctx.page.locator(".tabs-container .tab"),
    // One canvas part renders whichever review tab is active, so the heading says which review the reader is on.
    canvas: ctx.page.locator(".review-canvas-root [data-review-api]"),
  };
}

/** The review ids the store lists; `apiOk` keeps "the deleted review is gone" from passing on an error body. */
async function listedReviewIds(ctx) {
  return (await ctx.apiOk("/reviews-api")).map((summary) => summary.reviewId);
}

/** The same command Home's dismiss and restore controls send. */
const attention = (ctx, reviewId, action) =>
  ctx.apiOk("/reviews-api/commands", "POST", {
    commandId: randomUUID(),
    operation: { type: "attention", reviewId, action },
  });

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

  // Home groups by checkout, not by repository, so a second worktree makes two groups out of three reviews.
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

  let { home, rows, tabs, canvas } = homeUi(ctx);

  await until(async () => (await rows.count()) === 3, "three review rows");
  await home.getByText("3 reviews", { exact: true }).waitFor();
  ctx.check("Home lists three reviews from two worktrees");

  await home.locator('[aria-label="Search sessions"]').fill("Worktree B");
  await until(
    async () => (await rows.count()) === 1,
    "search narrows to one row",
  );
  await home.locator('[aria-label="Clear search"]').click();
  await until(
    async () => (await rows.count()) === 3,
    "clear restores three rows",
  );
  ctx.check("Home search and clear behave");

  for (const title of [first.title, second.title, third.title])
    assert.equal(
      await tabs.filter({ hasText: title }).count(),
      1,
      `one editor tab for ${title}`,
    );

  await rows
    .filter({ hasText: second.title })
    .locator(".review-home-table-open")
    .click();
  await canvas.getByRole("heading", { name: second.title }).waitFor();
  await pickReview(ctx, first.reviewId);
  await canvas.getByRole("heading", { name: first.title }).waitFor();
  ctx.check(
    "two reviews open as separate tabs and app pick switches between them",
  );

  await openHome(ctx);
  ({ home, rows } = homeUi(ctx));

  const rowB = rows.filter({ hasText: third.title });

  await rowB
    .getByRole("button", { name: `Actions for ${third.title}` })
    .click();

  const menu = ctx.page.getByRole("menu");

  await menu
    .getByRole("menuitem", { name: "Delete session", exact: true })
    .waitFor();
  assert.equal(
    await home.getByRole("button", { name: `Dismiss ${third.title}` }).count(),
    0,
    "Home now offers Dismiss on an active review",
  );
  await ctx.knownBug("Home offers no way to dismiss an active review");
  await ctx.page.keyboard.press("Escape");

  const dismissedRow = home
    .locator(".review-home-dismissed-row")
    .filter({ hasText: third.title });

  // Dismissed rows sit behind a disclosure that keeps its state across re-renders, so only open it when it is shut.
  const expandDismissed = async () => {
    const toggle = home.locator(".review-home-dismissed-toggle");

    await toggle.waitFor();

    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click();
    await dismissedRow.waitFor();
  };

  await attention(ctx, third.reviewId, "dismiss");
  await until(
    async () => (await rows.count()) === 2,
    "the dismissed review leaves the table",
  );
  await expandDismissed();
  await dismissedRow.locator(".review-home-restore").click();
  await until(async () => (await rows.count()) === 3, "restored");
  ctx.check("a dismissed review is listed apart and Undo restores it");

  // Cancellation preserves the review; confirmation deletes only that review.
  await attention(ctx, third.reviewId, "dismiss");
  await expandDismissed();
  assert.ok(
    (await listedReviewIds(ctx)).includes(third.reviewId),
    `${third.reviewId} is not listed before the delete`,
  );
  await dismissedRow
    .getByRole("button", { name: `Delete ${third.title}` })
    .click();

  const dialog = ctx.page.getByRole("dialog").filter({
    hasText: `Delete “${third.title}”?`,
  });

  await dialog.getByText(`Delete “${third.title}”?`, { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.ok((await listedReviewIds(ctx)).includes(third.reviewId));
  await dismissedRow
    .getByRole("button", { name: `Delete ${third.title}` })
    .click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await until(
    async () => (await dismissedRow.count()) === 0,
    "the deleted review leaves Home",
  );
  await until(async () => {
    const seen = await rows.count();

    assert.equal(seen, 2, `saw ${seen}`);

    return true;
  }, "two review rows after the delete");

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
  ctx.check("confirmed deletion from Dismissed updates Home and the store");
}
