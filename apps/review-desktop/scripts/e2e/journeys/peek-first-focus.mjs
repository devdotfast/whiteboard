import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { createReview } from "../harness.mjs";

export const name = "peek-first-focus";

export const phase = 1;

export async function run(ctx) {
  const source =
    Array.from(
      { length: 300 },
      (_, line) => `export const value${line} = ${line};`,
    ).join("\n") + "\n";

  await writeFile(path.join(ctx.repo, "installer.ts"), source);
  await ctx.git("add", "installer.ts");
  await ctx.git("commit", "-qm", "Add installer");
  const head = await ctx.git("rev-parse", "HEAD");
  const title = "Side peek first focus";

  await createReview(ctx, {
    title,
    base: ctx.head,
    head,
    blocks: [
      {
        type: "markdown",
        markdown:
          "Read the [installer](review-source:head/installer.ts#L1-L300).",
      },
    ],
  });

  const page = await ctx.apiCanvasFor(title);
  await page.getByText("installer", { exact: true }).click();
  await page.locator(".side-panel .view-line").first().waitFor();
  const scroller = page.locator(".side-panel > header + div");
  await ctx.until(
    () => scroller.evaluate((node) => node.scrollHeight > 4000),
    "long side peek rendered",
  );

  await scroller.evaluate((node) => {
    node.scrollTop = 2000;
  });

  const point = await scroller.evaluate((node) => {
    const panel = node.getBoundingClientRect();

    for (const line of node.querySelectorAll(".view-line")) {
      const rect = line.getBoundingClientRect();

      if (rect.top > panel.top + 200 && rect.bottom < panel.bottom - 100)
        return { x: rect.left + 80, y: rect.top + rect.height / 2 };
    }

    throw new Error("No visible code line in the scrolled peek");
  });

  const before = await scroller.evaluate((node) => node.scrollTop);
  await page.mouse.click(point.x, point.y);
  await ctx.until(
    () => page.locator(".side-panel .native-edit-context:focus").count(),
    "peek editor focused",
  );
  assert.equal(await scroller.evaluate((node) => node.scrollTop), before);
  ctx.check("first code click preserves the side peek scroll position");

  await page.screenshot({ path: path.join(ctx.root, "peek-first-focus.png") });
}
