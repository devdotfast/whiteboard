/** Find typed into a whiteboard full of code peeks keeps the renderer responsive (#796). */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { createReview } from "../harness.mjs";

export const name = "find-peek-performance";

export const phase = 1;

export const options = {
  env: { DEV_FAST_REVIEW_DESKTOP_BACKGROUND: "1" },
};

const TITLE = "Find across peeks";

const FILES = 30;

const LINES = 1500;

const QUERY = "status";

const source = (file, revision) =>
  Array.from(
    { length: LINES },
    (_, line) =>
      `export const status${file}_${line} = "${line % 10 === 0 ? revision : "same"}";\n`,
  ).join("");

export async function run(ctx) {
  const { git, until } = ctx;

  const files = Array.from({ length: FILES }, (_, file) => `module${file}.ts`);

  for (const [index, file] of files.entries())
    await writeFile(path.join(ctx.repo, file), source(index, "draft"));
  await git("add", ".");
  await git("commit", "-qm", "Modules");
  const base = await git("rev-parse", "HEAD");

  for (const [index, file] of files.entries())
    await writeFile(path.join(ctx.repo, file), source(index, "queued"));
  await git("commit", "-qam", "Queue modules");
  const head = await git("rev-parse", "HEAD");

  await createReview(ctx, {
    title: TITLE,
    base,
    head,
    blocks: files.map((file) => ({
      type: "code_peek",
      source: {
        file,
        start: { side: "head", line: 1 },
        end: { side: "head", line: 40 },
      },
    })),
  });

  const page = await ctx.apiCanvasFor(TITLE);

  await ctx.watchPage(page);

  const find = page.locator('[role="search"][aria-label="Find in session"]');

  const countText = async () =>
    (await find.locator("[aria-live]").innerText()).trim();

  await until(
    async () =>
      (await page.locator("[data-review-inline-editor]").count()) === FILES,
    "every code peek to register",
  );

  await page.evaluate(() => {
    const probe = { longest: 0, total: 0 };

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        probe.longest = Math.max(probe.longest, entry.duration);
        probe.total += entry.duration;
      }
    }).observe({ type: "longtask" });
    globalThis.__findProbe = probe;
  });

  await page.keyboard.press("ControlOrMeta+KeyF");
  await find.waitFor();
  const started = Date.now();

  await find.locator('[aria-label="Find"]').pressSequentially(QUERY, {
    delay: 80,
  });
  const typed = Date.now();

  // Peeks report after the prose, so the count is read once it holds still.
  let settled = 0;

  await until(
    async () => {
      const text = await countText();

      if (!/^1 of \d+$/.test(text)) return false;
      settled = Date.now();
      await page.waitForTimeout(1000);

      return (await countText()) === text;
    },
    "a settled match count",
    120_000,
  );
  const probe = await page.evaluate(() => globalThis.__findProbe);

  const timings = {
    typingMs: typed - started,
    settleMs: settled - typed,
    longestTaskMs: Math.round(probe.longest),
    blockedMs: Math.round(probe.total),
  };

  ctx.report.timings = timings;

  assert.ok(
    timings.blockedMs < 1000,
    `Find blocked the renderer for ${timings.blockedMs} ms`,
  );
  ctx.check("Find across many code peeks keeps the renderer responsive");
}
