import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { withFileLock } from "@dev.fast/trace-core";
import { afterEach, beforeEach, expect, it } from "vitest";

import { openReviewProfile } from "./profile.js";
import { ReviewStore } from "./store.js";

let home: string;

const stores: ReviewStore[] = [];

const providers = {
  validatePins: async () => {},
  validateSource: async () => {},
  validateResource: async () => {},
};

const command = <Operation>(operation: Operation) => ({
  operation,
});

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "review-profile-"));
});

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  await rm(home, { recursive: true, force: true });
});

async function fixture() {
  const initial = await openReviewProfile(home, { manageWorkspaces: false });
  await initial.data.close();
  await initial.store.close();
  const target = new ReviewStore(path.join(home, "review-api.db"), providers);
  await mkdir(path.join(home, "review-server"));

  const source = new ReviewStore(
    path.join(home, "review-server", "reviews.db"),
    providers,
  );

  stores.push(target, source);
  const existingRepo = target.registerRepository(path.join(home, "repo"));
  const oldRepo = source.registerRepository(path.join(home, "repo"));
  const pins = { repositoryId: oldRepo.id, base: "base", head: "head" };

  const created = await source.execute(
    command({
      type: "create",
      title: "Headless draft",
      target: { kind: "commits", ...pins },
    }),
  );

  const resourceId = randomUUID();
  source.putResource(
    resourceId,
    oldRepo.id,
    "image",
    "image/png",
    Buffer.from("retained resource"),
  );

  const edit = command({
    type: "edit",
    reviewId: created.reviewId,
    edit: {
      type: "insert",
      content: { type: "image", assetId: resourceId, alt: "Retained image" },
    },
  });

  await source.execute(edit);

  return { source, target, created, existingRepo, resourceId };
}

it("starts without reading or rewriting old review files or obsolete cutover reports", async () => {
  const legacyDir = path.join(home, "reviews", randomUUID());
  await mkdir(legacyDir, { recursive: true });

  const files = {
    "review.json": "{broken review record",
    "review.mdx": "# Old Whiteboard review\n",
    "data.ts": "export const oldReview = true;\n",
  };

  for (const [name, content] of Object.entries(files))
    await writeFile(path.join(legacyDir, name), content);
  await writeFile(path.join(home, "json-cutover.json"), "{obsolete report");

  const profile = await openReviewProfile(home, { manageWorkspaces: false });

  try {
    expect(profile.store.list()).toEqual([]);

    for (const [name, content] of Object.entries(files))
      expect(await readFile(path.join(legacyDir, name), "utf8")).toBe(content);
    expect(await readFile(path.join(home, "json-cutover.json"), "utf8")).toBe(
      "{obsolete report",
    );
    expect(await readdir(home)).not.toContain("backups");
  } finally {
    await profile.data.close();
    await profile.store.close();
  }
});

