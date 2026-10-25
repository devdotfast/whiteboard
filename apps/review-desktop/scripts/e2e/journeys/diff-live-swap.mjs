/** A save or commit under an open Diff updates it in place, where the reader is, never showing a loader. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createReview, showView } from "../harness.mjs";

export const name = "diff-live-swap";

export const phase = 1;

export const options = {};

const TITLE = "Live diff";

const FILES = 6;

const LINES = 300;

const source = (file, edit = (line) => line) =>
  Array.from({ length: LINES }, (_, index) =>
    edit(`const v${file} = ${index + 1}`),
  ).join("\n") + "\n";

export async function run(ctx) {
  const { git, until } = ctx;
  const fileName = (file) => path.join(ctx.repo, `f${file}.ts`);

  for (let file = 1; file <= FILES; file++)
    await writeFile(fileName(file), source(file));
  await git("add", ".");
  await git("commit", "-qm", "Files");
  // An agent's branch: a commit moves the head pin, not the base.
  await git("checkout", "-qb", "agent");

  for (let file = 1; file <= FILES; file++)
    await writeFile(
      fileName(file),
      source(file, (line) =>
        line.replace(/= 50$/, "= 50 + 1").replace(/= 250$/, "= 250 * 2"),
      ),
    );

  await createReview(ctx, { title: TITLE, worktree: true, blocks: [] });

  const page = await ctx.apiCanvasFor(TITLE);

  await page.evaluate(() => {
    window.__shownDiff = () =>
      [...document.querySelectorAll(".review-files-editor")].find((root) =>
        root.checkVisibility({ visibilityProperty: true }),
      );
  });
  await showView(ctx, "Diff", page);
  await until(
    () =>
      page.evaluate(() => {
        const root = window.__shownDiff();

        return (
          root?.querySelector(".review-structural-stream-status")?.hidden &&
          root.querySelectorAll(".multiDiffEntry .view-line").length > 20
        );
      }),
    "the Diff to finish loading",
  );

  const box = await page.evaluate(() => {
    const { x, y, width, height } = window
      .__shownDiff()
      .querySelector(".review-files-editor-diffs")
      .getBoundingClientRect();

    return { x: x + width * 0.75, y: y + height / 2 };
  });

  await page.mouse.move(box.x, box.y);

  for (let step = 0; step < 6; step++) {
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(60);
  }

  await page.waitForTimeout(500);

  const onScreen = () =>
    page.evaluate(() => {
      const pane = window
        .__shownDiff()
        .querySelector(".review-files-editor-diffs");

      const { top, height } = pane.getBoundingClientRect();

      return [...pane.querySelectorAll(".editor.modified .view-line")]
        .flatMap((line) => {
          const y = line.getBoundingClientRect().top - top;
          const text = line.textContent.replace(/\s+/g, " ").trim();

          return text && y >= 0 && y < height ? [{ y, text }] : [];
        })
        .sort((a, b) => a.y - b.y);
    });

  // A line the reader can see, below the one that anchors the position.
  const target = (await onScreen())
    .slice(1)
    .map(({ text }) => /^const v(\d) = (\d+)/.exec(text))
    .find(Boolean);

  assert.ok(target, "no line on screen to edit");

  const [, file, line] = target;

  const swap = async (label, mark, after = async () => {}, above = false) => {
    const [anchor] = await onScreen();

    await page.evaluate((anchor) => {
      const log = (window.__liveSwap = { loader: 0, empty: 0, rebuilt: 0, drift: 0 });
      const first = window.__shownDiff();

      const tick = () => {
        const root = window.__shownDiff();
        const status = root?.querySelector(".review-structural-stream-status");
        const pane = root?.querySelector(".review-files-editor-diffs");

        const line = [...(pane?.querySelectorAll(".editor.modified .view-line") ?? [])].find(
          (line) => line.textContent.replace(/\s+/g, " ").trim() === anchor.text,
        );

        log.empty += root ? 0 : 1;
        log.rebuilt += root && root !== first ? 1 : 0;
        log.loader += status && !status.hidden ? 1 : 0;

        if (line)
          log.drift = Math.max(
            log.drift,
            Math.abs(line.getBoundingClientRect().top - pane.getBoundingClientRect().top - anchor.y),
          );

        if (!log.stop) requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    }, anchor);

    if (above) {
      const [, anchorFile, anchorLine] = /^const v(\d) = (\d+)/.exec(anchor.text);

      assert.ok(
        anchorFile > 1 || anchorLine > 60,
        `"${anchor.text}" has no change above it to grow`,
      );
      // Lines added above the reader must not push what they read.
      const first = await readFile(fileName(1), "utf8");

      await writeFile(
        fileName(1),
        first.replace(
          /^const v1 = 50 \+ 1$/m,
          "const v1 = 50 + 1\nconst v1a = 0\nconst v1b = 0\nconst v1c = 0",
        ),
      );
    }

    const text = await readFile(fileName(file), "utf8");

    await writeFile(
      fileName(file),
      text.replace(
        new RegExp(`^const v${file} = ${line}\\b.*$`, "m"),
        `const v${file} = ${line} - ${mark}`,
      ),
    );
    await after();
    await until(
      async () => (await onScreen()).some(({ text }) => text.endsWith(mark)),
      `the ${label} to reach the shown diff`,
    );
    await page.waitForTimeout(500);

    const frames = await page.evaluate(() => {
      window.__liveSwap.stop = true;

      return window.__liveSwap;
    });

    assert.equal(frames.loader, 0, `a loader showed during the ${label}`);
    assert.equal(frames.empty, 0, `the Diff went blank during the ${label}`);
    assert.equal(frames.rebuilt, 0, `the Diff was rebuilt during the ${label}`);
    assert.ok(frames.drift <= 2, `the ${label} moved "${anchor.text}" ${frames.drift}px mid-update`);

    const moved = (await onScreen()).find(({ text }) => text === anchor.text);

    assert.ok(
      moved && Math.abs(moved.y - anchor.y) <= 2,
      `the ${label} moved "${anchor.text}" from ${anchor.y} to ${moved?.y}`,
    );
  };

  await swap("save", "4242");
  ctx.check("a save updates the open Diff in place, without a loader");
  await swap("commit", "4343", () => git("commit", "-qam", "Save"));
  ctx.check("a commit updates the open Diff in place, without a loader");
  await swap("save above the reader", "4444", undefined, true);
  ctx.check("lines added above the reader keep their place");
}
