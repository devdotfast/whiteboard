import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Block } from "@dev.fast/whiteboard-document";
import { createReviewApi } from "@review/review-api/http.js";
import { openLocalReviewStore } from "@review/review-api/local-data.js";
import type { SharedProvenance } from "@review/review-api/store.js";
import { afterEach, expect, it, vi } from "vitest";

import { createShareFixture } from "../../test/fixtures/share/create.js";
import { exportShare } from "./export.js";
import {
  importShare,
  planShareCopy,
  receiveShare,
  shareKey,
  sharePresentationSchema,
  sharedSnapshotSchema,
} from "./import.js";
import { fetchPinnedRepository } from "./repository.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllEnvs();

  for (const close of cleanup.splice(0).reverse()) await close();
});

const key = () =>
  shareKey("https://app.dev.fast", randomBytes(32).toString("base64url"));

const [R1old, R1, R2, R3] = ["r0", "r1", "r2", "r3"];

const served = (id: string, latest: string) => ({
  revision: { id, version: 1, createdAt: 1 },
  latest,
});

/** A sender's share, with a block pinned to commits of its own, and a
 * recipient with an empty store. */
async function share() {
  const root = await mkdtemp(path.join(tmpdir(), "share-copy-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  const sender = await createShareFixture(root);
  cleanup.push(() => sender.store.close());
  cleanup.push(() => sender.data.close());
  const pins = sender.store.read(sender.reviewId).pins!;

  const { reviewId: other } = await sender.store.execute({
    operation: {
      type: "create",
      title: "Another of the sender's boards",
      target: { kind: "commits", ...pins },
    },
  });

  for (const content of [
    {
      type: "code_peek",
      source: "head/answer.ts#L2",
      pins: { repositoryId: pins.repositoryId, head: pins.base },
    },
    {
      type: "markdown",
      markdown: `[Here](whiteboard:board/${sender.reviewId}) and [there](whiteboard:board/${other}).`,
    },
  ])
    await sender.store.execute({
      operation: {
        type: "edit",
        reviewId: sender.reviewId,
        edit: { type: "insert", content },
      },
    });

  const bundle = await exportShare(sender);
  const recipient = openLocalReviewStore(path.join(root, "recipient.db"));
  cleanup.push(() => recipient.store.close());
  cleanup.push(() => recipient.data.close());

  const fetchRepository = vi.fn<typeof fetchPinnedRepository>(
    (target, _url, ...rest) =>
      fetchPinnedRepository(target, sender.repo, ...rest),
  );

  return { root, sender, other, pins, bundle, recipient, fetchRepository };
}

it("copies a share into a board the recipient edits like their own", async () => {
  const { sender, other, pins, bundle, recipient, fetchRepository } =
    await share();

  const link = key();

  const reviewId = await importShare(
    { ...recipient, fetchRepository },
    link,
    bundle,
    { login: "ada", sharedAt: 1, revisionId: R1 },
  );

  await rename(sender.repo, `${sender.repo}-gone`);
  expect(fetchRepository).toHaveBeenCalledWith(
    expect.any(String),
    sender.repository.cloneUrl,
    expect.objectContaining({ base: pins.base, head: pins.head }),
    [],
  );

  const copy = recipient.store.read(reviewId);
  const { repositoryId } = copy.pins!;

  expect(copy.shared).toEqual({
    login: "ada",
    sharedAt: 1,
    cloneUrl: sender.repository.cloneUrl,
    key: link,
    revisionId: R1,
    importedVersion: 0,
  });
  expect(repositoryId).not.toBe(pins.repositoryId);
  expect(JSON.stringify(copy.document)).not.toContain(pins.repositoryId);
  expect(
    copy.document.find(
      (block): block is Extract<Block, { type: "code_peek" }> =>
        block.type === "code_peek" && block.pins !== undefined,
    )?.pins,
  ).toEqual({ repositoryId, head: pins.base });
  expect(JSON.stringify(copy.document)).toContain(
    `[Here](whiteboard:board/${reviewId}) and [there](whiteboard:board/${other}).`,
  );

  const app = createReviewApi(recipient.store, recipient.data);
  const json = async (url: string) => (await app.request(url)).json();

  const quote = copy.document.find((block) => block.type === "trace_quote");
  const map = copy.document.find((block) => block.type === "software_map");

  expect(
    (
      await json(
        `/${reviewId}/resources/${quote?.type === "trace_quote" && quote.traceId}`,
      )
    ).events,
  ).toHaveLength(2);
  expect(
    (
      await json(
        `/${reviewId}/maps/${map?.type === "software_map" && map.mapVersionId}`,
      )
    ).countsByElementPath,
  ).toBeTruthy();
  expect(
    (await json(`/${reviewId}/file?side=head&file=answer.ts`)).text,
  ).toContain("return 42;");

  const renamed = await app.request("/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: { type: "rename", reviewId, title: "Mine now" },
    }),
  });

  expect(renamed.status).toBe(200);
  expect(recipient.store.read(reviewId).title).toBe("Mine now");
});

