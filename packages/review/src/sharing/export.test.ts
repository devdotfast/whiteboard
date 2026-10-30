import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { type JsonObject, isJsonObject } from "@dev.fast/review-protocol";
import type { ShareBundle } from "@dev.fast/review-share-protocol";
import { rangeAnchor } from "@dev.fast/whiteboard-document";
import { createReviewApi } from "@review/review-api/http.js";
import { openLocalReviewStore } from "@review/review-api/local-data.js";
import { afterEach, expect, it, vi } from "vitest";

import { exportShare } from "./export.js";
import { importShare, shareKey, validateShareBundle } from "./import.js";
import { fetchPinnedRepository } from "./repository.js";

const cleanup: Array<() => Promise<void>> = [];

const capability = () => randomBytes(32).toString("base64url");

afterEach(async () => {
  vi.unstubAllEnvs();

  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-sharing-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  await mkdir(repo);

  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  git("init");
  git("checkout", "-b", "feature/shared-head");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(path.join(repo, "main.ts"), "export const answer = 1;\n");
  await writeFile(path.join(repo, "old.ts"), "export const moved = true;\n");
  await writeFile(
    path.join(repo, "deleted.ts"),
    "export const obsolete = true;\n",
  );
  git("add", ".");
  git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  await writeFile(path.join(repo, "main.ts"), "export const answer = 2;\n");
  await writeFile(path.join(repo, "new.ts"), "export const added = true;\n");
  git("add", ".");
  git("mv", "old.ts", "renamed.ts");
  git("rm", "deleted.ts");
  git("commit", "-m", "head");
  const head = git("rev-parse", "HEAD");
  const local = openLocalReviewStore(path.join(root, "review.db"));
  cleanup.push(() => local.store.close());
  cleanup.push(() => local.data.close());
  const repository = await local.data.register(repo);
  const pins = { repositoryId: repository.id, base, head };

  const created = await local.store.execute({
    operation: {
      type: "create",
      title: "A shared review",
      target: { kind: "commits", ...pins },
    },
  });

  const traceId = randomUUID();
  await local.data.upload({
    kind: "trace",
    id: traceId,
    repositoryId: repository.id,
    trace: {
      label: "Retained conversation",
      events: [
        { id: "one", role: "user", text: "Change the answer." },
        { id: "two", role: "assistant", text: "Changed it to two." },
      ],
    },
  });

  for (const content of [
    {
      type: "code_peek",
      source: rangeAnchor({
        side: "head",
        file: "main.ts",
        fromLine: 1,
        toLine: 1,
      }),
    },
    {
      type: "code_peek",
      source: rangeAnchor({
        side: "head",
        file: "new.ts",
        fromLine: 1,
        toLine: 1,
      }),
    },
    {
      type: "trace_quote",
      traceId,
      eventId: "one",
      text: "Change the answer.",
    },
  ])
    await local.store.execute({
      operation: {
        type: "edit",
        reviewId: created.reviewId,
        edit: { type: "insert", content },
      },
    });

  return { root, repo, local, reviewId: created.reviewId };
}

const repository = { cloneUrl: "https://github.com/fixture/review.git" };

it("names a pull request's base branch so a viewer can show it", async () => {
  const { local, reviewId } = await fixture();
  const pullRequestUrl = "https://github.com/fixture/review/pull/7";
  await local.store.execute({
    operation: {
      type: "set_target",
      reviewId,
      target: local.store.read(reviewId).target,
      pullRequestUrl,
    },
  });
  vi.spyOn(local.data, "pullRequestBaseBranch").mockReturnValue("main");
  const exported = await exportShare({ ...local, reviewId, repository });
  expect(exported.snapshot.origin).toMatchObject({
    pullRequestUrl,
    baseBranch: "main",
  });
});

async function importFixture(
  prepare: (
    fixtureData: Awaited<ReturnType<typeof fixture>>,
    bundle: ShareBundle,
  ) => Promise<ShareBundle> | ShareBundle = (_, bundle) => bundle,
) {
  const fixtureData = await fixture();
  const { root, repo, local, reviewId } = fixtureData;

  const bundle = await prepare(
    fixtureData,
    await exportShare({ ...local, reviewId, repository }),
  );

  const recipient = openLocalReviewStore(path.join(root, "recipient.db"));
  cleanup.push(() => recipient.store.close());
  cleanup.push(() => recipient.data.close());
  vi.stubEnv("DEV_REVIEW_HOME", root);

  const fetchRepository = vi.fn<typeof fetchPinnedRepository>(
    (target, _url, ...rest) => fetchPinnedRepository(target, repo, ...rest),
  );

  const id = await importShare(
    { ...recipient, fetchRepository },
    shareKey("https://app.dev.fast", capability()),
    bundle,
  );

  const app = createReviewApi(recipient.store, recipient.data);

  return { ...fixtureData, bundle, recipient, id, app, fetchRepository };
}

/** Stand in for a bundle shared by an older Review: its sealed snapshot
 * carries `status` on every section. */
function withLegacySectionStatus(bundle: ShareBundle): ShareBundle {
  return withSnapshot(bundle, (snapshot) => ({
    ...snapshot,
    document: (snapshot.document as JsonObject[]).map((block) =>
      block.type === "section" ? { ...block, status: "complete" } : block,
    ),
  }));
}

it("exports a review saved with the retired section status and imports a bundle that still carries it", async () => {
  const { recipient, id, bundle } = await importFixture(
    async ({ root, local, reviewId }) => {
      const { version } = await local.store.execute({
        operation: {
          type: "edit",
          reviewId,
          edit: {
            type: "insert",
            content: { type: "section", title: "Notes", children: [] },
          },
        },
      });

      const db = new DatabaseSync(path.join(root, "review.db"));
      db.prepare(
        `UPDATE versions SET snapshot=json_set(snapshot,'$.document[3].status','in_progress') WHERE review_id=? AND version=?`,
      ).run(reviewId, version);
      db.close();

      const exported = await exportShare({ ...local, reviewId, repository });
      const { snapshot } = validateShareBundle(exported);
      expect(snapshot.document[3]).toMatchObject({ title: "Notes" });
      expect(snapshot.document[3]).not.toHaveProperty("status");

      return withLegacySectionStatus(exported);
    },
  );

  expect((bundle.snapshot.document as JsonObject[])[3]).toMatchObject({
    status: "complete",
  });
  const shared = recipient.store.read(id).document[3];
  expect(shared).toMatchObject({ type: "section", title: "Notes" });
  expect(shared).not.toHaveProperty("status");
});

/** Rewrite a bundle's sealed snapshot, as an older Review would have sealed it. */
function withSnapshot(
  bundle: ShareBundle,
  rewrite: (snapshot: JsonObject) => JsonObject,
): ShareBundle {
  // SAFETY: a bundle's snapshot is the JSON of a stored snapshot.
  return { ...bundle, snapshot: rewrite(bundle.snapshot as JsonObject) };
}

it("shares a review's lenses and reads a bundle that holds them as document blocks", async () => {
  const lens = {
    title: "Changed code",
    targets: [
      { kind: "files", patterns: ["main.ts"] },
      {
        kind: "ranges",
        sources: [
          rangeAnchor({
            side: "head",
            file: "new.ts",
            fromLine: 1,
            toLine: 1,
          }),
        ],
      },
    ],
  };

  const { recipient, id } = await importFixture(async ({ local, reviewId }) => {
    const { targetId } = await local.store.execute({
      operation: {
        type: "lens_edit",
        reviewId,
        edit: { type: "insert", ...lens },
      },
    });

    const exported = await exportShare({ ...local, reviewId, repository });
    expect(validateShareBundle(exported).snapshot.lenses).toEqual([
      { id: targetId, ...lens },
    ]);

    // An older Review sealed lenses into the document.
    return withSnapshot(exported, ({ lenses, document, ...snapshot }) => ({
      ...snapshot,
      document: [
        ...(Array.isArray(document) ? document : []),
        ...(Array.isArray(lenses) ? lenses : []).map((item) =>
          isJsonObject(item) ? { type: "file_lens", ...item } : item,
        ),
      ],
    }));
  });

  const shared = recipient.store.read(id);
  expect(shared.lenses).toEqual([{ id: expect.any(String), ...lens }]);
  expect(JSON.stringify(shared.document)).not.toContain("file_lens");
});

it("fetches pinned source into an independent repository and retains complete traces offline", async () => {
  const { id, repo, app, recipient } = await importFixture();
  expect(recipient.store.read(id).origin?.branch).toBe("feature/shared-head");
  await rename(repo, repo + "-hidden");
  expect(
    (await (await app.request(`/${id}/file?side=head&file=main.ts`)).json())
      .text,
  ).toBe("export const answer = 2;\n");
  expect(
    (await (await app.request(`/${id}/file?side=base&file=main.ts`)).json())
      .text,
  ).toBe("export const answer = 1;\n");
  expect((await app.request(`/${id}/file?side=base&file=new.ts`)).status).toBe(
    404,
  );
  const diffs = await (await app.request(`/${id}/diff`)).json();
  expect(diffs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "new.ts", status: "added" }),
      expect.objectContaining({ path: "deleted.ts", status: "deleted" }),
      expect.objectContaining({ path: "renamed.ts", status: "renamed" }),
    ]),
  );

  const quote = recipient.store
    .read(id)
    .document.find((block) => block.type === "trace_quote");

  const trace = await (
    await app.request(
      `/${id}/resources/${quote?.type === "trace_quote" && quote.traceId}`,
    )
  ).json();

  expect(trace.events).toHaveLength(2);
});

