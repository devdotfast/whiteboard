import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  type JsonObject,
  REVIEW_SCHEMA_VERSION,
  type ReviewDesktopDiscovery,
  type ReviewSourceIdentity,
} from "@dev.fast/review-protocol";
import { writePrivateJsonAtomic } from "@dev.fast/trace-core";
import { vi } from "vitest";

import {
  type ReviewInstanceSelection,
  isHealthyReviewDesktop,
} from "./desktop-discovery";
import {
  DISABLED_REVIEW_SOURCE_SESSION,
  type StoredReview,
  type StoredReviewRecord,
  reviewsHomeDir,
} from "./review-home";
import { reviewVcs } from "./review-vcs";

/**
 * One place for the filesystem scaffolding every Review test needs. Vitest runs
 * this package with `isolate: false` and `maxWorkers: 1`, so a stubbed env
 * variable outlives the file that set it: cleanupTempDirs unstubs as well as
 * deletes, and every suite that creates a directory here must call it.
 */
const trackedTempDirs: string[] = [];

const DEFAULT_STORED_REVIEW_UUID = "11111111-1111-4111-8111-111111111111";

const DEFAULT_LEGACY_DOCUMENT_CODE = `import { createActiveReviewDocument, jsx } from "review-doc-runtime";
export default createActiveReviewDocument({ title: "Sealed", routePath: "/", filePath: "review.mdx", modelNames: [], models: {}, Component: () => jsx("h1", { children: "Exact sealed title" }), isDefault: true });`;

export async function tempDir(prefix = "review-test-"): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  trackedTempDirs.push(dir);

  return dir;
}

export async function cleanupTempDirs(): Promise<void> {
  vi.unstubAllEnvs();
  await Promise.all(
    trackedTempDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
}

export async function gitRepository(
  options: { initialBranch?: string } = {},
): Promise<string> {
  const root = await tempDir("review-test-source-");
  execFileSync(
    "git",
    ["-C", root, "init", "-b", options.initialBranch ?? "main"],
    { stdio: "pipe" },
  );

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });

  git("config", "user.email", "review@example.test");
  git("config", "user.name", "Review Test");
  await writeFile(path.join(root, "README.md"), "# Review\n", "utf8");
  git("add", ".");
  git("commit", "-m", "initial");

  return root;
}

export async function reviewHome(): Promise<string> {
  const home = await tempDir("review-test-home-");
  vi.stubEnv("DEV_REVIEW_HOME", home);

  return home;
}

/** A review directory whose `.git` and `.bundle` are promotable placeholders. */
export async function storedReviewFixture(
  options: { schemaVersion?: 4 | 5; uuid?: string } = {},
): Promise<{ reviewDir: string; record: JsonObject }> {
  const root = await tempDir("review-promotion-");
  const reviewDir = path.join(root, "review");
  await mkdir(path.join(reviewDir, ".git"), { recursive: true });
  await mkdir(path.join(reviewDir, ".bundle"));

  const record: JsonObject = {
    schemaVersion: options.schemaVersion ?? 5,
    uuid: options.uuid ?? DEFAULT_STORED_REVIEW_UUID,
    repoKey: "repo",
    worktreePath: "/source",
    baseRef: "main",
    baseCommit: "a".repeat(40),
    sourceCommit: "b".repeat(40),
    sourceIdentity: null,
    title: "Preserve",
    sourceSession: "disabled:review",
    status: "accepted",
    presentedDocumentRevision: "c".repeat(40),
    presentedSoftwareMapRevision: null,
    createdAt: "created",
    lastPublishedAt: "published",
    viewedAt: "viewed",
    dismissedAt: "dismissed",
  };

  await writeFile(path.join(reviewDir, "review.json"), JSON.stringify(record));
  await writeFile(path.join(reviewDir, ".git", "HEAD"), "old-head");
  await writeFile(path.join(reviewDir, ".bundle", "document"), "old-document");

  return { reviewDir, record };
}

/** The pre-JSON `.bundle/document` shape: a v1 manifest and an ESM module. */
export async function writeLegacyDocument(
  reviewDir: string,
  options: { code?: string } = {},
): Promise<void> {
  const target = path.join(reviewDir, ".bundle/document");
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await writeFile(
    path.join(target, "manifest.json"),
    JSON.stringify({ version: 1, routePath: "/", sourcePath: "review.mdx" }),
  );
  await writeFile(
    path.join(target, "review-document.js"),
    options.code ?? DEFAULT_LEGACY_DOCUMENT_CODE,
  );
}

/**
 * A review directory in the MDX-era layout (review.mdx, data.ts, package.json)
 * with a current review.json, for the legacy migration and import tests.
 */
export async function createLegacyReviewDir(binding: {
  reviewsHomePath?: string;
  worktreePath: string;
  baseRef: string;
  baseCommit: string;
  sourceCommit?: string;
  sourceIdentity?: ReviewSourceIdentity;
}): Promise<StoredReview> {
  const uuid = randomUUID();
  const dir = path.join(reviewsHomeDir(binding.reviewsHomePath), uuid);

  const review: StoredReviewRecord = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    uuid,
    repoKey: "repo",
    worktreePath: path.resolve(binding.worktreePath),
    baseRef: binding.baseRef,
    baseCommit: binding.baseCommit,
    sourceCommit: binding.sourceCommit ?? null,
    sourceIdentity: binding.sourceIdentity ?? null,
    pullRequestNumber: null,
    pullRequestUrl: null,
    title: "Progressive Review",
    sourceSession: DISABLED_REVIEW_SOURCE_SESSION,
    status: "draft",
    presentedDocumentRevision: null,
    presentedSoftwareMapRevision: null,
    createdAt: new Date().toISOString(),
    lastPublishedAt: null,
  };

  await mkdir(dir, { recursive: true, mode: 0o700 });
  await reviewVcs.init(dir);
  await Promise.all([
    writeFile(
      path.join(dir, "review.mdx"),
      `# ${review.title}\n\nThis review document is ready for repo-specific notes.\n`,
    ),
    writeFile(path.join(dir, "data.ts"), "export {};\n"),
    writeFile(
      path.join(dir, "package.json"),
      `${JSON.stringify({ name: `review-${uuid}`, private: true, type: "module" }, null, 2)}\n`,
    ),
    // Legacy reviews kept build output and review.db out of their VCS.
    writeFile(
      path.join(dir, ".gitignore"),
      ".build/\nreview.db\nreview.db-wal\nreview.db-shm\n",
    ),
  ]);
  await writePrivateJsonAtomic(path.join(dir, "review.json"), review);

  return { dir, review };
}

/** A selection over one record read; health still comes from `fetch`, as in production. */
export function selectingDesktop(
  read: () => Promise<ReviewDesktopDiscovery | null>,
  fetch: typeof globalThis.fetch,
  base: Pick<ReviewInstanceSelection, "key" | "source"> = {
    key: "stable",
    source: "fallback",
  },
): () => Promise<ReviewInstanceSelection> {
  return async () => {
    let discovery: ReviewDesktopDiscovery | null;

    try {
      discovery = await read();
    } catch (error) {
      return {
        ...base,
        instances: [],
        problem: error instanceof Error ? error : new Error(String(error)),
      };
    }

    if (!discovery) return { ...base, instances: [] };

    const instance = {
      key: base.key,
      filePath: "",
      discovery,
      healthy: await isHealthyReviewDesktop(discovery, fetch),
    };

    return { ...base, instance, instances: [instance] };
  };
}
