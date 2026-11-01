/** A board shared, edited and shared again keeps one link, with a revision per version, until it is revoked. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { startShareService } from "../fixtures/share-service.mjs";
import { createReview, sleep } from "../harness.mjs";

export const name = "share-link";

export const phase = 1;

export const options = {
  settings: { "window.dialogStyle": "custom" },
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
      .getByText("This link always opens the latest share of this board.")
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
    assert.equal(await input.inputValue(), u1);
    ctx.check("reopening an unchanged board uploads nothing");

    const rows = page.locator("[data-share-revision]");

    await ctx.until(async () => (await rows.count()) === 2, "two history rows");

    const [latest, older] = await rows.allTextContents();

    assert.match(
      latest,
      new RegExp(` · v${revisions.items[0].version} · .* · Latest$`),
    );
    assert.match(older, new RegExp(` · v${revisions.items[1].version} · `));
    assert.doesNotMatch(older, /Latest/);
    ctx.check("the popover lists both revisions, the newest marked Latest");

    const revokeButton = page.getByRole("button", { name: "Revoke link" });

    const dialog = ctx.page
      .getByRole("dialog")
      .filter({ hasText: "Revoke this share link?" });

    const notice = page.getByText(
      "Link revoked. Sharing this board again creates a new link.",
    );

    await revokeButton.click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await input.waitFor();
    assert.equal(service.links.get(reviewId)?.shareId, shareId);
    ctx.check("cancelling the revoke keeps the link and the popover");

    await revokeButton.click();
    await dialog.getByRole("button", { name: "Revoke", exact: true }).click();
    await notice.waitFor();
    assert.equal(service.links.has(reviewId), false);
    ctx.check("revoking deletes the link at the service");

    await page.keyboard.press("Escape");
    await notice.waitFor({ state: "detached" });
    await button.click();
    await ctx.until(
      async () =>
        service.posts.length === 3 &&
        Boolean(await input.inputValue().catch(() => "")),
      "the new link",
    );
    assert.notEqual(await input.inputValue(), u1);
    assert.notEqual(service.links.get(reviewId).shareId, shareId);
    ctx.check("sharing a revoked board again uploads a new link");
  } finally {
    await service.stop();
  }
}