it("rejects an invalid bundle", async () => {
  const { bundle, recipient } = await importFixture();

  await expect(
    importShare(recipient, shareKey("https://app.dev.fast", capability()), {
      ...bundle,
      snapshot: {},
    }),
  ).rejects.toThrow("Invalid input");
});

it("imports links read at other commits of the repository", async () => {
  const { recipient, id } = await importFixture(
    async ({ repo, local, reviewId }) => {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

      const { base } = local.store.read(reviewId).pins!;

      // A commit outside the board's history, on a branch off its base.
      git("checkout", "-q", "-b", "side", base);
      await writeFile(path.join(repo, "side.ts"), "export const side = 1;\n");
      git("add", "side.ts");
      git("commit", "-qm", "side");
      const side = git("rev-parse", "HEAD");
      git("checkout", "-q", "feature/shared-head");

      // deleted.ts is gone at head; side.ts exists only on the branch.
      await local.store.execute({
        operation: {
          type: "edit",
          reviewId,
          edit: {
            type: "insert",
            content: {
              type: "markdown",
              markdown: `[gone](whiteboard:source/${base}/deleted.ts#L1) and [side](whiteboard:source/${side}/side.ts#L1)`,
            },
          },
        },
      });

      return exportShare({ ...local, reviewId, repository });
    },
  );

  expect(
    JSON.stringify(recipient.store.read(id).document).match(
      /whiteboard:source\/[0-9a-f]{40}/g,
    ),
  ).toHaveLength(2);
});

