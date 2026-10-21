import assert from "node:assert/strict";
import path from "node:path";

import {
  DIAGRAM_REVIEW_TITLE,
  createDiagramReview,
  inView,
  openFullTrace,
  showView,
} from "../harness.mjs";

export const name = "diagram-persistence";

export const phase = 1;

export const options = { seedRepo: false };

const TITLE = "Diagram persistence review";

export async function run(ctx) {
  const check = ctx.check;
  ctx.check = (...items) => {
    console.error(...items);
    check(...items);
  };

  await createDiagramReview(ctx);
  let page = await ctx.apiCanvasFor(DIAGRAM_REVIEW_TITLE);

  const canvas = () => page.locator(".review-canvas-root [data-review-api]");

  async function reload() {
    await page.keyboard.press("F1");
    await page
      .locator(".quick-input-widget input")
      .fill(">Developer: Reload Window");
    const loaded = page.waitForEvent("domcontentloaded");
    await page
      .getByRole("option", { name: /Developer: Reload Window/ })
      .click();
    await loaded;
    page = ctx.page;
    await canvas().waitFor();
    await ctx.watchPage(page);
  }

  const useCase = () =>
    page.getByRole("combobox", { name: "Database use case" }).first();

  const values = await useCase()
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));

  assert.ok(values.length > 1, "the diagram review needs multiple database use cases");
  await useCase().selectOption(values.at(-1));
  await reload();
  assert.equal(await useCase().inputValue(), values.at(-1));
  ctx.check("database use case survives reload");
  await openFullTrace(ctx, canvas().locator('a[href^="#trace-"]').first(), page);
  const events = () => page.locator("[data-trace-event]");
  await events().first().waitFor();

  const tick = page
    .locator(".review-view-region--trace .review-trace-ruler-tick")
    .last();

  const rail = tick.locator("..");
  const tickBox = await tick.boundingBox();
  const railBox = await rail.boundingBox();
  assert.ok(tickBox && railBox, "trace ruler is visible");
  await rail.click({ position: { x: 2, y: tickBox.y - railBox.y + 1 } });
  const target = () => page.locator("#review-trace-target-event");
  await target().waitFor();
  const selectedEvent = await target().getAttribute("data-trace-event");
  assert.ok(selectedEvent !== null, "a trace event was selected");
  await reload();
  await inView(ctx, "trace", page);
  await events().first().waitFor();
  await target().waitFor();
  assert.equal(await target().getAttribute("data-trace-event"), selectedEvent);
  ctx.check("trace selection, event and view survive reload");
  await ctx.quitAndRelaunchDesktop();
  page = ctx.page;
  await canvas().waitFor();
  await inView(ctx, "trace", page);
  await events().first().waitFor();
  await target().waitFor();
  assert.equal(await target().getAttribute("data-trace-event"), selectedEvent);
  await showView(ctx, "Whiteboard", page);
  assert.equal(await useCase().inputValue(), values.at(-1));
  ctx.check("trace and database state survive application relaunch");
  await page.screenshot({ path: path.join(ctx.root, "diagrams-restored.png") });
}
