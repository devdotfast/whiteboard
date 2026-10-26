import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createShareSchema } from "@dev.fast/review-share-protocol";
import { createReviewApi } from "@review/review-api/http.js";
import { openLocalReviewStore } from "@review/review-api/local-data.js";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";

import { createShareFixture } from "../../test/fixtures/share/create.js";
import { exportShare } from "./export.js";
import { mountSharingPublisher } from "./host.js";
import { importShare, shareKey, validateShareBundle } from "./import.js";

const cleanup: Array<() => Promise<void>> = [];

const capability = () => randomBytes(32).toString("base64url");

afterEach(async () => {
  vi.unstubAllEnvs();

  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "document-sharing-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  const local = openLocalReviewStore(path.join(root, "review.db"));
  cleanup.push(() => local.store.close());
  cleanup.push(() => local.data.close());

  const { reviewId } = await local.store.execute({
    operation: {
      type: "create",
      title: "Whiteboard",
      target: {
        kind: "project",
        repositoryId: local.store.registerRepository(root).id,
      },
    },
  });

  await local.store.execute({
    operation: {
      type: "edit",
      reviewId,
      edit: {
        type: "insert",
        content: { type: "markdown", markdown: "# A plan\nJust a document." },
      },
    },
  });

  return { root, ...local, reviewId };
}

it("uploads a document without a GitHub repository for the browser alone", async () => {
  const local = await fixture();
  vi.stubEnv("DEV_REVIEW_SHARE_TOKEN", "fixture");
  vi.stubEnv("DEV_REVIEW_SHARE_ORIGIN", "https://sharing.test");
  const readRepository = vi.fn<() => Promise<{ cloneUrl: string }>>();
  const verifyRepository = vi.fn<() => Promise<void>>();
  const shareId = randomUUID();
  let body: unknown;

  const app = new Hono();
  app.onError((error, context) => context.json({ error: error.message }, 500));
  mountSharingPublisher(app, local.store, local.data, {
    readRepository,
    verifyRepository,
    fetch: async (input, init) => {
      expect(new URL(String(input)).pathname).toBe("/api/v2/shares");
      expect(init?.method).toBe("POST");
      body = JSON.parse(String(init?.body));

      return Response.json({
        shareId,
        url: `https://sharing.test/s/${"x".repeat(43)}`,
      });
    },
  });

  const response = await app.request("/sharing/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewId: local.reviewId }),
  });

  expect(await response.json()).toMatchObject({ shareId });
  expect(response.status).toBe(200);
  expect(verifyRepository).not.toHaveBeenCalled();
  const { bundle } = createShareSchema.parse(body);
  expect(bundle.repository).toBeUndefined();

  await expect(
    importShare(local, shareKey("https://sharing.test", capability()), bundle),
  ).rejects.toThrow("This share can only be viewed in the browser.");
});

it("retains trace resources on a document without source pins and leaves images unshared", async () => {
  const local = await fixture();

  const resources = await createShareFixture(
    path.join(local.root, "resources"),
  );

  cleanup.push(() => resources.store.close());
  cleanup.push(() => resources.data.close());

  const { reviewId } = await resources.store.execute({
    operation: {
      type: "create",
      title: "Document with attachments",
      target: {
        kind: "project",
        repositoryId: resources.store.registerRepository(local.root).id,
      },
    },
  });

  const source = await exportShare(resources);

  const assetId = resources.imageId;
  const [traceId] = Object.keys(source.traces);

  for (const content of [
    { type: "image", assetId, alt: "Attached image" },
    {
      type: "trace_quote",
      traceId,
      eventId: "request",
      text: "Please compute the answer.",
    },
  ])
    await resources.store.execute({
      operation: {
        type: "edit",
        reviewId,
        edit: { type: "insert", content },
      },
    });

  const bundle = await exportShare({
    store: resources.store,
    data: resources.data,
    reviewId,
    repository: { cloneUrl: "https://github.com/acme/app.git" },
  });

  expect(Object.keys(bundle.maps)).toEqual([]);
  expect(bundle.images).toEqual({});

  const id = await importShare(
    { ...local, cloneRepository: initRepository },
    shareKey("https://sharing.test", capability()),
    bundle,
  );

  const api = createReviewApi(local.store, local.data);
  const copy = local.store.read(id).document;
  const quote = copy.find((block) => block.type === "trace_quote");

  expect(copy.find((block) => block.type === "image")).toMatchObject({
    assetId,
  });
  expect((await api.request(`/${id}/resources/${assetId}`)).status).toBe(404);

  const response = await api.request(
    `/${id}/resources/${quote?.type === "trace_quote" && quote.traceId}`,
  );

  expect(response.status).toBe(200);
  expect((await response.json()).events).toHaveLength(2);
});