it("reopens already migrated reviews with their history, resources, provenance and unused import cursors intact", async () => {
  const databasePath = path.join(home, "review-api.db");
  const source = new ReviewStore(databasePath, providers);
  const repository = source.registerRepository(home);
  const pins = { repositoryId: repository.id, base: "base", head: "head" };
  const resourceId = randomUUID();
  source.putResource(
    resourceId,
    repository.id,
    "image",
    "image/png",
    Buffer.from("retained image"),
  );

  const { reviewId } = await source.execute(
    command({
      type: "create",
      title: "Imported",
      target: { kind: "commits", ...pins },
    }),
    {
      document: [{ type: "image", assetId: resourceId, alt: "Retained image" }],
      origin: { branch: "feature", baseRef: "main", revision: "old-revision" },
    },
  );

  const original = source.read(reviewId);
  await source.execute(command({ type: "rename", reviewId, title: "Edited" }));
  const current = source.read(reviewId);
  const history = source.history(reviewId);
  await source.close();

  const database = new DatabaseSync(databasePath);
  database.exec(
    "CREATE TABLE legacy_imports(review_id TEXT PRIMARY KEY, revision TEXT NOT NULL, imported_at TEXT NOT NULL)",
  );
  database
    .prepare("INSERT INTO legacy_imports VALUES(?,?,?)")
    .run(reviewId, "old-revision", "2026-09-01T00:00:00Z");
  database.close();

  const profile = await openReviewProfile(home, { manageWorkspaces: false });

  try {
    expect(profile.store.read(reviewId)).toEqual(current);
    expect(profile.store.read(reviewId, 0)).toEqual(original);
    expect(profile.store.history(reviewId)).toEqual(history);
    expect(
      Buffer.from(profile.store.resource(resourceId).data).toString(),
    ).toBe("retained image");
    const retained = new DatabaseSync(databasePath, { readOnly: true });

    try {
      expect(
        retained
          .prepare(
            "SELECT revision,imported_at FROM legacy_imports WHERE review_id=?",
          )
          .get(reviewId),
      ).toMatchObject({
        revision: "old-revision",
        imported_at: "2026-09-01T00:00:00Z",
      });
    } finally {
      retained.close();
    }
  } finally {
    await profile.data.close();
    await profile.store.close();
  }
});

it("merges preview headless history and resources without changing review IDs or resurrecting deleted reviews", async () => {
  const { source, target, created, existingRepo, resourceId } = await fixture();

  const before = source.read(created.reviewId);
  const profile = await openReviewProfile(home, { manageWorkspaces: false });

  try {
    expect(profile.store.read(created.reviewId)).toEqual({
      ...before,
      pins: { ...before.pins, repositoryId: existingRepo.id },
      target: { ...before.target, repositoryId: existingRepo.id },
    });
    expect(profile.store.history(created.reviewId)).toHaveLength(2);
    expect(profile.store.resource(resourceId)).toMatchObject({
      repositoryId: existingRepo.id,
    });
    expect(Buffer.from(profile.store.resource(resourceId).data)).toEqual(
      Buffer.from("retained resource"),
    );
    expect(source.read(created.reviewId)).toEqual(before);
    await profile.store.execute(
      command({ type: "delete", reviewId: created.reviewId }),
    );
  } finally {
    await profile.data.close();
    await profile.store.close();
  }

  const reopened = await openReviewProfile(home, { manageWorkspaces: false });
  expect(reopened.store.list()).toEqual([]);
  expect(target.list()).toEqual([]);
  await reopened.data.close();
  await reopened.store.close();
});

it("refuses migration while the preview server owns its source, then succeeds after shutdown", async () => {
  const { target, created } = await fixture();

  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();

  const owner = withFileLock(
    path.join(home, "review-server", "server.lock"),
    { timeoutMs: 0, retryMs: 10, staleMs: Infinity, unownedGraceMs: 1000 },
    async () => {
      entered.resolve();
      await release.promise;
    },
  );

  await entered.promise;

  try {
    await expect(
      openReviewProfile(home, { manageWorkspaces: false }),
    ).rejects.toThrow(/Stop the old headless server/);
    expect(target.list()).toEqual([]);
  } finally {
    release.resolve();
    await owner;
  }

  const profile = await openReviewProfile(home, { manageWorkspaces: false });
  expect(profile.store.read(created.reviewId).title).toBe("Headless draft");
  await profile.data.close();
  await profile.store.close();
});

it("rolls back the merge if a retained resource collides with different content", async () => {
  const { target, existingRepo, resourceId } = await fixture();
  target.putResource(
    resourceId,
    existingRepo.id,
    "image",
    "image/png",
    Buffer.from("different bytes"),
  );
  await expect(
    openReviewProfile(home, { manageWorkspaces: false }),
  ).rejects.toThrow(/different content/);
  expect(target.list()).toEqual([]);
  expect(Buffer.from(target.resource(resourceId).data).toString()).toBe(
    "different bytes",
  );
});
