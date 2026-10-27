/** Seeds a share's copy into `<home>` for the shared-review e2e journey; the sender's repository is renamed away afterwards. */
import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { openLocalReviewStore } from "@review/review-api/local-data.js";
import { exportShare } from "@review/sharing/export.js";
import { importShare, shareKey } from "@review/sharing/import.js";
import { fetchPinnedRepository } from "@review/sharing/repository.js";

import { createShareFixture } from "../test/fixtures/share/create.js";

const [root, home] = process.argv.slice(2).map((arg) => path.resolve(arg));

if (!root || !home)
  throw new Error("Usage: tsx scripts/seed-share-fixture.ts <root> <home>");

await mkdir(home, { recursive: true });

const fixture = await createShareFixture(root);

const bundle = await exportShare(fixture);

const recipient = openLocalReviewStore(path.join(home, "review-api.db"));

const reviewId = await importShare(
  {
    ...recipient,
    fetchRepository: (target, _url, ...rest) =>
      fetchPinnedRepository(target, fixture.repo, ...rest),
  },
  shareKey("https://app.dev.fast", randomBytes(32).toString("base64url")),
  bundle,
  { login: "fixture-sender", sharedAt: Date.now() },
);

const { version } = recipient.store.read(reviewId);

await recipient.data.close();

recipient.store.close();

await fixture.data.close();

fixture.store.close();

await rename(fixture.repo, path.join(root, "sender-unavailable"));

await writeFile(
  path.join(root, "fixture.json"),
  JSON.stringify({
    reviewId,
    version,
    sourceFile: fixture.sourceFile,
    sourceText: fixture.sourceText,
  }),
);
