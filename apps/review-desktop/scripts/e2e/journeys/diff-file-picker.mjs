/** ⌘P on a review lists the Diff tab's files, follows the active lens, and scrolls the diff to the one picked. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createReview } from "../harness.mjs";

export const name = "diff-file-picker";

export const phase = 1;

export const options = {};

const TITLE = "File picker";

const FILES = [
  "src/api/orders.ts",
  "src/db/ledger.ts",
  "web/cart/basket.ts",
  "docs/rollout.md",
];

const source = (file, lines) =>
  Array.from(
    { length: lines },
    (_, line) => `export const ${path.parse(file).name}${line} = ${line};`,
  ).join("\n") + "\n";

export async function run(ctx) {
  const { git, until } = ctx;

  for (const file of FILES) {
    await mkdir(path.join(ctx.repo, path.dirname(file)), { recursive: true });
    await writeFile(path.join(ctx.repo, file), source(file, 3));
  }

  await git("add", ".");
  await git("commit", "-qm", "Stubs");
  const base = await git("rev-parse", "HEAD");

  // Every line added, so nothing folds and each file is taller than the view.
  for (const file of FILES)
    await writeFile(path.join(ctx.repo, file), source(file, 150));
  await git("commit", "-qam", "Grow");
  const head = await git("rev-parse", "HEAD");

  const review = await createReview(ctx, {
    title: TITLE,
    base,
    head,
    blocks: [],
  });

  const page = await ctx.apiCanvasFor(TITLE);

  await ctx.watchPage(page);

  const views = page.locator('[aria-label="Session views"]');

  const pressed = (label) =>
    views.locator(`button[aria-label="${label}"]`).getAttribute("aria-pressed");

  await until(
    async () => (await pressed("Whiteboard")) === "true",
    "the Review tab to be active",
  );

  const picker = page.locator(".quick-input-widget");

  const rows = picker.locator(".quick-input-list .monaco-list-row");

  const listed = async () =>
    (
      await rows.evaluateAll((nodes) =>
        nodes.map((row) => {
          const name = row.querySelector(".label-name")?.textContent ?? "";
          const folder = row.querySelector(".label-description")?.textContent;

          return folder ? `${folder}/${name}` : name;
        }),
      )
    ).sort();

  const openPicker = async (expected) => {
    await page.keyboard.press("ControlOrMeta+KeyP");
    await picker.waitFor();
    await until(
      async () =>
        JSON.stringify(await listed()) === JSON.stringify([...expected].sort()),
      `the picker to list ${expected.join(", ")}`,
    );
  };

  const pick = async (query, file) => {
    await picker.locator("input").fill(query);
    await until(
      async () => (await listed()).join() === file,
      `"${query}" to narrow the picker to ${file}`,
    );
    await page.keyboard.press("Enter");
    await picker.waitFor({ state: "hidden" });
  };

  /** The visible diff's active file and how far its top sits below the list's. */
  const active = () =>
    page.evaluate(() => {
      for (const entry of document.querySelectorAll(".multiDiffEntry.active")) {
        if (!entry.checkVisibility()) continue;
        const list = entry.closest(".multiDiffEditor").getBoundingClientRect();

        return {
          header: entry.querySelector(".header")?.textContent ?? "",
          offset: entry.getBoundingClientRect().top - list.top,
        };
      }

      return null;
    });

  const revealed = async (file) => {
    await until(
      async () => (await pressed("Diff")) === "true",
      "the Diff tab to be active",
    );
    await until(async () => {
      const entry = await active();

      return (
        entry?.header.includes(path.basename(file)) &&
        Math.abs(entry.offset) < 40
      );
    }, `${file} to be the active diff at the top of the view`);
  };

  await openPicker(FILES);
  ctx.check("⌘P on the Review tab lists the diff's files");

  await pick("ldgr", "src/db/ledger.ts");
  await revealed("src/db/ledger.ts");
  ctx.check("a fuzzy pick opens the Diff tab at that file");

  const box = await page
    .locator(".multiDiffEditor")
    .filter({ visible: true })
    .first()
    .boundingBox();

  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await until(async () => {
    await page.mouse.wheel(0, 2000);

    return !(await active())?.header.includes("ledger.ts");
  }, "the diff to scroll past ledger.ts");

  await openPicker(FILES);
  await pick("ldgr", "src/db/ledger.ts");
  await revealed("src/db/ledger.ts");
  ctx.check("picking the same file again scrolls back to it");

  const lens = await ctx.api("/reviews-api/commands", "POST", {
    operation: {
      type: "lens_edit",
      reviewId: review.reviewId,
      edit: {
        type: "insert",
        title: "Server",
        targets: [{ kind: "files", patterns: ["src/**"] }],
      },
    },
  });

  assert.equal(lens.status, 200, JSON.stringify(lens.value));

  const toggle = page.locator(
    `section[data-lens-id="${lens.value.targetId}"] button[aria-pressed]`,
  );

  await toggle.click();
  await until(
    async () => (await toggle.getAttribute("aria-pressed")) === "true",
    "the Server lens to activate",
  );

  await openPicker(FILES.filter((file) => file.startsWith("src/")));
  await pick("ordrs", "src/api/orders.ts");
  await revealed("src/api/orders.ts");
  ctx.check("with a lens active, ⌘P lists and reveals only the lens's files");
}
