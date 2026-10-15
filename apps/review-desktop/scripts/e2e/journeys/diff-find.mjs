/** Find on the Diff tab counts what the reader can see: lens switches, unfolded lines, peeks and multiline regexes. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { createReview } from "../harness.mjs";

export const name = "diff-find";

export const phase = 1;

export const options = {
  env: { DEV_FAST_REVIEW_DESKTOP_BACKGROUND: "1" },
};

const TITLE = "Find what you see";

const lines = (count, line) =>
  Array.from({ length: count }, (_, index) => `${line(index + 1)}\n`).join("");

// Each file changes only where its revision matters; everything else is context.
const files = (revision) => ({
  "folded.ts": lines(300, (line) =>
    line === 1 || line === 300
      ? `export const edge${line} = "${revision}";`
      : line === 150
        ? `export const hiddenword = ${line};`
        : `export const folded${line} = ${line};`,
  ),
  "lens-a.ts": lines(20, (line) =>
    line % 10 === 0
      ? `export const needle${line} = "${revision}";`
      : `export const a${line} = ${line};`,
  ),
  "lens-b.ts": lines(30, (line) =>
    line % 10 === 0
      ? `export const needle${line} = "${revision}";`
      : `export const b${line} = ${line};`,
  ),
  "multi.ts": `export const alpha = 1;\nexport const ${revision === "base" ? "old" : "new"} = 2;\n`,
  "peek.ts": lines(200, (line) =>
    line === 10
      ? `export const peekword = "${revision}";`
      : line === 150
        ? `export const peekword150 = ${line};`
        : `export const peek${line} = ${line};`,
  ),
  ...Object.fromEntries(
    Array.from({ length: 20 }, (_, file) => [
      `z${String(file).padStart(2, "0")}.ts`,
      lines(120, (line) =>
        file === 19 && line === 120
          ? `export const zzend = "${revision}";`
          : `export const z${file}_${line} = "${revision}";`,
      ),
    ]),
  ),
});

export async function run(ctx) {
  const { git, until } = ctx;

  const commit = async (revision) => {
    for (const [file, text] of Object.entries(files(revision)))
      await writeFile(path.join(ctx.repo, file), text);
    await git("add", ".");
    await git("commit", "-qm", revision);

    return git("rev-parse", "HEAD");
  };

  const base = await commit("base");
  const head = await commit("head");

  const review = await createReview(ctx, {
    title: TITLE,
    base,
    head,
    blocks: [
      {
        type: "code_peek",
        source: "head/peek.ts#L5-L15",
      },
    ],
  });

  const lens = async (title, file) => {
    const result = await ctx.api("/reviews-api/commands", "POST", {
      operation: {
        type: "lens_edit",
        reviewId: review.reviewId,
        edit: {
          type: "insert",
          title,
          targets: [{ kind: "files", patterns: [file] }],
        },
      },
    });

    assert.equal(result.status, 200, JSON.stringify(result.value));

    return result.value.targetId;
  };

  const lensA = await lens("Lens A", "lens-a.ts");
  const lensB = await lens("Lens B", "lens-b.ts");

  const page = await ctx.apiCanvasFor(TITLE);

  await ctx.watchPage(page);

  const find = page.locator('[role="search"][aria-label="Find in session"]');
  const input = find.locator('[aria-label="Find"]');

  const countText = async () =>
    (await find.locator("[aria-live]").innerText()).trim();

  const option = async (label, on) => {
    const toggle = find.locator(`button[aria-label="${label}"]`);

    if ((await toggle.getAttribute("aria-pressed")) !== String(on))
      await toggle.click();
  };

  /** Types the query and waits until the count holds still. */
  const search = async (query) => {
    await input.fill("");
    await input.fill(query);
    let text = "";

    await until(async () => {
      text = await countText();

      if (!/^(No results|\d+ of \d+)$/.test(text)) return false;
      await page.waitForTimeout(700);

      return (await countText()) === text;
    }, `a settled count for ${query}`);

    return text;
  };

  const openFind = async () => {
    await page.keyboard.press("ControlOrMeta+KeyF");
    await find.waitFor();
  };

  // A peek shows lines 5-15 of peek.ts, both sides of line 10; line 150 is outside it.
  await until(
    async () =>
      (await page.locator("[data-review-inline-editor]").count()) === 1,
    "the code peek to register",
  );
  await openFind();
  await option("Skip Folded", false);
  assert.equal(await search("peekword"), "1 of 2");
  ctx.check("a peek counts only the lines it shows, with Skip Folded off");
  await page.keyboard.press("Escape");

  await page
    .locator('[aria-label="Session views"] button[aria-label="Diff"]')
    .click();
  await until(
    async () => (await page.locator(".multiDiffEntry .view-line").count()) > 0,
    "the diff's code",
    120_000,
  );

  await openFind();
  await option("Skip Folded", false);
  await option("Use Regular Expression", true);
  assert.equal(await search(String.raw`alpha = 1;\nexport const new`), "1 of 1");
  assert.equal(await search(String.raw`alpha = 1;\nexport const old`), "1 of 1");
  ctx.check("a multiline regex matches a file's own lines on either side");
  await option("Use Regular Expression", false);

  // Off-screen editors keep their lines in the DOM, so test the viewport.
  const hiddenLineOnScreen = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".multiDiffEntry .view-line")].some(
        (line) => {
          const box = line.getBoundingClientRect();

          return (
            line.textContent.includes("hiddenword") &&
            box.width > 0 &&
            box.bottom > 0 &&
            box.top < innerHeight
          );
        },
      ),
    );

  // Line 150 of folded.ts sits in a folded unchanged region.
  await option("Skip Folded", true);
  assert.equal(await search("hiddenword"), "No results");
  // Without Skip Folded the match counts, and revealing it unfolds the line.
  await option("Skip Folded", false);
  assert.equal(await search("hiddenword"), "1 of 1");
  await until(
    hiddenLineOnScreen,
    "find to unfold the folded match",
  );
  await option("Skip Folded", true);
  assert.equal(await search("hiddenword"), "1 of 1");

  // Moving to the last file unmounts folded.ts's editor; its unfold must hold.
  assert.equal(await search("zzend"), "1 of 2");
  await page.keyboard.press("Enter");
  await until(
    async () => !(await hiddenLineOnScreen()),
    "folded.ts to scroll out of the diff",
  );
  assert.equal(await search("hiddenword"), "1 of 1");
  ctx.check("Skip Folded keeps a line the reader unfolded after it scrolls away");
  await page.keyboard.press("Escape");

  const toggle = (id) =>
    page.locator(`section[data-lens-id="${id}"] button[aria-pressed]`);

  const activate = async (id) => {
    await toggle(id).click();
    await until(
      async () => (await toggle(id).getAttribute("aria-pressed")) === "true",
      `lens ${id} to activate`,
    );
  };

  await activate(lensA);
  await openFind();
  assert.equal(await search("needle"), "1 of 4");
  await activate(lensB);
  let switched = "";

  await until(async () => {
    switched = await countText();

    return switched === "1 of 6";
  }, "the count to follow lens B");
  await page.keyboard.press("Enter");
  await until(
    async () => (await countText()) === "2 of 6",
    "Enter to step through lens B's matches",
  );
  await until(
    async () =>
      (await page
        .locator(".multiDiffEntry .currentFindMatch")
        .filter({ visible: true })
        .count()) > 0,
    "the active match in lens B",
  );
  ctx.check("switching lenses re-runs find against the new lens");
}

