import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  type JsonValue,
  REVIEW_HOST_HEADER,
  ReviewApiClient,
  type ReviewVerbRequest,
  parseReviewDesktopVerbFrame,
} from "@dev.fast/review-protocol";
import { readReviewPackageVersion } from "@review/package-paths.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { GlobalReviewDesktopVerbRelay } from "./global-verb-relay.js";
import {
  seed,
  startFake,
  startGateway,
  startRemote,
  stopAll,
  summary,
} from "./review-gateway-test-utils.js";

const version = readReviewPackageVersion(import.meta.url);

// Another host on the same home: the store picks the review up from the database.
function copyReview(from: string, to: string, title: string) {
  const db = new DatabaseSync(path.join(root, "local", "review-api.db"));

  try {
    db.prepare(
      "INSERT INTO reviews(id,version,next_id,project_id) SELECT ?,version,next_id,project_id FROM reviews WHERE id=?",
    ).run(to, from);
    db.prepare(
      "INSERT INTO versions SELECT ?,version,json_set(snapshot,'$.reviewId',?,'$.title',?) FROM versions WHERE review_id=?",
    ).run(to, to, title, from);
  } finally {
    db.close();
  }
}

let root: string;

const detaches: (() => void)[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "review-pushes-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  vi.stubEnv("DEV_FAST_REVIEW_TELEMETRY_DISABLED", "1");
});

