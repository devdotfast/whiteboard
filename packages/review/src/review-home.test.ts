import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { REVIEW_SCHEMA_VERSION } from "@dev.fast/review-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readReviewDocumentBundle,
  reviewDocumentBundleData,
} from "./review-bundle";
import {
  ReviewHomeScanError,
  type StoredReview,
  materializeReviewRevision,
  parseAnyStoredReviewRecord,
  readStoredReview,
  reviewsHomeDir,
  sealReviewCandidate,
} from "./review-home";
import {
  cleanupTempDirs,
  createLegacyReviewDir,
  gitRepository,
  reviewHome,
  writeLegacyDocument,
} from "./review-test-utils";
import { reviewVcs } from "./review-vcs";

const execFilePromise = promisify(execFile);

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupTempDirs();
});

describe("review home", () => {
  it("accepts every stored schema version and rejects unknown or extended records", async () => {
    const base = {
      uuid: "11111111-1111-4111-8111-111111111111",
      repoKey: "repo",
      worktreePath: "/repo",
      baseRef: "main",
      baseCommit: "b".repeat(40),
      sourceCommit: "a".repeat(40),
      sourceIdentity: null,
      title: "Review",
      status: "awaiting-review",
      createdAt: "2024-01-01T00:00:00.000Z",
      lastPublishedAt: null,
    };

    expect(
      parseAnyStoredReviewRecord({
        ...base,
        schemaVersion: 2,
        agentSession: "disabled:review",
        presentedRevision: "c".repeat(40),
      }),
    ).toMatchObject({
      schemaVersion: REVIEW_SCHEMA_VERSION,
      sourceSession: "disabled:review",
      presentedDocumentRevision: "c".repeat(40),
      presentedSoftwareMapRevision: "c".repeat(40),
    });
    expect(
      parseAnyStoredReviewRecord({
        ...base,
        schemaVersion: 3,
        agentSession: "disabled:review",
        presentedDocumentRevision: null,
        presentedSoftwareMapRevision: null,
      }),
    ).toMatchObject({
      schemaVersion: REVIEW_SCHEMA_VERSION,
      sourceSession: "disabled:review",
    });
    expect(
      parseAnyStoredReviewRecord({
        ...base,
        schemaVersion: 4,
        sourceSession: "disabled:review",
        presentedDocumentRevision: null,
        presentedSoftwareMapRevision: null,
      }),
    ).toMatchObject({ schemaVersion: REVIEW_SCHEMA_VERSION });
    expect(
      parseAnyStoredReviewRecord({
        ...base,
        schemaVersion: REVIEW_SCHEMA_VERSION,
        sourceSession: "disabled:review",
        presentedDocumentRevision: null,
        presentedSoftwareMapRevision: null,
      }),
    ).toMatchObject({ schemaVersion: REVIEW_SCHEMA_VERSION });
    expect(() =>
      parseAnyStoredReviewRecord({
        ...base,
        schemaVersion: 2,
        agentSession: "disabled:review",
        presentedRevision: null,
        presentedDocumentRevision: null,
        presentedSoftwareMapRevision: null,
      }),
    ).toThrow(/presentedDocumentRevision/);
    expect(() =>
      parseAnyStoredReviewRecord({
        ...base,
        schemaVersion: 3,
        agentSession: 42,
        presentedDocumentRevision: null,
        presentedSoftwareMapRevision: null,
      }),
    ).toThrow(/agentSession/);
    expect(() =>
      parseAnyStoredReviewRecord({
        ...base,
        schemaVersion: 1,
        sourceSession: "disabled:review",
        presentedDocumentRevision: null,
        presentedSoftwareMapRevision: null,
      }),
    ).toThrow(/schemaVersion/);
    expect(() =>
      parseAnyStoredReviewRecord({
        ...base,
        schemaVersion: 4,
        sourceSession: "disabled:review",
        presentedDocumentRevision: null,
        presentedSoftwareMapRevision: null,
        unexpected: true,
      }),
    ).toThrow(/unexpected/);
  });

  it("ignores a legacy softwareMap key in review.json", async () => {
    const root = await gitRepository();
    await reviewHome();

    const created = await createLegacyReviewDir({
      worktreePath: root,
      baseRef: "main",
      baseCommit: await git(root, ["rev-parse", "HEAD"]),
    });

    const record = JSON.parse(
      await readFile(path.join(created.dir, "review.json"), "utf8"),
    );

    await writeFile(
      path.join(created.dir, "review.json"),
      JSON.stringify({
        ...record,
        softwareMap: {
          languages: "typescript,go",
          graphDbPath: ".cache/review.sqlite",
        },
      }),
      "utf8",
    );
    const loaded = await load(created.dir);

    expect(loaded?.review).not.toHaveProperty("softwareMap");
  });
});

async function load(dir: string): Promise<StoredReview> {
  const loaded = await readStoredReview(dir);

  if ("error" in loaded) throw new ReviewHomeScanError([loaded.error]);

  return loaded;
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFilePromise("git", ["-C", root, ...args], {
    encoding: "utf8",
  });

  return stdout.trim();
}

