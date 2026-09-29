/** A reader's place in a review survives a renderer reload: a commit diff, a picked trace, a fullscreen tour step, and a map focus that must not replay. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { createReview, sleep } from "../harness.mjs";

export const name = "canvas-resume";

export const phase = 1;

export const options = {};

const TITLE = "Canvas resume review";

const TUTORIAL = "Review Desktop: three-minute tour";

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

const viewTab = (page, label) =>
  page.locator(`[aria-label="Session views"] button[aria-label="${label}"]`);

async function activate(ctx, page, label) {
  await viewTab(page, label).click();
  await waitPressed(ctx, page, label);
}

const waitPressed = (ctx, page, label) =>
  ctx.until(
    async () =>
      (await viewTab(page, label).getAttribute("aria-pressed")) === "true",
    `the ${label} view to be active`,
  );

const scopeSubject = (page) =>
  page
    .locator(".review-diff-scope-bar .review-diff-scope-subject")
    .innerText({ timeout: 1000 })
    .catch(() => null);

/** The ids of the Map view's selected nodes. */
const selectedNodes = (page) =>
  page
    .locator(".review-map-view .react-flow__node")
    .evaluateAll((nodes) =>
      nodes
        .filter(
          (node) =>
            node.classList.contains("selected") ||
            node.querySelector(".selected"),
        )
        .map((node) => node.dataset.id),
    );

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

  // The picker lists retained traces in load order, so the second one is held back to keep the first the default.
  await ctx.page
    .context()
    .route(`**/resources/${traceIds[1]}`, async (route) => {
      await sleep(1500);
      await route.continue();
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
      commandId: randomUUID(),
      operation,
    });

  let page = await ctx.apiCanvasFor(TITLE);

  await ctx.watchPage(page);

  await activate(ctx, page, "Commits");
  await page
    .locator(".review-commit-card")
    .filter({ has: page.getByText("Queue", { exact: true }) })
    .locator(".review-commit-open")
    .click();
  await waitPressed(ctx, page, "Diff");
  await until(
    async () => (await scopeSubject(page)) === "Queue",
    "the Queue commit diff",
  );
  await reloadWindow(ctx, page);
  await waitPressed(ctx, page, "Diff");
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
  await waitPressed(ctx, page, "Diff");
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
  await waitPressed(ctx, page, "Diff");
  await page.locator(".review-diff-view-host").waitFor();
  assert.equal(
    await page.locator(".review-diff-scope-bar").count(),
    0,
    "the dropped commit's scope bar is still shown",
  );
  assert.equal(await page.locator(".canvas-error").count(), 0);
  assert.deepEqual(ctx.pageErrors, []);
  ctx.check(
    "a new version keeps a listed commit's scope and drops an unlisted one",
  );

  const picker = page.locator(".review-trace-picker");

  const option = (label) =>
    picker.getByRole("option").filter({ hasText: label });

  await activate(ctx, page, "Trace");
  await picker.locator(".review-trace-picker-trigger").click();
  assert.equal(
    await option("Trace 1").getAttribute("aria-selected"),
    "true",
    "the first trace is not the default",
  );
  await option("Trace 2").click();
  await until(
    async () =>
      (
        await picker.locator(".review-trace-picker-title").innerText()
      ).trim() === "Trace 2",
    "the picked trace to show",
  );
  await reloadWindow(ctx, page);
  await waitPressed(ctx, page, "Trace");
  await page
    .locator(".review-trace-picker .review-trace-picker-trigger")
    .click();
  await until(
    async () =>
      (await page
        .locator(".review-trace-picker")
        .getByRole("option")
        .filter({ hasText: "Trace 2" })
        .getAttribute("aria-selected")) === "true",
    "the picked trace to resume after the reload",
  );
  ctx.check("a picked trace resumes after a reload");

  await ctx.page.keyboard.press("F1");
  await ctx.page
    .locator(".quick-input-widget input")
    .fill(">Whiteboard: Open Tutorial");
  await ctx.page
    .getByRole("option", { name: /Whiteboard: Open Tutorial/ })
    .click();
  page = await ctx.apiCanvasFor(TUTORIAL);
  await ctx.watchPage(page);

  const canvas = page.locator(".review-canvas-root [data-review-api]");

  const lens = canvas
    .locator('[data-review-section="Interactive Diagrams"] .database-lens')
    .first();

  // The lens's actors name software-map paths, yet no tour stop offers the map.
  await lens.locator(".diagram-tour-button").click();

  const tour = page.locator('[role="dialog"][aria-label$=" tour"]');

  await tour.locator(".tour-stop-main").first().waitFor();
  assert.equal(
    await tour.locator('button[aria-label$=" in software map"]').count(),
    0,
  );
  await ctx.knownBug(
    "Peeks and tour stops never offer to show their element in the software map",
  );
  await page.keyboard.press("Escape");
  await tour.waitFor({ state: "hidden" });

  // So the focus request goes through the same review action the button calls.
  const focusOrders = () =>
    lens.evaluate((element) => {
      const key = Object.keys(element).find((k) =>
        k.startsWith("__reactFiber$"),
      );

      for (let fiber = element[key]; fiber; fiber = fiber.return) {
        const open = fiber.memoizedProps?.value?.openSoftwareMapElement;

        if (open) return open("orderService.application.orders");
      }

      throw new Error("no review actions above the database lens");
    });

  const selected = (id, label) =>
    until(async () => (await selectedNodes(page)).join() === id, label);

  await focusOrders();
  await waitPressed(ctx, page, "Map (Experimental)");
  await selected(
    "orderService.application.orders",
    "the focus request that mounts the Map view to select its element",
  );
  await page.waitForTimeout(1000);
  assert.deepEqual(
    await selectedNodes(page),
    ["orderService.application.orders"],
    "the Map view's default selection replaced the focused element",
  );
  ctx.check("a focus request that mounts the Map view selects its element");

  await activate(ctx, page, "Whiteboard");
  await focusOrders();
  await waitPressed(ctx, page, "Map (Experimental)");
  await selected(
    "orderService.application.orders",
    "the focused map element to be selected",
  );
  await page
    .locator(
      '.review-map-view .react-flow__node[data-id="orderService.application"]',
    )
    .click({ position: { x: 12, y: 12 } });
  await selected(
    "orderService.application",
    "the reader's node to be selected",
  );
  await activate(ctx, page, "Whiteboard");
  await activate(ctx, page, "Map (Experimental)");
  await page.waitForTimeout(1000);
  assert.deepEqual(
    await selectedNodes(page),
    ["orderService.application"],
    "coming back to Map replayed the focus request",
  );
  ctx.check("a map focus request does not replay over the reader's selection");

  await activate(ctx, page, "Whiteboard");
  await canvas
    .locator(
      '[data-review-section="Interactive Diagrams"] .sequence-diagram .diagram-tour-button',
    )
    .first()
    .click();

  const overlay = page.locator(".diagram-tour-overlay");

  await overlay.locator(".tour-pill--intro").click();

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
