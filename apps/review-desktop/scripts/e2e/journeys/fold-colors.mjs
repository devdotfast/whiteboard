import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createReview } from "../harness.mjs";

export const name = "fold-colors";

export const phase = 1;

export const options = {
  env: { DEV_FAST_REVIEW_DESKTOP_BACKGROUND: "1" },
  settings: {
    "window.autoDetectColorScheme": false,
    "workbench.colorTheme": "Review Dark",
  },
};

async function coloredText(line, selector) {
  return line.evaluate((element, selector) => {
    const chars = [];

    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        for (const char of node.textContent)
          chars.push([
            char.replace(/\u00a0/g, " "),
            getComputedStyle(node.parentElement).color,
          ]);
      } else {
        for (const child of node.childNodes) visit(child);
      }
    };

    if (selector) {
      for (const suffix of element.querySelectorAll(selector)) visit(suffix);
    } else visit(element);

    return chars;
  }, selector);
}

export async function run(ctx) {
  const source =
    'import {\n  alpha,\n  beta,\n  gamma,\n} from "./module.js";\n\nexport const value = ';

  const file = path.join(ctx.repo, "imports.ts");
  await writeFile(file, source + "1;\n");
  await ctx.git("add", ".");
  await ctx.git("commit", "-qm", "Import fixture");
  const base = await ctx.git("rev-parse", "HEAD");
  await writeFile(file, source + "2;\n");
  await ctx.git("commit", "-qam", "Change value");
  const head = await ctx.git("rev-parse", "HEAD");
  const title = "Inline fold highlighting";
  await createReview(ctx, { title, base, head, blocks: [] });
  const page = await ctx.apiCanvasFor(title);
  await ctx.watchPage(page);
  await page
    .locator('[aria-label="Session views"] button[aria-label="Diff"]')
    .click();

  const header = page
    .locator(".view-line")
    .filter({ hasText: "import" })
    .first();

  const pill = page.locator(".review-fold-pill").first();

  for (const theme of ["dark", "light"]) {
    if (theme === "light") {
      const settingsPath = path.join(ctx.userData, "User/settings.json");
      const settings = JSON.parse(await readFile(settingsPath, "utf8"));
      await writeFile(
        settingsPath,
        JSON.stringify({ ...settings, "workbench.colorTheme": "Review Light" }),
      );
      await page.locator(".monaco-workbench.vs").waitFor();
    }

    await pill.waitFor();
    await ctx.until(
      async () =>
        new Set(
          (await coloredText(header, ".review-fold-closer")).map(
            ([, color]) => color,
          ),
        ).size >= 3,
      "highlighted folded suffix",
    );
    const folded = await coloredText(header, ".review-fold-closer");
    assert.equal(
      folded.map(([char]) => char).join(""),
      '} from "./module.js";',
    );
    await page.screenshot({ path: path.join(ctx.root, `folded-${theme}.png`) });
    await pill.click();

    const closer = page
      .locator(".view-line")
      .filter({ hasText: '} from "./module.js";' })
      .first();

    await closer.waitFor();
    const expanded = await coloredText(closer);
    // Bracket-pair decorations apply separately to the expanded closing brace.
    assert.deepEqual(
      folded.slice(1),
      expanded.slice(expanded.findIndex(([char]) => char === "}") + 1),
    );
    await header.hover();
    await page
      .locator(".review-fold-chevron:not(.is-collapsed)")
      .first()
      .click();
    await pill.waitFor();
    ctx.check(
      `${theme}: folded suffix preserves expanded syntax colors and the fold expands and collapses`,
    );
  }

  await page.setViewportSize({ width: 800, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await pill.click();
  await page
    .locator(".view-line")
    .filter({ hasText: '} from "./module.js";' })
    .first()
    .waitFor();
  ctx.check("the fold expands at a narrow width with reduced motion");
}