it("plans the three rules", () => {
  const c = (over: Partial<SharedProvenance>) => ({
    reviewId: "a",
    version: 3,
    shared: { key: "k", revisionId: R1, importedVersion: 3, ...over },
  });

  expect(
    planShareCopy([c({})], {
      revision: { id: R1, version: 4, createdAt: 1 },
      latest: R2,
    }),
  ).toEqual({ kind: "open", reviewId: "a" });
  expect(planShareCopy([c({})], served(R2, R2))).toEqual({
    kind: "refresh",
    reviewId: "a",
    version: 3,
  });
  expect(planShareCopy([{ ...c({}), version: 4 }], served(R2, R2))).toEqual({
    kind: "import",
  });
  expect(planShareCopy([c({})], served(R1old, R2))).toEqual({
    kind: "import",
  });
  expect(
    planShareCopy(
      [{ reviewId: "l", version: 0, shared: { key: "k" } }],
      served(R2, R2),
    ),
  ).toEqual({ kind: "refresh", reviewId: "l", version: 0 });
  expect(
    planShareCopy(
      [{ reviewId: "l", version: 1, shared: { key: "k" } }],
      served(R2, R2),
    ),
  ).toEqual({ kind: "import" });
});

it("reopens, refreshes in place from Trash, and copies beside an edited board", async () => {
  const { bundle, recipient, fetchRepository } = await share();
  const input = { ...recipient, fetchRepository };
  const link = key();

  const download = vi.fn<Parameters<typeof receiveShare>[3]>(async () => ({
    bundle,
    attribution: { login: "ada", sharedAt: 1 },
  }));

  const a = await receiveShare(input, link, served(R1, R1), download);

  expect(await receiveShare(input, link, served(R1, R1), download)).toBe(a);
  expect(download).toHaveBeenCalledTimes(1);

  await recipient.store.execute(
    { operation: { type: "lifecycle", state: "trash", reviewId: a } },
    undefined,
    { kind: "person" },
  );

  expect(await receiveShare(input, link, served(R2, R2), download)).toBe(a);
  expect(recipient.store.read(a)).toMatchObject({
    version: 1,
    trashedAt: expect.any(String),
    shared: { revisionId: R2, importedVersion: 1 },
  });

  await recipient.store.execute(
    { operation: { type: "lifecycle", state: "active", reviewId: a } },
    undefined,
    { kind: "person" },
  );
  await recipient.store.execute(
    {
      operation: {
        type: "edit",
        reviewId: a,
        edit: {
          type: "insert",
          content: { type: "markdown", markdown: "Mine" },
        },
      },
    },
    undefined,
    { kind: "person" },
  );

  const b = await receiveShare(input, link, served(R3, R3), download);

  expect(b).not.toBe(a);
  expect(recipient.store.copiesOf(link).map((x) => x.reviewId)).toEqual([b, a]);
  expect(fetchRepository).toHaveBeenCalledTimes(1);
});

