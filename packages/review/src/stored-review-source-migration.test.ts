import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { readStoredReview, sealReviewCandidate } from "./review-home";
import { createLegacyReviewDir } from "./review-test-utils";
import { migrateStoredReview } from "./stored-review-migration";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("binds the legacy authoring session as the source session", async () => {
  const { review } = await fixture();
  const migrated = await migrateStoredReview({ reviewDir: review.dir });

  expect(migrated.record.sourceSession).toBe("codex:original");
  expect(migrated.record.agentSessions?.["codex:original"]?.roles).toEqual([
    "author",
  ]);
  expect(await readStoredReview(review.dir)).toMatchObject({
    review: { sourceSession: "codex:original" },
  });
});

async function fixture() {
  const home = await mkdtemp(path.join(tmpdir(), "review-source-migration-"));
  roots.push(home);
  vi.stubEnv("DEV_REVIEW_HOME", home);
  const source = path.join(home, "source");
  await mkdir(source);

  const git = (args: string[]) =>
    execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();

  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "review@example.test"]);
  git(["config", "user.name", "Review Test"]);
  await writeFile(path.join(source, "README.md"), "# Source\n");
  git(["add", "."]);
  git(["commit", "-qm", "source"]);
  const commit = git(["rev-parse", "HEAD"]);

  const review = await createLegacyReviewDir({
    worktreePath: source,
    baseRef: "main",
    baseCommit: commit,
    sourceCommit: commit,
    sourceIdentity: { kind: "git-branch", name: "main" },
  });

  const bundle = path.join(review.dir, ".bundle/document");
  await mkdir(bundle, { recursive: true });
  await writeFile(
    path.join(bundle, "manifest.json"),
    JSON.stringify({ version: 1, routePath: "/", sourcePath: "review.mdx" }),
  );
  await writeFile(path.join(bundle, "review-document.js"), legacyDocument);
  const revision = await sealReviewCandidate(review.dir, "Legacy document");

  await writeFile(
    path.join(review.dir, "review.json"),
    JSON.stringify({
      ...review.review,
      schemaVersion: 3,
      agentSession: "codex:original",
      sourceSession: undefined,
      presentedDocumentRevision: revision,
    }),
  );

  return { review };
}

const legacyDocument =
  'import { createActiveReviewDocument, jsx } from "review-doc-runtime"; export default createActiveReviewDocument({ title: "Legacy", routePath: "/", filePath: "review.mdx", modelNames: [], models: {}, Component: () => jsx("p", { children: "Legacy" }), isDefault: true });';
