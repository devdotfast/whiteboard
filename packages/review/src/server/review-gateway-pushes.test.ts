import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

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
} from "./review-gateway-test-utils.js";

const version = readReviewPackageVersion(import.meta.url);

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

/** A stand-in Desktop window on the laptop's relay. */
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

  const laptop = await startGateway(
    root,
    [{ alias: "wb-a", endpoint: a.endpoint }],
    { relay },
  );

  const first: { status: number; host: string | null }[] = [];

  const received = attachWindow(relay, async (request) => {
    if (request.name === "openApiReview") {
      const response = await laptop.request(
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

  // The remote asks the window for its capabilities through the gateway.
  expect(await a.api("/capabilities")).toMatchObject({
    desktopAvailable: true,
  });
  expect(received.map((request) => request.name)).toContain(
    "authoringCapabilities",
  );

  const reviewId = await seed(a.api, root, "Pushed", { open: true });

  expect(opened(received)).toEqual([reviewId]);
  expect(first).toEqual([{ status: 200, host: "wb-a" }]);
  // Known from the push: only the push's own check asked the laptop, and no
  // lookup followed the window's request.
  expect(
    laptop.localPaths.filter(
      (entry) => entry === `/reviews-api/${reviewId}/activity`,
    ),
  ).toHaveLength(1);
});

/** A remote whose /control sends `frames` and records every result. */
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

  /** Sends a frame on the newest /control stream. */
  const push = (frame: JsonValue) =>
    streams.at(-1)?.write(`data: ${JSON.stringify(frame)}\n\n`);

  return { fake, results, controls, push };
}

const verb = (id: string, request: JsonValue) => ({
  event: "desktop-verb",
  id,
  request,
});

it("refuses a remote's push to open the scratchpad or a shared review", async () => {
  const shared = `shared-${"a".repeat(64)}`;

  const remote = await pushingRemote([
    {
      event: "desktop-verb",
      id: "pad",
      request: {
        name: "openApiReview",
        args: { reviewId: "scratchpad", title: "Pad" },
      },
    },
    {
      event: "desktop-verb",
      id: "shared",
      request: {
        name: "openApiReview",
        args: { reviewId: shared, title: "S" },
      },
    },
  ]);

  const relay = new GlobalReviewDesktopVerbRelay({ maxClients: 1 });
  const received = attachWindow(relay);

  await startGateway(
    root,
    [{ alias: "wb-a", endpoint: remote.fake.endpoint }],
    {
      relay,
    },
  );

  await vi.waitFor(() => expect(remote.results).toHaveLength(2));
  expect(remote.results).toEqual(
    expect.arrayContaining([
      {
        id: "pad",
        response: { ok: false, error: expect.stringContaining("scratchpad") },
      },
      {
        id: "shared",
        response: { ok: false, error: expect.stringContaining(shared) },
      },
    ]),
  );
  expect(received).toEqual([]);
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

  // Both are attached once both answer the remote's capabilities question.
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

  const laptop = await startGateway(
    root,
    [{ alias: "wb-a", endpoint: remote.fake.endpoint }],
    { relay },
  );

  await vi.waitFor(() => expect(remote.controls).toHaveLength(1));

  // The remote's relay ends the stream, as a restart does.
  remote.controls[0]!.socket.destroy();

  await vi.waitFor(() => expect(remote.controls).toHaveLength(2), {
    timeout: 5_000,
  });
  expect(laptop.gateway.hosts()[0]?.state).toBe("online");

  await new Promise((resolve) => setTimeout(resolve, 1_500));
  expect(remote.controls).toHaveLength(2);
});

it("refuses every verb from a remote but capabilities, focus and opening a review", async () => {
  const remote = await pushingRemote([
    verb("shot", { name: "captureScreenshot", args: {} }),
    verb("home", {
      name: "openReview",
      args: { reviewUuid: randomUUID(), active: true },
    }),
  ]);

  const relay = new GlobalReviewDesktopVerbRelay({ maxClients: 1 });
  const received = attachWindow(relay);

  await startGateway(
    root,
    [{ alias: "wb-a", endpoint: remote.fake.endpoint }],
    {
      relay,
    },
  );

  await vi.waitFor(() => expect(remote.results).toHaveLength(2));
  expect(remote.results).toEqual(
    expect.arrayContaining([
      {
        id: "shot",
        response: {
          ok: false,
          error: "captureScreenshot is not available from another machine.",
        },
      },
      {
        id: "home",
        response: {
          ok: false,
          error: "openReview is not available from another machine.",
        },
      },
    ]),
  );
  expect(received).toEqual([]);
});

it("refuses a push to open another machine's review or the laptop's", async () => {
  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a.api, root, "On a");
  const b = await pushingRemote();
  const relay = new GlobalReviewDesktopVerbRelay({ maxClients: 1 });
  const received = attachWindow(relay);

  const laptop = await startGateway(
    root,
    [
      { alias: "wb-a", endpoint: a.endpoint },
      { alias: "wb-b", endpoint: b.fake.endpoint },
    ],
    { relay },
  );

  const onLaptop = await seed(laptop.api, root, "On the laptop");

  const hostOf = async () =>
    (await laptop.request(`/${onA}`)).headers.get(REVIEW_HOST_HEADER);

  await expect.poll(hostOf).toBe("wb-a");
  await vi.waitFor(() => expect(b.controls).toHaveLength(1));

  b.push(
    verb("a", { name: "openApiReview", args: { reviewId: onA, title: "A" } }),
  );
  b.push(
    verb("laptop", {
      name: "openApiReview",
      args: { reviewId: onLaptop, title: "L" },
    }),
  );

  await vi.waitFor(() => expect(b.results).toHaveLength(2));
  expect(b.results).toEqual(
    expect.arrayContaining([
      { id: "a", response: { ok: false, error: `${onA} belongs to wb-a.` } },
      {
        id: "laptop",
        response: { ok: false, error: `${onLaptop} belongs to the laptop.` },
      },
    ]),
  );
  expect(received).toEqual([]);
  expect(await hostOf()).toBe("wb-a");
});

