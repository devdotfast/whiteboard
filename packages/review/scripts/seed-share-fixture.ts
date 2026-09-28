/** Seeds a received share into `<home>` for the shared-review e2e journey; the sender's repository is renamed away afterwards. */
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { openLocalReviewStore } from "../src/review-api/local-data.js";
import { exportShare } from "../src/sharing/export.js";
import { SharedReviewStore } from "../src/sharing/import.js";
import { fetchPinnedRepository } from "../src/sharing/repository.js";
import { createShareFixture } from "../test/fixtures/share/create.js";

const [root, home] = process.argv.slice(2).map((arg) => path.resolve(arg));

if (!root || !home)
  throw new Error("Usage: tsx scripts/seed-share-fixture.ts <root> <home>");

await mkdir(home, { recursive: true });

const fixture = await createShareFixture(root);

const bundle = await exportShare({
  ...fixture,
});

bundle.attribution = { login: "fixture-sender", sharedAt: Date.now() };

const recipient = openLocalReviewStore(path.join(home, "review-api.db"));

const store = new SharedReviewStore(
  path.join(home, "shared-reviews"),
  async (target, _url, pins) => {
    await fetchPinnedRepository(target, fixture.repo, pins);
  },
);

store.connect(recipient.store, recipient.data);

await store.load();

const reviewId = await store.import(
  "https://app.dev.fast",
  randomUUID(),
  bundle,
);

await recipient.data.close();

recipient.store.close();

await fixture.data.close();

fixture.store.close();

await rename(fixture.repo, path.join(root, "sender-unavailable"));

await writeFile(
  path.join(root, "fixture.json"),
  JSON.stringify({
    reviewId,
    version: bundle.manifest.version,
    sourceFile: fixture.sourceFile,
    sourceText: fixture.sourceText,
  }),
);
