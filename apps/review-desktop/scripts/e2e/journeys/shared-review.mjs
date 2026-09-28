/** A received share renders from its own pinned checkout after the sender's repository is gone. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { sourcePackage } from "../harness.mjs";

export const name = "shared-review";

export const phase = 1;

const exec = promisify(execFile);

// The document's own heading; the review title shows only on the tab.
const HEADING = "A portable review";

export const options = {
  seedRepo: false,
  async beforeLaunch(ctx) {
    const root = path.join(ctx.root, "share");

    await exec(
      "pnpm",
      ["exec", "tsx", "scripts/seed-share-fixture.ts", root, ctx.home],
      { cwd: sourcePackage, env: ctx.env },
    );
    ctx.share = JSON.parse(
      await readFile(path.join(root, "fixture.json"), "utf8"),
    );
  },
};

export async function run(ctx) {
  const { share } = ctx;

  await ctx.apiOk(`/reviews-api/${share.reviewId}/open`, "POST", {});

  const page = await ctx.apiCanvasFor(HEADING);

  await ctx.watchPage(page);

  const canvas = page.locator(".review-canvas-root [data-review-api]");

  await canvas.getByText("The answer is 42.").first().waitFor();

  const image = canvas.getByAltText("Embedded red pixel");

  await image.scrollIntoViewIfNeeded();
  await ctx.until(
    () =>
      image.evaluate(
        (element) => element.complete && element.naturalWidth > 0,
      ),
    "the shared image to load",
  );
  ctx.check("the shared document, trace quote and embedded image render");

  // Native inline widgets expose their rendered code through Monaco's view lines.
  const code = canvas
    .locator(".view-lines")
    .filter({ hasText: share.sourceText })
    .first();

  await code.scrollIntoViewIfNeeded();
  await code.waitFor();

  const source = await ctx.apiOk(
    `/reviews-api/${share.reviewId}/file?side=head&file=${encodeURIComponent(share.sourceFile)}`,
  );

  assert.ok(
    source.text.includes(share.sourceText),
    `the retained checkout served ${JSON.stringify(source.text)}`,
  );

  const summary = await ctx.apiOk(`/reviews-api/${share.reviewId}?full=true`);

  assert.equal(summary.version, share.version);
  ctx.check(
    "pinned source renders from the recipient checkout with the sender's repository gone",
  );
}
