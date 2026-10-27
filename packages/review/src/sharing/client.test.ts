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
import { ShareAuthError, ShareClient, readBoundedBytes } from "./client.js";
import { exportShare } from "./export.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.useRealTimers();

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

    if (url.pathname === "/api/auth/token")
      return new Response(null, { status: 404 });
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
    async (input) =>
      new Response(null, {
        status: String(input).endsWith("/api/auth/token") ? 404 : 503,
      }),
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

const jwt = (exp: number, id: number) =>
  `header.${Buffer.from(JSON.stringify({ exp, id })).toString("base64url")}.signature`;

function service(exchange: (count: number) => Response) {
  const requests: string[] = [];
  let exchanges = 0;

  const send: typeof fetch = async (input, init) => {
    const { pathname } = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    requests.push(`${init?.method ?? "GET"} ${pathname} ${auth}`);

    return pathname === "/api/auth/token"
      ? exchange(++exchanges)
      : Response.json([]);
  };

  return { requests, send };
}

it("exchanges the device token for a JWT once and sends it until a minute before it expires", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const device = randomUUID();
  const issued: string[] = [];

  const { requests, send } = service((id) => {
    issued.push(jwt(Math.floor(Date.now() / 1000) + 120, id));

    return Response.json({ token: issued.at(-1) });
  });

  const client = new ShareClient("https://app.dev.fast", device, send);

  await client.list();
  vi.advanceTimersByTime(30_000);
  await client.list();
  vi.advanceTimersByTime(31_000);
  await client.list();
  expect(requests).toEqual([
    `GET /api/auth/token Bearer ${device}`,
    `GET /api/v2/shares Bearer ${issued[0]}`,
    `GET /api/v2/shares Bearer ${issued[0]}`,
    `GET /api/auth/token Bearer ${device}`,
    `GET /api/v2/shares Bearer ${issued[1]}`,
  ]);
});

it("treats a device token the exchange rejects as a stale login", async () => {
  const { send } = service(() => new Response(null, { status: 401 }));

  await expect(
    new ShareClient("https://app.dev.fast", randomUUID(), send).list(),
  ).rejects.toBeInstanceOf(ShareAuthError);
});

it("retries a failed exchange on the next request", async () => {
  const token = jwt(Math.floor(Date.now() / 1000) + 3600, 2);

  const { send } = service((id) =>
    id === 1 ? new Response(null, { status: 503 }) : Response.json({ token }),
  );

  const client = new ShareClient("https://app.dev.fast", randomUUID(), send);

  await expect(client.list()).rejects.toThrow("503");
  await expect(client.list()).resolves.toEqual([]);
});