it("rejects source-dependent content disguised as a document-only share", async () => {
  const local = await fixture();
  const bundle = await exportShare(local);
  const snapshot = validateShareBundle(bundle).snapshot;

  for (const extra of [
    {
      pins: {
        repositoryId: "repo",
        base: "a".repeat(40),
        head: "b".repeat(40),
      },
    },
    {
      lenses: [
        {
          id: "lens",
          title: "Code",
          targets: [{ kind: "files", patterns: ["*.ts"] }],
        },
      ],
    },
    {
      document: [
        {
          id: "code",
          type: "markdown",
          markdown: "[source](review-source:head/main.ts#L1)",
        },
      ],
    },
  ]) {
    expect(() =>
      validateShareBundle({ ...bundle, snapshot: { ...snapshot, ...extra } }),
    ).toThrow(/code references|viewed in the browser/i);
  }
});

/** Stands in for a clone: an empty repository. */
async function initRepository(root: string) {
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "Empty",
  ]);
}

async function sharedPlan(cloneUrl = "https://github.com/acme/app.git") {
  const local = await fixture();
  const checkout = path.join(local.root, "app");
  execFileSync("git", ["init", "-q", checkout]);
  execFileSync("git", [
    "-C",
    checkout,
    "remote",
    "add",
    "origin",
    "https://github.com/acme/app.git",
  ]);
  const { id: repositoryId } = await local.data.register(checkout);

  const { reviewId } = await local.store.execute({
    operation: {
      type: "create",
      title: "Plan",
      target: { kind: "project", repositoryId },
    },
  });

  await local.store.execute({
    operation: {
      type: "edit",
      reviewId,
      edit: {
        type: "insert",
        content: { type: "markdown", markdown: "Ship the sidebar." },
      },
    },
  });

  const bundle = await exportShare({
    store: local.store,
    data: local.data,
    reviewId,
    repository: { cloneUrl },
  });

  const cloneRepository = vi.fn<typeof initRepository>(initRepository);

  const id = await importShare(
    { ...local, cloneRepository },
    shareKey("https://sharing.test", capability()),
    bundle,
  );

  return { local, id, repositoryId, cloneRepository };
}

it("files a shared plan without pins on the receiver's checkout of its repository", async () => {
  const { local, id, repositoryId, cloneRepository } = await sharedPlan();

  expect(local.store.read(id).target).toEqual({
    kind: "project",
    repositoryId,
  });
  expect(cloneRepository).not.toHaveBeenCalled();
});

it("clones the repository of a shared plan the receiver has no checkout of", async () => {
  const { local, id, repositoryId, cloneRepository } = await sharedPlan(
    "https://github.com/acme/other.git",
  );

  const { target } = local.store.read(id);

  expect(cloneRepository).toHaveBeenCalledWith(
    expect.any(String),
    "https://github.com/acme/other.git",
  );
  expect(target).toMatchObject({ kind: "project" });
  expect(target?.repositoryId).not.toBe(repositoryId);
});
