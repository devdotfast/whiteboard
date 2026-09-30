import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type JsonValue,
  REVIEW_HOST_HEADER,
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
  // Known from the push: the laptop was never asked whether it has it.
  expect(laptop.localPaths).not.toContain(`/reviews-api/${reviewId}/activity`);
});

/** A remote whose /control sends `frames` and records every result. */
async function pushingRemote(frames: JsonValue[]) {
  const results: JsonValue[] = [];
  const controls: IncomingMessage[] = [];

  const fake = await startFake({
    version,
    handle(request, response) {
      if (request.url === "/control") {
        controls.push(request);
        response.setHeader("content-type", "text/event-stream");
        response.write(": attached\n\n");

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

  return { fake, results, controls };
}

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

  const laptop = await startGateway(root, [
    { alias: "wb-a", endpoint: remote.fake.endpoint },
  ]);

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
