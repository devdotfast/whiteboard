/** A share link opens as a copy that renders from its own pinned checkout, refreshes in place while unedited, and copies beside an edited one. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { assertNoBlockedReviewRequests } from "../../review-network-policy.mjs";
import { startShareService } from "../fixtures/share-service.mjs";
import { openHome, sourcePackage } from "../harness.mjs";

export const name = "shared-review";

export const phase = 1;

const exec = promisify(execFile);

// The document's own heading; the review title shows only on the tab.
const HEADING = "A portable review";

export const options = {
  seedRepo: false,
  async beforeLaunch(ctx) {
    const root = path.join(ctx.root, "share");

    const read = async (file) =>
      JSON.parse(await readFile(path.join(root, file), "utf8"));

    await exec("pnpm", ["exec", "tsx", "scripts/seed-share-fixture.ts", root], {
      cwd: sourcePackage,
      env: ctx.env,
    });

    const key = path.join(ctx.root, "key.pem");
    const cert = path.join(ctx.root, "cert.pem");

    await exec("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
      "-days",
      "1",
      "-keyout",
      key,
      "-out",
      cert,
    ]);
    ctx.env.NODE_EXTRA_CA_CERTS = cert;

    ctx.share = await read("fixture.json");
    ctx.bundles = [await read("bundle-1.json"), await read("bundle-2.json")];

    // The bundle names its GitHub remote; the recipient fetches the sender's checkout instead.
    await writeFile(
      path.join(ctx.home, ".gitconfig"),
      `[url "${ctx.share.repo}"]\n\tinsteadOf = https://github.com/fixture/review.git\n`,
    );

    ctx.service = await startShareService({
      tls: {
        key: await readFile(key, "utf8"),
        cert: await readFile(cert, "utf8"),
      },
    });
    ctx.share.url = ctx.service.publish(ctx.share.reviewId, ctx.bundles[0]).url;
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
  const { share, service, bundles } = ctx;

  try {
    await journey(ctx, share, service, bundles);
  } finally {
    await service.stop();
  }
}

async function journey(ctx, share, service, bundles) {
  const revisions = () => service.links.get(share.reviewId).revisions;

  const receive = async () => {
    const started = await ctx.api("/reviews-api/sharing/import", "POST", {
      url: share.url,
    });

    assert.equal(started.status, 202, JSON.stringify(started.value));

    const { reviewId } = await ctx.until(async () => {
      const status = await ctx.apiOk(
        `/reviews-api/sharing/import/${started.value.reviewId}`,
      );

      assert.notEqual(status.stage, "error", status.error);

      return status.stage === "ready" && status;
    }, "the share import");

    return reviewId;
  };

  const board = (reviewId) => ctx.apiOk(`/reviews-api/${reviewId}?full=true`);

  const a = await receive();
  const first = await board(a);

  assert.equal(first.shared.revisionId, revisions()[0].id);

  await ctx.apiOk(`/reviews-api/${a}/open`, "POST", {});

  const page = await ctx.apiCanvasFor(HEADING);

  await ctx.watchPage(page);

  const canvas = page.locator(".review-canvas-root [data-review-api]");

  await canvas.getByText("The answer is 42.").first().waitFor();
  ctx.check("the shared document and trace quote render");

  await rename(
    share.repo,
    path.join(path.dirname(share.repo), "sender-unavailable"),
  );

  // Native inline widgets expose their rendered code through Monaco's view lines.
  const code = canvas
    .locator(".view-lines")
    .filter({ hasText: share.sourceText })
    .first();

  await code.scrollIntoViewIfNeeded();
  await code.waitFor();

  const source = await ctx.apiOk(
    `/reviews-api/${a}/file?side=head&file=${encodeURIComponent(share.sourceFile)}`,
  );

  assert.ok(
    source.text.includes(share.sourceText),
    `the retained checkout served ${JSON.stringify(source.text)}`,
  );
  ctx.check(
    "pinned source renders from the recipient checkout with the sender's repository gone",
  );

  service.publish(share.reviewId, bundles[1]);
  assert.equal(await receive(), a);

  const refreshed = await board(a);

  assert.equal(refreshed.version, first.version + 1);
  assert.equal(refreshed.shared.revisionId, revisions()[0].id);
  await canvas.getByText(share.note).first().waitFor();
  ctx.check("an unedited copy refreshes in place and its open tab updates");

  await openHome(ctx);

  const rows = ctx.page
    .locator("main.review-home [data-home-row]")
    .filter({ hasText: first.title });

  const copies = (count) =>
    ctx.until(
      async () => (await rows.count()) === count,
      `${count} copies on Home`,
    );

  await copies(1);
  ctx.check("Home lists one copy after the refresh");

  await ctx.apiOk("/reviews-api/commands", "POST", {
    operation: {
      type: "edit",
      reviewId: a,
      edit: {
        type: "insert",
        content: { type: "markdown", markdown: "A reader's own note." },
      },
    },
  });

  const edited = await board(a);

  // Revision 3 is revision 2 again at the sender's next version.
  const version = bundles[1].version + 1;

  service.publish(share.reviewId, {
    ...bundles[1],
    version,
    snapshot: { ...bundles[1].snapshot, version },
  });

  const b = await receive();

  assert.notEqual(b, a);
  assert.equal((await board(b)).shared.revisionId, revisions()[0].id);
  assert.equal((await board(a)).version, edited.version);
  await copies(2);
  ctx.check("a newer revision copies beside an edited copy, leaving it as is");

  await service.stop();
  assert.equal(await receive(), b);
  ctx.check("offline, the link opens its newest copy");

  // A received share renders from what is on disk: nothing leaves the machine.
  assertNoBlockedReviewRequests(ctx.requestUrls);
  assert.deepEqual(
    ctx.requestUrls.filter((url) => {
      const { protocol, hostname } = new URL(url);

      return (
        /^(https?|wss?):$/.test(protocol) &&
        !["127.0.0.1", "localhost", "[::1]"].includes(hostname)
      );
    }),
    [],
    "the shared review made an outbound request",
  );
  ctx.check("the shared review made no outbound request");
}
