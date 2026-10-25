import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  MAX_SHARE_BYTES,
  createShareSchema,
} from "@dev.fast/review-share-protocol";
import { ReviewInputError } from "@review/review-api/document.js";
import { afterEach, expect, it, vi } from "vitest";

import { createShareFixture } from "../../test/fixtures/share/create.js";
import { ShareClient, readBoundedBytes } from "./client.js";
import { exportShare } from "./export.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function bundle() {
  const root = await mkdtemp(path.join(tmpdir(), "share-client-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const fixture = await createShareFixture(root);
  cleanup.push(async () => {
    await fixture.data.close();
    await fixture.store.close();
  });

  return exportShare(fixture);
}

it("creates a share with one POST, repeating it under the same request ID", async () => {
  const shared = await bundle();
  const shareId = randomUUID();
  const requestId = randomUUID();
  const link = `https://app.dev.fast/s/${"x".repeat(43)}`;
  const requests: { url: URL; method?: string; headers: Headers }[] = [];
  const created: unknown[] = [];

  const network: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({
      url,
      method: init?.method,
      headers: new Headers(init?.headers),
    });
    created.push(createShareSchema.parse(JSON.parse(String(init?.body))));

    return Response.json({ shareId, url: link });
  };

  const client = new ShareClient("https://app.dev.fast", "secret", network);

  for (let attempt = 0; attempt < 2; attempt++)
    expect(await client.create(shared, requestId)).toEqual({
      shareId,
      url: link,
    });

  expect(created).toEqual([
    { requestId, bundle: shared },
    { requestId, bundle: shared },
  ]);
  expect(
    requests.map(({ method, url }) => `${method} ${url.pathname}`),
  ).toEqual(["POST /api/v2/shares", "POST /api/v2/shares"]);

  for (const { headers } of requests)
    expect(headers.get("authorization")).toBe("Bearer secret");
});

it("surfaces a failed create and refuses an oversized share before any request", async () => {
  const shared = await bundle();

  const send = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 503 }),
  );

  const client = new ShareClient("https://app.dev.fast", "secret", send);

  await expect(client.create(shared)).rejects.toThrow("503");
  send.mockClear();
  shared.traces.large = "x".repeat(MAX_SHARE_BYTES);
  await expect(client.create(shared)).rejects.toBeInstanceOf(ReviewInputError);
  expect(send).not.toHaveBeenCalled();
});

it("downloads a share with the link's capability within the size limit", async () => {
  const shared = await bundle();
  const capability = "c".repeat(43);
  const requests: { path: string; headers: Headers }[] = [];

  const client = (body: () => BodyInit) =>
    new ShareClient("https://app.dev.fast", "secret", async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        path: url.pathname,
        headers: new Headers(init?.headers),
      });

      return url.pathname.endsWith("/bundle")
        ? new Response(body())
        : Response.json({
            title: shared.title,
            sender: { login: "sender" },
            sharedAt: 1,
            size: 1,
          });
    });

  expect(
    await client(() => JSON.stringify(shared)).download(capability),
  ).toEqual({
    bundle: shared,
    attribution: { login: "sender", sharedAt: 1 },
  });
  expect(requests.map(({ path }) => path)).toEqual([
    `/api/v2/shared/${capability}`,
    `/api/v2/shared/${capability}/bundle`,
  ]);

  for (const { headers } of requests)
    expect(headers.get("authorization")).toBeNull();

  await expect(
    client(
      () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_SHARE_BYTES + 1));
            controller.close();
          },
        }),
    ).download(capability),
  ).rejects.toThrow("limit");
});

it("stops a streamed response as soon as it exceeds the declared size", async () => {
  let cancelled = false;

  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(16));
    },
    cancel() {
      cancelled = true;
    },
  });

  await expect(readBoundedBytes(new Response(body), 8)).rejects.toThrow(
    "limit",
  );
  expect(cancelled).toBe(true);
});
