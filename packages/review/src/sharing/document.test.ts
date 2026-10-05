import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ReviewInputError } from "@review/review-api/document.js";
import { createReviewApi } from "@review/review-api/http.js";
import { openLocalReviewStore } from "@review/review-api/local-data.js";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";

import { createShareFixture } from "../../test/fixtures/share/create.js";
import { type ShareBundle, digestBytes, exportShare } from "./export.js";
import { mountSharingPublisher } from "./host.js";
import { SharedReviewStore, validateShareBundle } from "./import.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllEnvs();

  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "document-sharing-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const local = openLocalReviewStore(path.join(root, "review.db"));
  cleanup.push(() => local.store.close());
  cleanup.push(() => local.data.close());

  const { reviewId } = await local.store.execute({
    operation: { type: "create", kind: "scratchpad", title: "Whiteboard" },
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

it("uploads and opens a document without registering or fetching a repository, including after restart", async () => {
  const local = await fixture();
  vi.stubEnv("DEV_REVIEW_SHARE_TOKEN", "fixture");
  vi.stubEnv("DEV_REVIEW_SHARE_ORIGIN", "https://sharing.test");
  const readRepository = vi.fn<() => Promise<{ cloneUrl: string }>>();
  const verifyRepository = vi.fn<() => Promise<{ cloneUrl: string }>>();
  const shareId = randomUUID();
  const bytes = new Map<string, Uint8Array>();
  let manifest: ShareBundle["manifest"];

  const signed = (name: string) => ({
    url: `https://objects.test/${name}`,
    headers: {},
    expiresAt: "2099",
  });

  const app = new Hono();
  app.onError((error, context) => context.json({ error: error.message }, 500));
  mountSharingPublisher(app, local.store, local.data, {
    readRepository,
    verifyRepository,
    fetch: async (input, init) => {
      const url = new URL(String(input));

      if (url.hostname === "objects.test") {
        bytes.set(url.pathname.slice(1), Buffer.from(init!.body as Uint8Array));

        return new Response(null);
      }

      if (url.pathname === "/api/shares")
        return Response.json({ shareId, upload: signed("manifest") });

      if (url.pathname.endsWith("/manifest")) {
        manifest = JSON.parse(Buffer.from(bytes.get("manifest")!).toString());

        return Response.json({
          registered: true,
          uploads: Object.fromEntries(
            manifest.objects.map(({ id }) => [id, signed(id)]),
          ),
        });
      }

      if (url.pathname.endsWith("/link"))
        return new Response(null, { status: 409 });

      return Response.json({
        shareId,
        url: `https://sharing.test/s/${shareId}#${"x".repeat(43)}`,
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
  expect(readRepository).not.toHaveBeenCalled();
  expect(verifyRepository).not.toHaveBeenCalled();
  expect(manifest!.repository).toBeUndefined();
  bytes.delete("manifest");
  const bundle = { manifest: manifest!, objects: bytes };
  const fetchRepository = vi.fn<() => Promise<void>>();

  const shared = new SharedReviewStore(
    path.join(local.root, "shared"),
    fetchRepository,
  );

  const id = await shared.import("https://sharing.test", shareId, bundle);
  await shared.assertReady(id);
  expect(shared.get(id).snapshot).toMatchObject({
    document: local.store.read(local.reviewId).document,
  });
  expect(shared.get(id).snapshot.pins).toBeUndefined();
  expect(shared.get(id).snapshot.target).toBeUndefined();
  expect(shared.get(id).snapshot).not.toHaveProperty("kind");
  expect(shared.list().map((review) => review.reviewId)).toEqual([id]);

  const api = createReviewApi(
    local.store,
    local.data,
    async () => ({ softwareMapEnabled: false }),
    shared,
  );

  expect((await api.request(`/${id}`)).status).toBe(200);
  expect((await api.request(`/${id}/open`, { method: "POST" })).status).toBe(
    200,
  );
  await expect(stat(shared.repositoryRoot(id))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const restarted = new SharedReviewStore(shared.root, fetchRepository);
  await restarted.load();
  await restarted.prepare(id);
  await restarted.assertReady(id);
  expect(restarted.list().map((review) => review.reviewId)).toEqual([id]);
  expect(fetchRepository).not.toHaveBeenCalled();
  await restarted.removeLocal(id);
  expect(restarted.list()).toEqual([]);
});

it("retains image and trace resources on a document without source pins", async () => {
  const local = await fixture();

  const resources = await createShareFixture(
    path.join(local.root, "resources"),
  );

  cleanup.push(() => resources.store.close());
  cleanup.push(() => resources.data.close());

  const { reviewId } = await resources.store.execute({
    operation: {
      type: "create",
      kind: "scratchpad",
      title: "Document with attachments",
    },
  });

  const source = await exportShare(resources);

  for (const resource of source.manifest.resources) {
    if (resource.kind === "map") continue;
    await resources.store.execute({
      operation: {
        type: "edit",
        reviewId,
        edit: {
          type: "insert",
          content:
            resource.kind === "image"
              ? { type: "image", assetId: resource.id, alt: "Attached image" }
              : {
                  type: "trace_quote",
                  traceId: resource.id,
                  eventId: "request",
                  text: "Please compute the answer.",
                },
        },
      },
    });
  }

  const bundle = await exportShare({
    store: resources.store,
    data: resources.data,
    reviewId,
  });

  expect(
    bundle.manifest.resources.map((resource) => resource.kind).sort(),
  ).toEqual(["image", "trace"]);
  const shared = new SharedReviewStore(path.join(local.root, "shared"));
  const id = await shared.import("https://sharing.test", randomUUID(), bundle);
  const api = createReviewApi(local.store, local.data, undefined, shared);

  for (const resource of bundle.manifest.resources) {
    const response = await api.request(`/${id}/resources/${resource.id}`);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from(bundle.objects.get(resource.object)!),
    );
  }
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
    const bytes = Buffer.from(JSON.stringify({ ...snapshot, ...extra }));
    const id = digestBytes(bytes);
    const objects = new Map(bundle.objects);
    objects.delete(bundle.manifest.snapshot);
    objects.set(id, bytes);
    expect(() =>
      validateShareBundle({
        objects,
        manifest: {
          ...bundle.manifest,
          snapshot: id,
          objects: bundle.manifest.objects.map((object) =>
            object.id === bundle.manifest.snapshot
              ? { id, sha256: id, size: bytes.length }
              : object,
          ),
        },
      }),
    ).toThrow(/source pins|code references/i);
  }

  await expect(
    exportShare({
      ...local,
      repository: { cloneUrl: "https://github.com/example/repo.git" },
    }),
  ).rejects.toBeInstanceOf(ReviewInputError);
});