afterEach(async () => {
  for (const detach of detaches.splice(0)) detach();
  await stopAll();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const OPENED: JsonValue = { ok: true, result: { softwareMapEnabled: false } };

function attachWindow(
  relay: GlobalReviewDesktopVerbRelay,
  answer: (request: ReviewVerbRequest) => Promise<JsonValue> | JsonValue = () =>
    OPENED,
) {
  const abort = new AbortController();
  const received: ReviewVerbRequest[] = [];

  relay.attach({
    signal: abort.signal,
    write(frame) {
      const { id, request } = parseReviewDesktopVerbFrame(
        JSON.parse(frame.slice("data: ".length)),
      );

      received.push(request);
      void Promise.resolve(answer(request)).then((response) =>
        relay.acceptResult({ id, response }),
      );
    },
    close() {},
  });

  detaches.push(() => abort.abort());

  return received;
}

const opened = (received: ReviewVerbRequest[]) =>
  received.flatMap((request) =>
    request.name === "openApiReview" ? [request.args.reviewId] : [],
  );

it("opens a review a remote creates with open: true, and knows its owner before the window asks", async () => {
  const a = await startRemote(path.join(root, "a"));
  const relay = new GlobalReviewDesktopVerbRelay({ maxClients: 1 });

  const desktop = await startGateway(
    root,
    [{ alias: "wb-a", endpoint: a.endpoint }],
    { relay },
  );

  const first: { status: number; host: string | null }[] = [];

  const received = attachWindow(relay, async (request) => {
    if (request.name === "openApiReview") {
      const response = await desktop.request(
        `/${request.args.reviewId}?full=true`,
      );

      first.push({
        status: response.status,
        host: response.headers.get(REVIEW_HOST_HEADER),
      });
    }

    return OPENED;
  });

  await expect.poll(async () => (await a.health()).desktopAttached).toBe(true);

  expect(await a.api("/capabilities")).toMatchObject({
    desktopAvailable: true,
  });
  expect(received.map((request) => request.name)).toContain(
    "authoringCapabilities",
  );

  const reviewId = await seed(a.api, root, "Pushed", { open: true });

  expect(opened(received)).toEqual([reviewId]);
  expect(first).toEqual([{ status: 200, host: "wb-a" }]);
});

async function pushingRemote(frames: JsonValue[] = []) {
  const results: JsonValue[] = [];
  const controls: IncomingMessage[] = [];
  const streams: ServerResponse[] = [];

  const fake = await startFake({
    version,
    handle(request, response) {
      if (request.url === "/control") {
        controls.push(request);
        response.setHeader("content-type", "text/event-stream");
        response.write(": attached\n\n");
        streams.push(response);

        for (const frame of frames)
          response.write(`data: ${JSON.stringify(frame)}\n\n`);

        return true;
      }

      if (request.url === "/control/result") {
        let body = "";
        request.on("data", (chunk: Buffer) => (body += chunk.toString()));
        request.on("end", () => {
          results.push(JSON.parse(body));
          response.setHeader("content-type", "application/json");
          response.end('{"ok":true}');
        });

        return true;
      }

      return false;
    },
  });

  const push = (frame: JsonValue) =>
    streams.at(-1)?.write(`data: ${JSON.stringify(frame)}\n\n`);

  return { fake, results, controls, push };
}

const verb = (id: string, request: JsonValue) => ({
  event: "desktop-verb",
  id,
  request,
});

it("sends a push to every Desktop attached to the remote", async () => {
  const a = await startRemote(path.join(root, "a"));
  const windows: ReviewVerbRequest[][] = [];

  for (const name of ["one", "two"]) {
    const relay = new GlobalReviewDesktopVerbRelay({ maxClients: 1 });
    windows.push(attachWindow(relay));
    await startGateway(root, [{ alias: "wb-a", endpoint: a.endpoint }], {
      relay,
      home: path.join(root, name),
    });
  }

  await expect
    .poll(async () => {
      await a.api("/capabilities");

      return windows.map((received) =>
        received.some((request) => request.name === "authoringCapabilities"),
      );
    })
    .toEqual([true, true]);

  const reviewId = await seed(a.api, root, "For both", { open: true });

  await vi.waitFor(() =>
    expect(windows.map(opened)).toEqual([[reviewId], [reviewId]]),
  );
});

it("attaches again when a remote drops its /control stream, without a storm", async () => {
  const remote = await pushingRemote([]);
  const relay = new GlobalReviewDesktopVerbRelay({ maxClients: 1 });
  attachWindow(relay);

  const desktop = await startGateway(
    root,
    [{ alias: "wb-a", endpoint: remote.fake.endpoint }],
    { relay },
  );

  await vi.waitFor(() => expect(remote.controls).toHaveLength(1));

  remote.controls[0]!.socket.destroy();

  await vi.waitFor(() => expect(remote.controls).toHaveLength(2), {
    timeout: 5_000,
  });
  expect(desktop.gateway.hosts()[0]?.state).toBe("online");

  remote.push(verb("shot", { name: "captureScreenshot", args: {} }));
  await vi.waitFor(() =>
    expect(remote.results).toEqual([
      { id: "shot", response: expect.objectContaining({ ok: false }) },
    ]),
  );
  expect(remote.controls).toHaveLength(2);
});

it("refuses every push from a remote but capabilities, focus and opening one of its reviews", async () => {
  const shared = `shared-${"a".repeat(64)}`;

  const refused = [
    ["shot", { name: "captureScreenshot", args: {} }, "captureScreenshot"],
    [
      "home",
      { name: "openReview", args: { reviewUuid: randomUUID(), active: true } },
      "openReview",
    ],
    [
      "pad",
      { name: "openApiReview", args: { reviewId: "scratchpad", title: "P" } },
      "scratchpad",
    ],
    [
      "shared",
      { name: "openApiReview", args: { reviewId: shared, title: "S" } },
      shared,
    ],
  ] as const;

  const remote = await pushingRemote(
    refused.map(([id, request]) => verb(id, request)),
  );

  const relay = new GlobalReviewDesktopVerbRelay({ maxClients: 1 });
  const received = attachWindow(relay);

  await startGateway(
    root,
    [{ alias: "wb-a", endpoint: remote.fake.endpoint }],
    {
      relay,
    },
  );

  await vi.waitFor(() => expect(remote.results).toHaveLength(refused.length));
  expect(remote.results).toEqual(
    expect.arrayContaining(
      refused.map(([id, , named]) => ({
        id,
        response: { ok: false, error: expect.stringContaining(named) },
      })),
    ),
  );
  expect(received).toEqual([]);
});

it("attaches to remotes only while a window is attached to this machine", async () => {
  const a = await startRemote(path.join(root, "a"));
  const relay = new GlobalReviewDesktopVerbRelay({ maxClients: 1 });

  const desktop = await startGateway(
    root,
    [{ alias: "wb-a", endpoint: a.endpoint }],
    { relay },
  );

  await expect.poll(() => desktop.gateway.hosts()[0]?.state).toBe("online");
  expect((await a.health()).desktopAttached).toBe(false);
  expect(await a.api("/capabilities")).toMatchObject({
    desktopAvailable: false,
  });

  const unopened = await seed(a.api, root, "Not opened", { open: true });
  expect(unopened).toEqual(expect.any(String));

  const received = attachWindow(relay);

  await expect.poll(async () => (await a.health()).desktopAttached).toBe(true);
  expect(await a.api("/capabilities")).toMatchObject({
    desktopAvailable: true,
  });

  const opened = await seed(a.api, root, "Opened", { open: true });
  expect(
    received.flatMap((request) =>
      request.name === "openApiReview" ? [request.args.reviewId] : [],
    ),
  ).toEqual([opened]);

  detaches.splice(0).forEach((detach) => detach());
  await expect.poll(async () => (await a.health()).desktopAttached).toBe(false);
});

it("keeps a local review on this machine when a remote lists its id, for every route, a watch first", async () => {
  const desktop = await startGateway(root, []);
  const onLocal = await seed(desktop.api, root, "Local original");
  const remoteOnly = randomUUID();

  const impostor = { ...summary(onLocal, "Remote impostor"), document: [] };

  const fake = await startFake({
    version,
    reviewIds: [onLocal, remoteOnly],
    handle(request, response) {
      if (request.url?.startsWith("/reviews-api/watch")) {
        response.setHeader("content-type", "application/x-ndjson");
        response.write(
          `${JSON.stringify({
            kind: "list",
            mode: "structural",
            reviews: [
              summary(onLocal, "Remote impostor"),
              summary(remoteOnly, "Remote only"),
            ],
          })}\n`,
        );
        response.write(
          `${JSON.stringify({ kind: "review", reviewId: onLocal, value: impostor })}\n`,
        );

        return true;
      }

      return false;
    },
  });

  desktop.gateway.setHosts([{ alias: "wb-a", endpoint: fake.endpoint }]);

  await expect
    .poll(async () =>
      (await desktop.request(`/${remoteOnly}`)).headers.get(REVIEW_HOST_HEADER),
    )
    .toBe("wb-a");

  const client = new ReviewApiClient({
    serverUrl: desktop.url,
    token: "local-token",
  });

  const abort = new AbortController();
  detaches.push(() => abort.abort());

  for await (const line of client.watch(
    [{ reviewId: onLocal }],
    abort.signal,
  )) {
    expect(line).toMatchObject({
      kind: "review",
      reviewId: onLocal,
      value: { title: "Local original" },
    });
    break;
  }

  const read = await desktop.request(`/${onLocal}?full=true`);
  expect(read.headers.has(REVIEW_HOST_HEADER)).toBe(false);
  expect(await read.json()).toMatchObject({ title: "Local original" });

  const list = (
    await desktop.api<{ reviewId: string; title: string; host?: string }[]>("")
  ).filter((entry) => entry.reviewId !== "scratchpad");

  expect(list.map(({ title, host }) => ({ title, host }))).toEqual([
    { title: "Local original", host: undefined },
    { title: "Remote only", host: "wb-a" },
  ]);

  const renamed = await desktop.request("/commands", {
    method: "POST",
    body: JSON.stringify({
      operation: { type: "rename", reviewId: onLocal, title: "Renamed" },
    }),
  });

  expect(renamed.status).toBe(200);
  expect(renamed.headers.has(REVIEW_HOST_HEADER)).toBe(false);
  expect(desktop.local.store.summary(onLocal)?.title).toBe("Renamed");

  expect(
    fake.requests.filter((request) => request.url?.includes(onLocal)),
  ).toEqual([]);

  copyReview(onLocal, remoteOnly, "Imported");

  expect(
    (await desktop.api<{ reviewId: string; host?: string }[]>("")).find(
      (entry) => entry.reviewId === remoteOnly,
    ),
  ).not.toHaveProperty("host");
  const imported = await desktop.request(`/${remoteOnly}?full=true`);
  expect(imported.headers.has(REVIEW_HOST_HEADER)).toBe(false);
  expect(await imported.json()).toMatchObject({ title: "Imported" });
});
