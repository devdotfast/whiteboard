import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { createReview } from "../harness.mjs";

export const name = "editor-persistence";

export const phase = 1;

export const options = {};

export async function run(ctx) {
  const check = ctx.check;
  ctx.check = (...items) => {
    console.error(...items);
    check(...items);
  };

  const title = "Persistence E2E";

  for (const file of ["alpha.ts", "beta.ts", "gamma.ts"])
    await writeFile(
      path.join(ctx.repo, file),
      Array.from(
        { length: 160 },
        (_, i) => `export const value${i} = ${i};`,
      ).join("\n") + "\n",
    );
  await ctx.git("add", ".");
  await ctx.git("commit", "-qm", "Persistence files");
  const head = await ctx.git("rev-parse", "HEAD");
  await createReview(ctx, {
    title,
    head,
    blocks: [
      {
        type: "section",
        title: "Long document",
        children: Array.from({ length: 18 }, (_, i) => ({
          type: "section",
          title: `Section ${i}`,
          children: [
            {
              type: "markdown",
              markdown:
                "Persistent state restores the reader position. ".repeat(30),
            },
          ],
        })),
      },
    ],
  });
  let page = await ctx.apiCanvasFor(title);
  ctx.check("fixture review opened");

  const tab = (label) =>
    page.locator(`[aria-label="Session views"] button[aria-label="${label}"]`);

  const region = () => page.locator(".review-view-region--review");

  async function reload() {
    await page.keyboard.press("F1");
    await page
      .locator(".quick-input-widget input")
      .fill(">Developer: Reload Window");
    await page
      .getByRole("option", { name: /Developer: Reload Window/ })
      .click();
    await page.waitForEvent("domcontentloaded");
    page = ctx.page;
    await page.locator(".review-canvas-root [data-review-api]").waitFor();
    await ctx.watchPage(page);
  }

  await region().hover();
  await page.mouse.wheel(0, 1450);
  await ctx.until(async () => {
    const value = await region().evaluate((el) => el.scrollTop);

    return value > 500 ? value : null;
  }, "document scroll");
  await page.waitForTimeout(500);
  const top = await region().evaluate((el) => el.scrollTop);
  await reload();
  await ctx.until(
    async () =>
      Math.abs((await region().evaluate((el) => el.scrollTop)) - top) < 30,
    "document position after reload",
  );
  ctx.check("document scroll survives window reload");

  await region().click({ position: { x: 200, y: 100 } });
  await page.keyboard.press("ControlOrMeta+KeyF");
  const find = () => page.getByRole("search", { name: "Find in session" });
  await find()
    .getByRole("textbox", { name: "Find", exact: true })
    .fill("Persistent");
  await find().getByRole("button", { name: "Match Case", exact: true }).click();
  await page.keyboard.press("Escape");
  await reload();
  await region().click({ position: { x: 200, y: 100 } });
  await page.keyboard.press("ControlOrMeta+KeyF");
  assert.equal(
    await find()
      .getByRole("textbox", { name: "Find", exact: true })
      .inputValue(),
    "Persistent",
  );
  assert.equal(
    await find()
      .getByRole("button", { name: "Match Case", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.keyboard.press("Escape");
  ctx.check("find query and options survive window reload");

  await tab("Commits").click();
  await page
    .getByRole("button", { name: "Persistence files", exact: true })
    .click();
  await page.getByRole("button", { name: /alpha.ts/ }).click();

  const diff = () => page.locator(".review-diff-view--scoped .multiDiffEditor");

  await diff().waitFor();
  await diff().locator(".view-line").first().waitFor();
  await ctx.until(
    async () =>
      (await page
        .locator(
          ".review-diff-view--scoped .review-structural-stream-status.loading",
        )
        .count()) === 0,
    "native diff stream complete",
  );
  await diff().hover();
  await page.mouse.wheel(0, 1700);
  await page.waitForTimeout(1000);

  const position = () =>
    diff().evaluate((element) => {
      const frame = element.getBoundingClientRect();

      const line = [...element.querySelectorAll(".view-line")].find((line) => {
        const rect = line.getBoundingClientRect();

        return (
          rect.y >= frame.y + 60 &&
          rect.bottom < frame.bottom &&
          line.textContent?.trim()
        );
      });

      return line
        ? {
            text: line.textContent,
            offset: line.getBoundingClientRect().y - frame.y,
          }
        : null;
    });

  const nativePosition = await position();
  assert.ok(nativePosition, "native diff has no visible content");

  const restoredPosition = async () => {
    const current = await position();

    return (
      current?.text === nativePosition.text &&
      Math.abs(current.offset - nativePosition.offset) < 2
    );
  };

  await page.screenshot({
    path: path.join(ctx.root, "diff-before-reload.png"),
  });
  await reload();
  await ctx.until(
    async () => (await tab("Diff").getAttribute("aria-pressed")) === "true",
    "commit diff view restored",
  );
  await ctx.until(
    restoredPosition,
    `native reading position restored: ${JSON.stringify(nativePosition)}`,
  );
  ctx.check("commit navigation and native diff scroll survive window reload");
  await page.screenshot({ path: path.join(ctx.root, "diff-restored.png") });
  await ctx.quitAndRelaunchDesktop();
  page = ctx.page;
  await page.locator(".review-canvas-root [data-review-api]").waitFor();
  await ctx.until(restoredPosition, "native scroll after application relaunch");
  ctx.check(
    "commit diff and native scroll survive real application quit and relaunch",
  );
  await diff().hover();
  await page.mouse.wheel(0, -20000);

  const alpha = () =>
    diff().locator(".header[aria-expanded]").filter({ hasText: "alpha.ts" });

  await alpha().waitFor();
  await alpha().locator(".collapse-button").click();
  assert.equal(await alpha().getAttribute("aria-expanded"), "false");
  await reload();
  await ctx.until(
    async () => (await alpha().getAttribute("aria-expanded")) === "false",
    "collapsed file after reload",
  );
  await ctx.quitAndRelaunchDesktop();
  page = ctx.page;
  await ctx.until(
    async () => (await alpha().getAttribute("aria-expanded")) === "false",
    "collapsed file after relaunch",
  );
  ctx.check("native file collapse survives reload and application relaunch");
  await tab("Commits").click();
  await page
    .getByRole("button", { name: "Persistence files", exact: true })
    .click();
  await page.getByRole("button", { name: /gamma.ts/ }).click();
  await diff().locator(".header").filter({ hasText: "gamma.ts" }).waitFor();
  await ctx.until(async () => {
    const header = await diff()
      .locator(".header")
      .filter({ hasText: "gamma.ts" })
      .boundingBox();

    const frame = await diff().boundingBox();

    return header && frame && Math.abs(header.y - frame.y) < 80;
  }, "explicit file click overrides previous saved scroll");
  ctx.check("explicit commit file navigation overrides saved editor position");
}