it("attaches to remotes only while a window is attached to the laptop", async () => {
  const a = await startRemote(path.join(root, "a"));
  const relay = new GlobalReviewDesktopVerbRelay({ maxClients: 1 });

  const laptop = await startGateway(
    root,
    [{ alias: "wb-a", endpoint: a.endpoint }],
    { relay },
  );

  await expect.poll(() => laptop.gateway.hosts()[0]?.state).toBe("online");
  // Time enough to attach, were it going to.
  await new Promise((resolve) => setTimeout(resolve, 500));
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

  // The window goes: so does the attachment.
  detaches.splice(0).forEach((detach) => detach());
  await expect.poll(async () => (await a.health()).desktopAttached).toBe(false);
});

it("keeps a local review on the laptop when a remote lists its id, for every route", async () => {
  const relay = new GlobalReviewDesktopVerbRelay({ maxClients: 1 });
  const received = attachWindow(relay);
  const laptop = await startGateway(root, [], { relay });
  const onLaptop = await seed(laptop.api, root, "Local original");
  const remoteOnly = randomUUID();

  const summary = (reviewId: string, title: string) => ({
    reviewId,
    version: 1,
    title,
    createdAt: new Date(0).toISOString(),
    repositoryName: "project",
    viewedAt: null,
    dismissedAt: null,
  });

  const impostor = { ...summary(onLaptop, "Remote impostor"), document: [] };
  const results: JsonValue[] = [];
  let control: ServerResponse | undefined;

  // Claims the laptop's id in its list, its stream, its routes and a push.
  const fake = await startFake({
    version,
    reviewIds: [onLaptop, remoteOnly],
    handle(request, response) {
      if (request.url?.startsWith("/reviews-api/watch")) {
        response.setHeader("content-type", "application/x-ndjson");
        response.write(
          `${JSON.stringify({
            kind: "list",
            mode: "structural",
            reviews: [
              summary(onLaptop, "Remote impostor"),
              summary(remoteOnly, "Remote only"),
            ],
          })}\n`,
        );
        response.write(
          `${JSON.stringify({ kind: "review", reviewId: onLaptop, value: impostor })}\n`,
        );

        return true;
      }

      if (request.url === "/control") {
        response.setHeader("content-type", "text/event-stream");
        response.write(": attached\n\n");
        control = response;

        return true;
      }

      if (request.url === "/control/result") {
        let body = "";
        request.on("data", (chunk: Buffer) => (body += chunk.toString()));
        request.on("end", () => {
          results.push(JSON.parse(body));
          response.end('{"ok":true}');
        });

        return true;
      }

      return false;
    },
  });

  laptop.gateway.setHosts([{ alias: "wb-a", endpoint: fake.endpoint }]);

  // The remote's list has arrived once its other review routes to it.
  await expect
    .poll(async () =>
      (await laptop.request(`/${remoteOnly}`)).headers.get(REVIEW_HOST_HEADER),
    )
    .toBe("wb-a");

  // Read before any merged list: the laptop's store decides, not a cache.
  const read = await laptop.request(`/${onLaptop}?full=true`);
  expect(read.headers.has(REVIEW_HOST_HEADER)).toBe(false);
  expect(await read.json()).toMatchObject({ title: "Local original" });

  const list = (
    await laptop.api<{ reviewId: string; title: string; host?: string }[]>("")
  ).filter((entry) => entry.reviewId !== "scratchpad");

  expect(list.map(({ title, host }) => ({ title, host }))).toEqual([
    { title: "Local original", host: undefined },
    { title: "Remote only", host: "wb-a" },
  ]);

  const client = new ReviewApiClient({
    serverUrl: laptop.url,
    token: "laptop-token",
  });

  const abort = new AbortController();
  detaches.push(() => abort.abort());

  for await (const line of client.watch(
    [{ reviewId: onLaptop, mode: "structural" }],
    abort.signal,
  )) {
    expect(line).toMatchObject({
      kind: "review",
      reviewId: onLaptop,
      value: { title: "Local original" },
    });
    break;
  }

  const renamed = await laptop.request("/commands", {
    method: "POST",
    body: JSON.stringify({
      commandId: randomUUID(),
      operation: { type: "rename", reviewId: onLaptop, title: "Renamed" },
    }),
  });

  expect(renamed.status).toBe(200);
  expect(renamed.headers.has(REVIEW_HOST_HEADER)).toBe(false);
  expect(laptop.local.store.summary(onLaptop)?.title).toBe("Renamed");

  // Last, so no earlier step learnt the id from the push's own check.
  control?.write(
    `data: ${JSON.stringify(verb("push", { name: "openApiReview", args: { reviewId: onLaptop, title: "I" } }))}\n\n`,
  );
  await vi.waitFor(() => expect(results).toHaveLength(1));
  expect(results).toEqual([
    {
      id: "push",
      response: { ok: false, error: `${onLaptop} belongs to the laptop.` },
    },
  ]);
  expect(received).toEqual([]);

  // The remote heard only its list subscription and the push's result.
  expect(
    fake.requests.filter((request) => request.url?.includes(onLaptop)),
  ).toEqual([]);
  expect(
    laptop.logged.filter((line) => line.includes(`${onLaptop} is also listed`)),
  ).toHaveLength(1);

  // A review the laptop gains after a remote served it: the list that shows
  // the laptop's row also routes it to the laptop.
  const { pins } = laptop.local.store.read(onLaptop);

  if (!pins) throw new Error("The seeded review has no pins.");

  await laptop.local.store.importVersion({
    reviewId: remoteOnly,
    title: "Imported",
    pins,
    document: [],
    createdAt: new Date().toISOString(),
  });

  expect(
    (await laptop.api<{ reviewId: string; host?: string }[]>("")).find(
      (entry) => entry.reviewId === remoteOnly,
    ),
  ).not.toHaveProperty("host");
  expect(
    (await laptop.request(`/${remoteOnly}?full=true`)).headers.has(
      REVIEW_HOST_HEADER,
    ),
  ).toBe(false);
});
