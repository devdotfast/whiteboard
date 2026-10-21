/** Find across every file of a large Diff tab stays responsive, and steps between files quickly. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { createReview, showView } from "../harness.mjs";

export const name = "diff-find-performance";

export const phase = 1;

const TITLE = "Find across the diff";

const FILES = Number(process.env.DIFF_FIND_FILES ?? 300);

const LINES = 400;

// The first query also waits for the structural stream, so it is the cold
// search. "status" is on every line; its repeat reuses the index.
const QUERIES = ["queued", "status", "status"];

// Every tenth line changes, so it counts on both sides; the rest only on head.
const EXPECTED = {
  queued: (FILES * LINES) / 10,
  status: FILES * (LINES + LINES / 10),
};

const STEPS = 10;

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

  await createReview(ctx, { title: TITLE, base, head, blocks: [] });

  const page = await ctx.apiCanvasFor(TITLE);

  await ctx.watchPage(page);

  await showView(ctx, "Diff", page);

  const rendered = page.locator(".multiDiffEntry .view-line");

  await until(
    async () => (await rendered.count()) > 0,
    "the first file's code",
    180_000,
  );

  const find = page.locator('[role="search"][aria-label="Find in session"]');

  const countText = async () =>
    (await find.locator("[aria-live]").innerText()).trim();

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

  // Ctrl+F from inside an inner editor used to open Monaco's single-file find.
  await rendered.first().click();
  await page.keyboard.press("ControlOrMeta+KeyF");
  await find.waitFor();
  // The counts below assume nothing is folded.
  await find.locator('button[aria-label="Skip Folded"]').click();

  const input = find.locator('[aria-label="Find"]');

  const timings = { files: FILES, queries: [] };

  for (const [index, query] of QUERIES.entries()) {
    await input.fill("");
    await page.evaluate(() => {
      globalThis.__findProbe.longest = 0;
      globalThis.__findProbe.total = 0;
    });

    // DIFF_FIND_PROFILE=1 writes a CPU profile of each search next to the report.
    const profiler = process.env.DIFF_FIND_PROFILE
      ? await page.context().newCDPSession(page)
      : undefined;

    if (profiler) {
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.start");
    }

    const started = Date.now();

    await input.pressSequentially(query, { delay: 80 });
    const typed = Date.now();

    let settled = 0;
    let count = "";

    await until(
      async () => {
        const text = await countText();

        if (!/^1 of \d+$/.test(text)) return false;
        settled = Date.now();
        count = text;
        await page.waitForTimeout(1000);

        return (await countText()) === text;
      },
      `a settled match count for ${query}`,
      120_000,
    );

    if (profiler) {
      const { profile } = await profiler.send("Profiler.stop");

      await writeFile(
        path.join(ctx.root, `find-${query}.cpuprofile`),
        JSON.stringify(profile),
      );
      await profiler.detach();
    }

    const steps = [];

    for (let step = 0; step < STEPS; step++) {
      const before = await countText();
      const at = Date.now();

      await page.keyboard.press("Enter");
      await until(
        async () => (await countText()) !== before,
        "the next match",
        30_000,
      );
      steps.push(Date.now() - at);
    }

    await until(
      async () =>
        (await page.locator(".multiDiffEntry .currentFindMatch").count()) > 0,
      "the active match decoration",
    );
    const probe = await page.evaluate(() => globalThis.__findProbe);

    timings.queries.push({
      query,
      cold: index === 0,
      matches: Number(count.replace(/^1 of /, "")),
      typingMs: typed - started,
      settleMs: settled - typed,
      stepMs: steps,
      longestTaskMs: Math.round(probe.longest),
      blockedMs: Math.round(probe.total),
    });
  }

  ctx.report.timings = timings;

  for (const result of timings.queries) {
    const { query } = result;

    assert.equal(
      result.matches,
      EXPECTED[query],
      `Find for ${query} counted ${result.matches} matches`,
    );

    if (result.cold) continue;
    assert.ok(
      result.blockedMs < 1500,
      `Find for ${query} blocked the renderer for ${result.blockedMs} ms`,
    );
    assert.ok(
      result.settleMs < 5000,
      `Find for ${query} took ${result.settleMs} ms to count`,
    );
  }

  ctx.check("Find across a large diff keeps the renderer responsive");
}