describe("legacy records on read", () => {
  it.each([2, 3, 4, 6] as const)(
    "does not mutate malformed or unsupported schema %s records",
    async (schemaVersion) => {
      const root = await gitRepository();
      await reviewHome();

      const created = await createLegacyReviewDir({
        worktreePath: root,
        baseRef: "main",
        baseCommit: await git(root, ["rev-parse", "HEAD"]),
      });

      const recordPath = path.join(created.dir, "review.json");
      await sealReviewCandidate(created.dir, "Initial document");

      const record = await legacyRecord(
        created,
        schemaVersion === 6 ? 4 : schemaVersion,
        "a".repeat(40),
      );

      const bytes = JSON.stringify(
        schemaVersion === 6
          ? { ...created.review, schemaVersion }
          : {
              ...record,
              schemaVersion,
              baseCommit: 42,
              agentSession: "codex",
            },
      );

      await writeFile(recordPath, bytes);
      const refs = await git(created.dir, ["rev-parse", "HEAD"]);
      await expect(load(created.dir)).rejects.toMatchObject({
        errors: [{ code: "MIGRATION_REQUIRED" }],
      });
      expect(await readFile(recordPath, "utf8")).toBe(bytes);
      expect(await git(created.dir, ["rev-parse", "HEAD"])).toBe(refs);
    },
  );

  it.each([2, 3, 4] as const)(
    "migrates a schema %s record on first read",
    async (schemaVersion) => {
      const root = await gitRepository();
      const home = await reviewHome();

      const created = await createLegacyReviewDir({
        worktreePath: root,
        baseRef: "main",
        baseCommit: await git(root, ["rev-parse", "HEAD"]),
      });

      await writeLegacyDocument(created.dir);

      const revision = await sealReviewCandidate(
        created.dir,
        "Legacy document",
      );

      const recordPath = path.join(created.dir, "review.json");
      await writeFile(
        recordPath,
        JSON.stringify(await legacyRecord(created, schemaVersion, revision)),
      );

      const stored = await load(created.dir);
      expect(stored?.review).toMatchObject({
        schemaVersion: 5,
        status: "accepted",
        dismissedAt: "2026-01-01T00:00:00Z",
        sourceSession: created.review.sourceSession,
      });
      expect(stored?.review.presentedDocumentRevision).not.toBe(revision);
      expect(stored?.review.presentedSoftwareMapRevision).toBeNull();
      const materialized = path.join(home, "materialized");
      await materializeReviewRevision(
        created.dir,
        stored!.review.presentedDocumentRevision!,
        materialized,
      );
      const bundle = await readReviewDocumentBundle(materialized, "/");
      expect(bundle && reviewDocumentBundleData(bundle).title).toBe("Sealed");

      const bytes = await readFile(recordPath, "utf8");
      await load(created.dir);
      expect(await readFile(recordPath, "utf8")).toBe(bytes);
    },
  );

  it("migrates once when two readers race", async () => {
    const root = await gitRepository();
    await reviewHome();

    const created = await createLegacyReviewDir({
      worktreePath: root,
      baseRef: "main",
      baseCommit: await git(root, ["rev-parse", "HEAD"]),
    });

    await writeLegacyDocument(created.dir);
    const revision = await sealReviewCandidate(created.dir, "Legacy document");
    await writeFile(
      path.join(created.dir, "review.json"),
      JSON.stringify(await legacyRecord(created, 4, revision)),
    );
    const seal = vi.spyOn(reviewVcs, "seal");

    const [first, second] = await Promise.all([
      load(created.dir),
      load(created.dir),
    ]);

    expect(first?.review.schemaVersion).toBe(5);
    expect(second?.review).toEqual(first?.review);
    expect(seal).toHaveBeenCalledTimes(1);
  });

  it("reports repair without touching a review whose sealed document is broken", async () => {
    const root = await gitRepository();
    await reviewHome();

    const created = await createLegacyReviewDir({
      worktreePath: root,
      baseRef: "main",
      baseCommit: await git(root, ["rev-parse", "HEAD"]),
    });

    await writeLegacyDocument(created.dir, {
      code: 'import { jsx } from "review-doc-runtime"; throw new Error("broken sealed document");',
    });
    const revision = await sealReviewCandidate(created.dir, "Broken document");
    const recordPath = path.join(created.dir, "review.json");
    const bytes = JSON.stringify(await legacyRecord(created, 4, revision));
    await writeFile(recordPath, bytes);
    const refs = await readFile(path.join(created.dir, ".git/refs/heads/main"));

    await expect(load(created.dir)).rejects.toMatchObject({
      errors: [{ code: "REPAIR_REQUIRED", reviewUuid: created.review.uuid }],
    });
    expect(await readFile(recordPath, "utf8")).toBe(bytes);
    expect(
      await readFile(path.join(created.dir, ".git/refs/heads/main")),
    ).toEqual(refs);
  });
});

async function legacyRecord(
  created: StoredReview,
  schemaVersion: 2 | 3 | 4,
  revision: string,
) {
  const {
    sourceSession,
    presentedDocumentRevision: _document,
    presentedSoftwareMapRevision: _map,
    ...common
  } = created.review;

  return {
    ...common,
    schemaVersion,
    status: "accepted",
    dismissedAt: "2026-01-01T00:00:00Z",
    ...(schemaVersion === 4
      ? { sourceSession }
      : { agentSession: sourceSession }),
    ...(schemaVersion === 2
      ? { presentedRevision: revision }
      : {
          presentedDocumentRevision: revision,
          presentedSoftwareMapRevision: null,
        }),
  };
}