it("keeps a share's commits until its link's last copy is deleted", async () => {
  const { bundle, recipient, fetchRepository, pins } = await share();
  const input = { ...recipient, fetchRepository };
  const link = key();

  const download = async () => ({
    bundle,
    attribution: { login: "ada", sharedAt: 1 },
  });

  const a = await receiveShare(input, link, served(R1, R1), download);

  await recipient.store.execute(
    {
      operation: {
        type: "edit",
        reviewId: a,
        edit: {
          type: "insert",
          content: { type: "markdown", markdown: "Mine" },
        },
      },
    },
    undefined,
    { kind: "person" },
  );

  const b = await receiveShare(input, link, served(R2, R2), download);

  const root = recipient.store.repositoryPath(
    recipient.store.read(a).pins!.repositoryId,
  );

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

  const app = createReviewApi(recipient.store, recipient.data);

  const remove = async (reviewId: string) => {
    await recipient.store.execute(
      { operation: { type: "lifecycle", state: "trash", reviewId } },
      undefined,
      { kind: "person" },
    );

    const response = await app.request("/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: { type: "delete", reviewId } }),
    });

    expect(response.status).toBe(200);
  };

  await remove(a);
  expect(git("rev-parse", `refs/review/shared/${link}/${pins.head}`)).toBe(
    pins.head,
  );

  await remove(b);
  expect(git("for-each-ref", `refs/review/shared/${link}`)).toBe("");
});

it("fetches the shared commits into the recipient's own checkout", async () => {
  const { root, sender, pins, bundle, recipient, fetchRepository } =
    await share();

  const checkout = path.join(root, "recipient-checkout");
  await mkdir(checkout);

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: checkout, encoding: "utf8" }).trim();

  // Git reaches "GitHub" through the sender's repository.
  vi.stubEnv("HOME", root);
  await writeFile(
    path.join(root, ".gitconfig"),
    `[url "${sender.repo}"]\n\tinsteadOf = ${sender.repository.cloneUrl}\n`,
  );
  git("init", "-q");
  git("remote", "add", "origin", sender.repository.cloneUrl);
  git("fetch", "-q", "origin", pins.base);
  git("checkout", "-q", "--detach", "FETCH_HEAD");
  const own = await recipient.data.register(checkout);
  const link = key();

  const reviewId = await importShare(
    { ...recipient, fetchRepository },
    link,
    bundle,
  );

  expect(fetchRepository).not.toHaveBeenCalled();
  expect(recipient.store.read(reviewId).pins!.repositoryId).toBe(own.id);
  expect(git("rev-parse", `refs/review/shared/${link}/${pins.head}`)).toBe(
    pins.head,
  );
});

const element = (path: string, parentPath?: string) => ({
  type: "container" as const,
  id: path,
  path,
  parentPath,
  label: path,
  children: [],
});

const presentation = (elements: ReturnType<typeof element>[]) => ({
  maps: {
    map: {
      commit: "a".repeat(40),
      side: "head" as const,
      elements,
      relationships: [],
      countsByElementPath: {},
      unmappedByElementPath: {},
    },
  },
});

it("reads a map whose elements nest", () => {
  expect(() =>
    sharePresentationSchema.parse(
      presentation([element("app"), element("app.api", "app")]),
    ),
  ).not.toThrow();
});

it.each([
  ["itself", [element("app", "app")]],
  ["a loop", [element("a", "b"), element("b", "c"), element("c", "a")]],
])("refuses map elements nested in %s", (_name, elements) => {
  expect(() => sharePresentationSchema.parse(presentation(elements))).toThrow(
    /nest in a cycle/,
  );
});

const snapshot = (pullRequestUrl: string) => ({
  reviewId: "shared",
  version: 1,
  title: "Board",
  document: [],
  createdAt: "2026-10-20T00:00:00.000Z",
  origin: { pullRequestNumber: 7, pullRequestUrl },
});

it("links a pull request only by its canonical https URL", () => {
  expect(
    sharedSnapshotSchema.parse(snapshot("https://github.com/o/r/pull/7"))
      .origin,
  ).toEqual({
    pullRequestNumber: 7,
    pullRequestUrl: "https://github.com/o/r/pull/7",
  });

  for (const url of [
    "javascript:alert(1)",
    "http://github.com/o/r/pull/7",
    "/pull/7",
  ])
    expect(() => sharedSnapshotSchema.parse(snapshot(url))).toThrow(
      /pullRequestUrl/,
    );
});
