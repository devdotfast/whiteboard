/** A reader's place in a review survives a renderer reload: a commit diff, a picked trace, and a fullscreen tour step. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DIAGRAM_REVIEW_TITLE,
  clearToasts,
  commitPill,
  createDiagramReview,
  createReview,
  inView,
  openFullTrace,
  scopeToCommit,
  showView,
} from "../harness.mjs";

export const name = "canvas-resume";

export const phase = 1;

export const options = {};

const TITLE = "Canvas resume review";

const trace = (label) => ({
  label,
  events: [
    { id: "0", role: "user", text: `${label}: ship the order queue.` },
    { id: "1", role: "assistant", text: `${label}: the queue ships.` },
  ],
});

/** Reloads the whole workbench renderer; the review's own window comes back with its canvas. */
async function reloadWindow(ctx, page) {
  const origin = await page.evaluate(() => performance.timeOrigin);

  await page.keyboard.press("F1");
  await page
    .locator(".quick-input-widget input")
    .fill(">Developer: Reload Window");
  await page
    .getByRole("option", { name: /Developer: Reload Window/ })
    .waitFor();
  await page.keyboard.press("Enter");
  await ctx.until(
    async () => (await page.evaluate(() => performance.timeOrigin)) !== origin,
    "the workbench renderer to reload",
  );
  // The resumed view may hide the review's title, so the canvas itself is the signal.
  await page
    .locator(".review-canvas-root [data-review-api]")
    .waitFor({ timeout: 90000 });
}

const scopeSubject = async (page) =>
  /^Commit \w+: (.*)\. Choose commits$/.exec(
    await commitPill(page)
      .getAttribute("aria-label", { timeout: 1000 })
      .catch(() => ""),
  )?.[1] ?? null;

export async function run(ctx) {
  const { until, git, repo } = ctx;

  await writeFile(path.join(repo, "ship.ts"), "export const shipped = true;\n");
  await git("add", ".");
  await git("commit", "-qm", "Ship");

  const ship = await git("rev-parse", "HEAD");

  const repositoryId = (
    await ctx.apiOk("/reviews-api/repositories", "POST", { path: repo })
  ).id;

  // Two retained traces give the Trace view a picker with a non-default choice.
  const traceIds = [randomUUID(), randomUUID()];

  for (const [index, id] of traceIds.entries())
    await ctx.apiOk("/reviews-api/resources", "POST", {
      id,
      repositoryId,
      kind: "trace",
      trace: trace(`Trace ${index + 1}`),
    });

  const review = await createReview(ctx, {
    title: TITLE,
    head: ship,
    blocks: traceIds.map((traceId, index) => ({
      type: "trace_quote",
      traceId,
      eventId: "1",
      text: `Trace ${index + 1}: the queue ships.`,
    })),
  });

  const command = (operation) =>
    ctx.apiOk("/reviews-api/commands", "POST", {
      operation,
    });

  let page = await ctx.apiCanvasFor(TITLE);

  await ctx.watchPage(page);

  await scopeToCommit(ctx, "Queue", page);
  await until(
    async () => (await scopeSubject(page)) === "Queue",
    "the Queue commit diff",
  );
  await reloadWindow(ctx, page);
  await inView(ctx, "diff", page);
  await until(
    async () => (await scopeSubject(page)) === "Queue",
    "the Queue commit diff to resume after the reload",
  );
  ctx.check("a commit diff resumes with its scope after a reload");

  // A version that still lists the commit keeps the scope.
  await command({
    type: "edit",
    reviewId: review.reviewId,
    edit: {
      type: "insert",
      content: { type: "markdown", markdown: "The queue ships." },
    },
  });
  await reloadWindow(ctx, page);
  await inView(ctx, "diff", page);
  await until(
    async () => (await scopeSubject(page)) === "Queue",
    "the Queue scope to survive a version that still lists it",
  );

  // A version whose range drops the commit falls back to the full diff.
  await command({
    type: "set_target",
    reviewId: review.reviewId,
    target: { kind: "commits", repositoryId, head: ship, base: ctx.head },
  });
  await reloadWindow(ctx, page);
  await inView(ctx, "diff", page);
  await page.locator(".review-diff-view-host").waitFor();
  await until(
    async () =>
      (await commitPill(page).getAttribute("aria-label")).startsWith("All "),
    "the dropped commit's scope to clear",
  );
  assert.equal(
    await page.locator('[data-review-api] > p[role="status"]').count(),
    0,
  );
  assert.deepEqual(ctx.pageErrors, []);
  ctx.check(
    "a new version keeps a listed commit's scope and drops an unlisted one",
  );

  const trigger = page.locator(
    '.review-view-region--trace button[aria-haspopup="menu"]',
  );

  const option = (label) =>
    page
      .getByRole("menu", { name: "Agent sessions" })
      .getByRole("menuitemradio")
      .filter({ hasText: label });

  await showView(ctx, "Whiteboard", page);
  await openFullTrace(
    ctx,
    page
      .locator('.review-canvas-root [data-review-api] a[href^="#trace-"]')
      .filter({ hasText: "Trace 1" }),
    page,
  );
  await trigger.click();
  assert.equal(
    await option("Trace 1").getAttribute("aria-checked"),
    "true",
    "the quoted trace is not the one shown",
  );
  await option("Trace 2").click();
  await until(
    async () =>
      (await trigger.locator("span").nth(1).innerText()).trim() === "Trace 2",
    "the picked trace to show",
  );
  await reloadWindow(ctx, page);
  await inView(ctx, "trace", page);
  await trigger.click();
  await until(
    async () =>
      (await option("Trace 2").getAttribute("aria-checked")) === "true",
    "the picked trace to resume after the reload",
  );
  ctx.check("a picked trace resumes after a reload");

  await createDiagramReview(ctx);
  page = await ctx.apiCanvasFor(DIAGRAM_REVIEW_TITLE);
  await ctx.watchPage(page);

  const canvas = page.locator(".review-canvas-root [data-review-api]");

  // The telemetry notice's toast covers the tour's controls.
  await clearToasts(page);
  await canvas
    .locator(".sequence-diagram .diagram-tour-button")
    .first()
    .click();

  const overlay = page.locator(".diagram-tour-overlay");

  await overlay.getByRole("button", { name: / more steps$/ }).click();

  const count = () =>
    page
      .locator(".diagram-tour-overlay .tour-pill-count")
      .innerText({ timeout: 1000 })
      .catch(() => "");

  const atStepTwo = async () => /^2\/\d+$/.test(await count());

  await until(atStepTwo, "the sequence tour to reach step 2");
  await reloadWindow(ctx, page);
  await until(atStepTwo, "the sequence tour to resume at step 2");
  ctx.check("a fullscreen sequence tour resumes at its step after a reload");
}
