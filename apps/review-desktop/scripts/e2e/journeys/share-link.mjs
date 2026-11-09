/** A board shared, edited and shared again keeps one link, with a revision per version. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { startShareService } from "../fixtures/share-service.mjs";
import { createReview, sleep } from "../harness.mjs";

export const name = "share-link";

export const phase = 1;

export const options = {
  async beforeLaunch(ctx) {
    ctx.service = await startShareService();
    await writeFile(
      path.join(ctx.home, "auth.json"),
      JSON.stringify({
        origin: ctx.service.origin,
        token: "e2e",
        login: "e2e",
        savedAt: new Date().toISOString(),
      }),
    );
  },
};

export async function run(ctx) {
  const { service } = ctx;

  try {
    const { reviewId, canvas } = await createReview(ctx, {
      title: "Shared link",
      blocks: [{ type: "markdown", markdown: "First" }],
    });

    const page = canvas.page();
    const button = page.getByRole("button", { name: "Share review" });
    const input = page.getByLabel("Share link");

    await button.click();
    await input.waitFor();

    const u1 = await input.inputValue();

    assert.equal(service.posts.length, 1);
    await page
      .getByText("Hit share again to update the link in-place")
      .waitFor();
    ctx.check("the first share uploads once and shows its link");
    await page.keyboard.press("Escape");
    await input.waitFor({ state: "detached" });

    await ctx.apiOk("/reviews-api/commands", "POST", {
      operation: {
        type: "edit",
        reviewId,
        edit: {
          type: "insert",
          content: { type: "markdown", markdown: "Second" },
        },
      },
    });
    await canvas.getByText("Second", { exact: true }).waitFor();
    await button.click();
    await ctx.until(
      async () =>
        service.posts.length === 2 &&
        (await input.inputValue().catch(() => "")) === u1,
      "the reshared link",
    );
    await page.getByText("Content updated").waitFor();
    ctx.check("an edited board uploads again behind the same link");

    const { shareId } = service.links.get(reviewId);

    const revisions = await (
      await fetch(`${service.origin}/api/v2/shares/${shareId}/revisions`)
    ).json();

    assert.equal(revisions.items.length, 2);
    assert.ok(revisions.items[0].version > revisions.items[1].version);
    assert.equal(revisions.latest, revisions.items[0].id);
    ctx.check("the link holds two revisions, newest first");

    await page.keyboard.press("Escape");
    await input.waitFor({ state: "detached" });
    await button.click();
    await input.waitFor();
    await sleep(2000);
    assert.equal(service.posts.length, 2);
    assert.equal(await page.getByText("Content updated").count(), 0);
    assert.equal(await input.inputValue(), u1);
    ctx.check("reopening an unchanged board uploads nothing");
  } finally {
    await service.stop();
  }
}
