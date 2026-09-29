import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alreadyPublished,
  distTag,
  registryMetadata,
} from "./review-cli-release.mjs";

const metadata = {
  versions: { "0.2.9": {}, "0.2.10": {}, "1.0.0-preview.1": {} },
};

test("a stable Desktop version publishes as latest, a preview as preview", () => {
  assert.equal(distTag("0.1.6"), "latest");
  assert.equal(distTag("0.1.6-preview.20260929.12"), "preview");

  for (const version of [
    "0.1.6-preview.1",
    "0.1.6-beta.20260929.1",
    "v0.1.6",
    "0.1.6-preview.20260929.1; echo nope",
  ])
    assert.throws(() => distTag(version));
});

test("registry errors stop planning; only a package 404 means no versions", async () => {
  assert.deepEqual(
    await registryMetadata(async () => new Response(null, { status: 404 })),
    { versions: {} },
  );
  await assert.rejects(
    registryMetadata(async () => new Response(null, { status: 503 })),
    /refusing to guess/,
  );
  await assert.rejects(
    registryMetadata(async () => Response.json({})),
    /Invalid npm/,
  );
});

test("published versions are accepted only for the exact source commit", () => {
  const existing = { versions: { "0.2.11": { gitHead: "abc" } } };
  assert.equal(alreadyPublished(existing, "0.2.11", "abc"), true);
  assert.equal(alreadyPublished(existing, "0.2.12", "abc"), false);
  assert.throws(
    () => alreadyPublished(existing, "0.2.11", "def"),
    /already exists/,
  );
  assert.throws(
    () => alreadyPublished(metadata, "0.2.10", "abc"),
    /unknown commit/,
  );
});
