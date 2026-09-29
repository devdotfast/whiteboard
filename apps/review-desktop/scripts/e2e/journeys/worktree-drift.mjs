/** One review outliving its worktree: dirtied, renamed, deleted, re-read each time; the working copy's bytes must never show. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createReview,
  openHome,
  orderReviewBlocks,
  pickReview,
} from "../harness.mjs";

export const name = "worktree-drift";

export const phase = 1;

export const options = {};

const TITLE = "Order review";

const MOVED_BUG =
  "A review whose repository directory moves or is deleted renders `ReviewApiError: Review operation failed.`";

/** The banner a snapshot marked `sourceUnavailable` renders instead of the source (see api-document.tsx). */
const RETAINED_SOURCE = "Local checkout unavailable. Showing retained source.";

/** Every locator this journey uses, rebuilt from the current `ctx.page` because each restart replaces it. */
function canvasUi(ctx) {
  const canvas = ctx.page.locator(".review-canvas-root [data-review-api]");

  return {
    heading: canvas.getByRole("heading", { name: TITLE, exact: true }),
    // The state a missing checkout is meant to reach (see desktop-entry.tsx).
    unavailable: ctx.page.getByText("Worktree unavailable"),
    retained: canvas.getByText(RETAINED_SOURCE),
    failed: canvas.getByText(/^Whiteboard operation failed \(Error\)\./),
    peek: canvas
      .locator('[data-review-inline-editor="order.ts"]')
      .first(),
  };
}

export async function run(ctx) {
  const { repo, until } = ctx;

  // Dirtied before the review exists, so the peek resolves once, against a tree that already differs from the pinned head.
  await writeFile(
    path.join(repo, "order.ts"),
    'export const status = "dirty";\n',
  );

  const review = await createReview(ctx, {
    title: TITLE,
    blocks: orderReviewBlocks,
  });

  const peekText = async () =>
    (await canvasUi(ctx).peek.locator(".view-line").allInnerTexts()).join("\n");

  await until(
    async () => (await peekText()).includes("queued"),
    "the peek to show the pinned head bytes",
  );
  assert.doesNotMatch(
    await peekText(),
    /dirty/,
    "the peek rendered the dirty working copy instead of the pinned head",
  );
  ctx.check("a dirty working copy does not change what the review shows");

  // The pinned checkout sits inside the repository directory, so it travels with the rename and dies with the delete.
  const commonDir = path.resolve(
    repo,
    await ctx.git("rev-parse", "--git-common-dir"),
  );

  const pinnedIn = (root) =>
    path.join(
      root,
      path.relative(repo, commonDir),
      "dev-fast/reviews",
      review.reviewId,
      "head",
      ctx.head,
    );

  assert.ok(
    existsSync(pinnedIn(repo)),
    `the peek resolved without a pinned checkout at ${pinnedIn(repo)}`,
  );

  // The control for everything below: the same restart and open, with the repository still where it was registered.
  await ctx.restartDesktop();
  await pickReview(ctx, review.reviewId);

  const control = await canvasUi(ctx)
    .heading.waitFor({ timeout: 60000 })
    .then(
      () => null,
      (error) => error.message,
    );

  assert.equal(
    control,
    null,
    "a restart with the repository still in place must render the review; " +
      `without that control nothing below can blame the move: ${control}`,
  );

  const moved = `${repo}-moved`;

  await rename(repo, moved);
  assert.ok(
    existsSync(pinnedIn(moved)),
    `the rename did not carry the pinned checkout to ${pinnedIn(moved)}`,
  );
  await ctx.restartDesktop();
  await pickReview(ctx, review.reviewId, moved);

  const { heading, unavailable, failed } = canvasUi(ctx);

  // The bug's signature, in this launch's log: the commits read still resolves the registered path, which no longer exists.
  const staleRead = () =>
    ctx
      .launchLog()
      .includes(
        `/commits failed: Error: No Git or jj repository found for ${repo}.`,
      );

  // The rename leaves the pinned checkout intact, so a full render is as legitimate as the degraded state.
  const outcome = await until(
    async () =>
      ((await unavailable.count()) > 0 && "unavailable") ||
      ((await heading.count()) > 0 && "rendered") ||
      ((await failed.count()) > 0 && "failed"),
    "the moved worktree to report unavailable, render the pinned review, or fail",
  );

  if (outcome === "failed") {
    assert.ok(
      staleRead(),
      "the canvas failed for a reason other than the stale repository path",
    );
    await ctx.knownBug(MOVED_BUG);
  } else
    ctx.check(
      outcome === "unavailable"
        ? "a moved worktree is reported as unavailable"
        : "a moved worktree still renders from the pinned checkout",
    );

  const info = await ctx.cliRaw(
    ["info", "--session", review.reviewId, "--json"],
    moved,
  );

  assert.equal(info.code, 0, `whiteboard info: ${info.stdout}\n${info.stderr}`);
  assert.match(
    info.stdout,
    new RegExp(review.reviewId),
    `whiteboard info named no review: ${info.stdout}`,
  );
  ctx.check("info resolves a review whose worktree moved");

  await rm(moved, { recursive: true, force: true });
  assert.ok(
    !existsSync(pinnedIn(moved)),
    `the delete left the pinned checkout at ${pinnedIn(moved)}`,
  );
  await ctx.restartDesktop();
  await openHome(ctx);
  await ctx.page
    .locator("main.review-home .review-home-table tbody tr")
    .filter({ hasText: TITLE })
    .locator(".review-home-table-open")
    .click();

  const deleted = canvasUi(ctx);

  // `Worktree unavailable` belongs to the source-file view this path never opens, so the document is the only outcome.
  const afterDelete = await until(
    async () =>
      ((await deleted.heading.count()) > 0 && "rendered") ||
      ((await deleted.failed.count()) > 0 && "failed"),
    "the deleted worktree to render the stored document or fail",
  );

  if (afterDelete === "failed") {
    assert.ok(
      staleRead(),
      "the canvas failed for a reason other than the stale repository path",
    );
    await ctx.knownBug(MOVED_BUG);

    return;
  }

  // Nothing is left to read from, so the retained document has to say so rather than pass for a current one.
  await deleted.retained.waitFor();

  const views = ctx.page.locator('[aria-label="Session views"]');

  await views.locator('button[aria-label="Commits"]').click();

  const commits = ctx.page.locator(".review-view-region--commits");

  await commits
    .getByRole("heading", { name: "Commits unavailable", exact: true })
    .waitFor();
  assert.equal(
    await commits.getByText(/\d+ commits/).count(),
    0,
    "the Commits tab counted commits although the checkout is gone",
  );
  ctx.check(
    "a deleted worktree renders the retained document with its banner, and Commits says it is unavailable",
  );
}
