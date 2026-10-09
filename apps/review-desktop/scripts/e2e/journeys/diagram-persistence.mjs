import assert from "node:assert/strict";
import path from "node:path";

import { createDiagramReview } from "../harness.mjs";

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

  await createDiagramReview(ctx, TITLE);
  let page = await ctx.apiCanvasFor(TITLE);

  const tab = (label) =>
    page.locator(`[aria-label="Session views"] button[aria-label="${label}"]`);

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
    await page.locator(".review-canvas-root [data-review-api]").waitFor();
    await ctx.watchPage(page);
  }

  await tab("Map (Experimental)").click();
  const map = () => page.locator(".review-view-region--map");

  const nodes = () =>
    map()
      .locator('.react-flow__node [aria-label]:not([data-selected="true"])')
      .filter({ visible: true });

  await nodes().first().waitFor();
  const node = nodes().last();

  const nodeId = await node.evaluate((el) =>
    el.closest(".react-flow__node").getAttribute("data-id"),
  );

  const selectedNode = () =>
    map().locator(
      `.react-flow__node[data-id=${JSON.stringify(nodeId)}] [data-selected="true"]`,
    );

  await node.click();
  await ctx.until(
    async () => (await selectedNode().count()) > 0,
    "map node selected",
  );
  await reload();
  await ctx.until(
    async () => (await selectedNode().count()) > 0,
    "map selection restored",
  );
  ctx.check("map tab and selected node survive reload");
  await tab("Whiteboard").click();

  const useCase = () =>
    page.getByRole("combobox", { name: "Database use case" }).first();

  const values = await useCase()
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));

  assert.ok(values.length > 1, "the review needs multiple database use cases");
  await useCase().selectOption(values.at(-1));
  await reload();
  assert.equal(await useCase().inputValue(), values.at(-1));
  ctx.check("database use case survives reload");
  await tab("Trace").click();
  await ctx.until(
    async () => (await tab("Trace").getAttribute("aria-pressed")) === "true",
    "trace opened",
  );
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
  await ctx.until(
    async () => (await tab("Trace").getAttribute("aria-pressed")) === "true",
    "trace tab restored",
  );
  await events().first().waitFor();
  await target().waitFor();
  assert.equal(await target().getAttribute("data-trace-event"), selectedEvent);
  ctx.check("trace selection, event and tab survive reload");
  await ctx.quitAndRelaunchDesktop();
  page = ctx.page;
  await page.locator(".review-canvas-root [data-review-api]").waitFor();
  await events().first().waitFor();
  await target().waitFor();
  assert.equal(await target().getAttribute("data-trace-event"), selectedEvent);
  await tab("Map (Experimental)").click();
  await ctx.until(
    async () => (await selectedNode().count()) > 0,
    "map selection after relaunch",
  );
  await tab("Whiteboard").click();
  assert.equal(await useCase().inputValue(), values.at(-1));
  ctx.check("trace, map and database state survive application relaunch");
  await page.screenshot({ path: path.join(ctx.root, "diagrams-restored.png") });
}