it("shares a plan whose links quote commits, and fetches them for its recipient", async () => {
  const { root, repo, local, reviewId: review } = await fixture();

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

  // A commit on a branch the recipient's clone doesn't fetch.
  git("checkout", "-q", "-b", "side");
  await writeFile(path.join(repo, "side.ts"), "export const side = 1;\n");
  git("add", "side.ts");
  git("commit", "-qm", "side");
  const side = git("rev-parse", "HEAD");
  git("checkout", "-q", "feature/shared-head");

  const { reviewId } = await local.store.execute({
    operation: {
      type: "create",
      title: "Plan",
      target: {
        kind: "project",
        repositoryId: local.store.read(review).pins!.repositoryId,
      },
    },
  });

  await local.store.execute({
    operation: {
      type: "edit",
      reviewId,
      edit: {
        type: "insert",
        content: {
          type: "markdown",
          markdown: `[side](whiteboard:source/${side}/side.ts#L1)`,
        },
      },
    },
  });

  const bundle = await exportShare({ ...local, reviewId, repository });

  const recipient = openLocalReviewStore(path.join(root, "recipient.db"));
  cleanup.push(() => recipient.store.close());
  cleanup.push(() => recipient.data.close());

  vi.stubEnv("DEV_REVIEW_HOME", root);

  // The recipient's clone has the default branch only.
  const id = await importShare(
    {
      ...recipient,
      cloneRepository: async (clone) => {
        await mkdir(clone, { recursive: true });
        execFileSync("git", ["init", "-q", clone]);
        execFileSync("git", ["-C", clone, "remote", "add", "origin", repo]);
        execFileSync("git", [
          "-C",
          clone,
          "fetch",
          "-q",
          "origin",
          "feature/shared-head",
        ]);
        execFileSync("git", [
          "-C",
          clone,
          "checkout",
          "-q",
          "--detach",
          "FETCH_HEAD",
        ]);
      },
    },
    shareKey("https://app.dev.fast", capability()),
    bundle,
  );

  const { target } = recipient.store.read(id);

  expect(target).toMatchObject({ kind: "project" });
  expect(
    execFileSync(
      "git",
      [
        "-C",
        recipient.store.repositoryPath(target!.repositoryId),
        "cat-file",
        "-t",
        side,
      ],
      { encoding: "utf8" },
    ).trim(),
  ).toBe("commit");
});

it("keeps the copy and its code after the sender edits and moves the branch", async () => {
  const { local, repo, reviewId, recipient, id, app } = await importFixture();
  const before = recipient.store.read(id);
  await writeFile(path.join(repo, "main.ts"), "export const answer = 999;\n");
  execFileSync("git", ["commit", "-am", "Later branch change"], {
    cwd: repo,
    stdio: "pipe",
  });
  await local.store.execute({
    operation: {
      type: "edit",
      reviewId,
      edit: {
        type: "insert",
        content: { type: "markdown", markdown: "Later author edit" },
      },
    },
  });
  expect(recipient.store.read(id)).toEqual(before);
  expect(
    (await (await app.request(`/${id}/file?side=head&file=main.ts`)).json())
      .text,
  ).toBe("export const answer = 2;\n");
});

it("requires a pinned review before sharing saved worktree changes", async () => {
  const { local, reviewId, repo } = await fixture();
  const snapshot = local.store.read(reviewId);
  await local.store.execute({
    operation: {
      type: "set_target",
      reviewId,
      target: {
        kind: "worktree",
        repositoryId: snapshot.pins!.repositoryId,
        base: snapshot.pins!.base,
      },
    },
  });
  await writeFile(path.join(repo, "main.ts"), "export const answer = 99;\n");
  await expect(exportShare({ ...local, reviewId, repository })).rejects.toThrow(
    "Pin this review to commits before sharing it.",
  );
  await local.store.execute({
    operation: {
      type: "set_target",
      reviewId,
      target: { kind: "commits", ...snapshot.pins },
    },
  });
  const bundle = await exportShare({ ...local, reviewId, repository });
  expect(validateShareBundle(bundle).snapshot.pins!.head).toBe(
    snapshot.pins!.head,
  );
});
