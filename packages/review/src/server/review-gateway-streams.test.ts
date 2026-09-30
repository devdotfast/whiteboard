import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { type IncomingMessage, get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type JsonObject,
  ReviewApiClient,
  type ReviewApiSummary,
  type ReviewStreamLine,
} from "@dev.fast/review-protocol";
import { readReviewPackageVersion } from "@review/package-paths.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  seed,
  startFake,
  startGateway,
  startRemote,
  stopAll,
} from "./review-gateway-test-utils.js";

const version = readReviewPackageVersion(import.meta.url);

let root: string;

const stops: (() => void)[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "review-streams-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  vi.stubEnv("DEV_FAST_REVIEW_TELEMETRY_DISABLED", "1");
});

afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  await stopAll();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

type Api = <T>(route: string, init?: RequestInit) => Promise<T>;

type Subscription = { reviewId: string | null; mode?: "structural" };

/** The gateway's watch stream through the real client. */
function follow(url: string, subscriptions: Subscription[]) {
  const client = new ReviewApiClient({ serverUrl: url, token: "laptop-token" });
  const abort = new AbortController();
  const lines: ReviewStreamLine[] = [];
  /** Every line, also those `until` dropped. */
  const all: ReviewStreamLine[] = [];
  let ended = false;

  void (async () => {
    for await (const line of client.watch(subscriptions, abort.signal)) {
      lines.push(line);
      all.push(line);
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      ended = true;
    });

  stops.push(() => abort.abort());

  /** Waits for a line that passes `test` and drops every line up to it. */
  const until = async (
    test: (line: ReviewStreamLine) => boolean,
    timeout = 5_000,
  ) => {
    let found: ReviewStreamLine | undefined;

    await vi.waitFor(
      () => {
        const index = lines.findIndex(test);
        expect(index).toBeGreaterThanOrEqual(0);
        found = lines.splice(0, index + 1).at(-1);
      },
      { timeout },
    );

    return found!;
  };

  return { lines, all, until, ended: () => ended };
}

const listed = (line: ReviewStreamLine) =>
  line.kind === "list" ? line.reviews : undefined;

const entry = (line: ReviewStreamLine, title: string) =>
  listed(line)?.find((review) => review.title === title);

const valueOf = (line: ReviewStreamLine, reviewId: string) =>
  line.kind === "review" && line.reviewId === reviewId && "value" in line
    ? line.value
    : undefined;

const errorOf = (line: ReviewStreamLine, reviewId: string) =>
  line.kind === "review" && line.reviewId === reviewId && "error" in line
    ? line.error
    : undefined;

const focusOf = (line: ReviewStreamLine) =>
  line.kind === "review" && "value" in line
    ? (line.value.activity as { focuses?: { description: string }[] })
        .focuses?.[0]?.description
    : undefined;

const leases = new Map<string, string>();

/** One authoring step on a review: its activity changes, so its line does. */
const step = (api: Api, reviewId: string, description: string) => {
  const leaseId = leases.get(reviewId);

  if (!leaseId) leases.set(reviewId, randomUUID());

  return api(`/${reviewId}/activity`, {
    method: "POST",
    body: JSON.stringify({
      action: leaseId ? "renew" : "begin",
      leaseId: leases.get(reviewId),
      focus: { description },
    }),
  });
};

const command = (api: Api, operation: JsonObject) =>
  api("/commands", {
    method: "POST",
    body: JSON.stringify({ commandId: randomUUID(), operation }),
  });

const withoutPad = (reviews: ReviewApiSummary[]) =>
  reviews.filter((review) => review.kind !== "scratchpad");

it("lists the laptop's reviews, then each host's in the setting's order, with host, state and availability", async () => {
  const a = await startRemote(path.join(root, "a"));
  const b = await startRemote(path.join(root, "b"));
  const onA = await seed(a.api, root, "On a");
  await seed(b.api, root, "On b");

  const laptop = await startGateway(root, [
    { alias: "wb-b", endpoint: b.endpoint },
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  await seed(laptop.api, root, "On the laptop");

  await expect
    .poll(
      async () =>
        withoutPad(await laptop.api<ReviewApiSummary[]>("")).map((review) => [
          review.title,
          review.host ?? null,
          review.hostState ?? null,
        ]),
      { timeout: 5_000 },
    )
    .toEqual([
      ["On the laptop", null, null],
      ["On b", "wb-b", "online"],
      ["On a", "wb-a", "online"],
    ]);

  const merged = await laptop.api<ReviewApiSummary[]>("");

  const asSent = (await a.api<ReviewApiSummary[]>("")).find(
    (review) => review.reviewId === onA,
  )!;

  const fromA = merged.find((review) => review.reviewId === onA)!;
  const { repositoryGroup, ...rest } = asSent;

  expect(fromA).toEqual({
    ...rest,
    repositoryGroup: {
      key: `wb-a:${repositoryGroup!.key}`,
      label: repositoryGroup!.label,
    },
    host: "wb-a",
    hostState: "online",
    available: { sourceWindows: false, languageFeatures: false },
  });

  const onLaptop = merged.find((review) => review.title === "On the laptop")!;
  expect(onLaptop).not.toHaveProperty("host");
  expect(onLaptop).not.toHaveProperty("hostState");
  expect(onLaptop).not.toHaveProperty("available");

  // The stream's list line is the same merged list.
  const stream = follow(laptop.url, [{ reviewId: null }]);
  expect(listed(await stream.until((line) => line.kind === "list"))).toEqual(
    merged,
  );
});

it("shows create, rename, dismiss and delete on every machine in the list", async () => {
  const a = await startRemote(path.join(root, "a"));
  const b = await startRemote(path.join(root, "b"));

  const laptop = await startGateway(root, [
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-b", endpoint: b.endpoint },
  ]);

  await expect
    .poll(() => laptop.gateway.hosts().map((host) => host.state))
    .toEqual(["online", "online"]);

  const stream = follow(laptop.url, [{ reviewId: null }]);

  for (const [api, host] of [
    [laptop.api, undefined],
    [a.api, "wb-a"],
    [b.api, "wb-b"],
  ] as const) {
    const title = `Made on ${host ?? "the laptop"}`;
    const reviewId = await seed(api, root, title);

    expect(
      entry(await stream.until((line) => !!entry(line, title)), title)?.host,
    ).toBe(host);

    await command(api, {
      type: "rename",
      reviewId,
      title: `${title}, renamed`,
    });
    await stream.until((line) => !!entry(line, `${title}, renamed`));

    await command(api, { type: "attention", reviewId, action: "dismiss" });
    await stream.until(
      (line) => !!entry(line, `${title}, renamed`)?.dismissedAt,
    );

    await command(api, { type: "delete", reviewId });
    await stream.until(
      (line) =>
        line.kind === "list" &&
        !line.reviews.some((review) => review.reviewId === reviewId),
    );
  }

  expect(stream.ended()).toBe(false);
});

it("sends each machine's edits once, for the right review", async () => {
  const a = await startRemote(path.join(root, "a"));
  const b = await startRemote(path.join(root, "b"));
  const onA = await seed(a.api, root, "On a");
  const onB = await seed(b.api, root, "On b");

  const laptop = await startGateway(root, [
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-b", endpoint: b.endpoint },
  ]);

  const onLaptop = await seed(laptop.api, root, "On the laptop");

  await expect
    .poll(() => laptop.gateway.hosts().map((host) => host.state))
    .toEqual(["online", "online"]);

  const stream = follow(laptop.url, [
    { reviewId: onLaptop },
    { reviewId: onA },
    { reviewId: onB },
  ]);

  await vi.waitFor(() =>
    expect(
      stream.lines.map((line) => line.kind === "review" && line.reviewId),
    ).toEqual(expect.arrayContaining([onLaptop, onA, onB])),
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(
    stream.lines.map((line) => line.kind === "review" && line.reviewId),
  ).toHaveLength(3);
  stream.lines.splice(0);

  const machines = { [onLaptop]: laptop.api, [onA]: a.api, [onB]: b.api };
  const order = [onA, onLaptop, onB, onB, onA, onLaptop, onA];

  for (const [index, reviewId] of order.entries()) {
    await step(machines[reviewId]!, reviewId, `Step ${index}`);

    await vi.waitFor(() => expect(stream.lines).toHaveLength(1));
    const [line] = stream.lines.splice(0);
    expect(line).toMatchObject({ kind: "review", reviewId });
    expect(focusOf(line!)).toBe(`Step ${index}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(stream.lines).toEqual([]);
});

/** The raw lines of a watch stream, as bytes. */
async function rawLines(url: string, token: string, reviewId: string) {
  const response = await fetch(
    `${url}/reviews-api/watch?subscriptions=${encodeURIComponent(
      JSON.stringify([{ reviewId }]),
    )}`,
    { headers: { "x-review-token": token } },
  );

  const reader = response.body!.getReader();
  stops.push(() => void reader.cancel().catch(() => undefined));
  let pending = Buffer.alloc(0);

  return async () => {
    for (;;) {
      const end = pending.indexOf(0x0a);

      if (end >= 0) {
        const line = pending.subarray(0, end);
        pending = pending.subarray(end + 1);

        return Buffer.from(line);
      }

      const { value, done } = await reader.read();

      if (done) throw new Error("The stream ended.");
      pending = Buffer.concat([pending, value]);
    }
  };
}

it("forwards a remote's review line byte for byte", async () => {
  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a.api, root, "On a");

  const laptop = await startGateway(root, [
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  await expect.poll(() => laptop.gateway.hosts()[0]?.state).toBe("online");

  const direct = await rawLines(a.endpoint.url, a.endpoint.token, onA);
  const through = await rawLines(laptop.url, "laptop-token", onA);
  await direct();
  await through();

  await step(a.api, onA, "Bytes");
  const sent = await direct();
  expect(sent.toString()).toContain("Bytes");
  expect((await through()).equals(sent)).toBe(true);
});

it("marks a stopped host's review and list entries, keeps the others live, and resumes when it returns", async () => {
  const a = await startRemote(path.join(root, "a"));
  const b = await startRemote(path.join(root, "b"));
  const onA = await seed(a.api, root, "On a");
  const onB = await seed(b.api, root, "On b");

  const laptop = await startGateway(root, [
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-b", endpoint: b.endpoint },
  ]);

  const onLaptop = await seed(laptop.api, root, "On the laptop");

  await expect
    .poll(() => laptop.gateway.hosts().map((host) => host.state))
    .toEqual(["online", "online"]);

  const stream = follow(laptop.url, [
    { reviewId: null },
    { reviewId: onLaptop },
    { reviewId: onA },
    { reviewId: onB },
  ]);

  await stream.until((line) => entry(line, "On b")?.hostState === "online");
  await vi.waitFor(() =>
    expect(stream.lines.some((line) => !!valueOf(line, onB))).toBe(true),
  );

  await b.stop();

  // Both, in either order.
  await vi.waitFor(() => {
    expect(stream.all.some((line) => !!errorOf(line, onB))).toBe(true);
    expect(
      stream.all.some((line) => entry(line, "On b")?.hostState === "offline"),
    ).toBe(true);
  });
  expect(stream.all.flatMap((line) => errorOf(line, onB) ?? [])).toEqual([
    expect.stringContaining("wb-b is offline"),
  ]);
  stream.lines.splice(0);

  await step(a.api, onA, "A while b is down");
  await stream.until((line) => focusOf(line) === "A while b is down");
  await step(laptop.api, onLaptop, "Laptop while b is down");
  await stream.until((line) => focusOf(line) === "Laptop while b is down");

  const again = await startRemote(path.join(root, "b"));
  expect(again.endpoint.url).not.toBe(b.endpoint.url);

  laptop.gateway.setHosts([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-b", endpoint: again.endpoint },
  ]);

  const since = stream.all.length;

  await vi.waitFor(() => {
    const lines = stream.all.slice(since);

    expect(lines.map((line) => valueOf(line, onB)).find(Boolean)).toMatchObject(
      { title: "On b" },
    );
    expect(
      lines.some((line) => entry(line, "On b")?.hostState === "online"),
    ).toBe(true);
  });

  await step(again.api, onB, "B is back");
  await stream.until((line) => focusOf(line) === "B is back");
  expect(stream.all.filter((line) => !!errorOf(line, onB))).toHaveLength(1);
  expect(stream.ended()).toBe(false);
}, 30_000);

it("lists a host's last reviews as connecting, then offline, after a restart while it is unreachable", async () => {
  const a = await startRemote(path.join(root, "a"));
  const b = await startRemote(path.join(root, "b"));
  await seed(a.api, root, "On a");
  await seed(b.api, root, "On b");

  const hosts = [
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-b", endpoint: b.endpoint },
  ];

  const first = await startGateway(root, hosts);

  await expect
    .poll(async () =>
      (await first.api<ReviewApiSummary[]>("")).map((review) => review.title),
    )
    .toEqual(expect.arrayContaining(["On a", "On b"]));
  await first.close();
  await b.stop();

  // b's address now accepts and never answers, so its first check takes 3 s.
  const hung = await startFake({ version, handle: () => true });

  const second = await startGateway(root, [
    hosts[0]!,
    { alias: "wb-b", endpoint: hung.endpoint },
  ]);

  // Before b's first check ends, its remembered reviews are listed as connecting.
  expect(
    (await second.api<ReviewApiSummary[]>(""))
      .filter((review) => review.host === "wb-b")
      .map((review) => [review.title, review.hostState]),
  ).toEqual([["On b", "connecting"]]);

  await expect
    .poll(
      async () =>
        withoutPad(await second.api<ReviewApiSummary[]>("")).map((review) => [
          review.title,
          review.host,
          review.hostState,
        ]),
      { timeout: 5_000 },
    )
    .toEqual([
      ["On a", "wb-a", "online"],
      ["On b", "wb-b", "offline"],
    ]);
});

it("leaves a remote's scratchpad and shared reviews out of the list", async () => {
  const kept = randomUUID();

  const summary = (reviewId: string, title: string) => ({
    reviewId,
    version: 1,
    title,
    createdAt: new Date(0).toISOString(),
    repositoryName: "project",
    viewedAt: null,
    dismissedAt: null,
  });

  const fake = await startFake({
    version,
    handle(request, response) {
      if (!request.url?.startsWith("/reviews-api/watch")) return false;
      response.setHeader("content-type", "application/x-ndjson");
      response.write(
        `${JSON.stringify({
          kind: "list",
          mode: "structural",
          reviews: [
            summary("scratchpad", "Remote pad"),
            summary(`shared-${"a".repeat(64)}`, "Remote shared"),
            summary(kept, "Remote review"),
          ],
        })}\n`,
      );

      return true;
    },
  });

  const laptop = await startGateway(root, [
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect
    .poll(async () =>
      (await laptop.api<ReviewApiSummary[]>(""))
        .filter((review) => review.host)
        .map((review) => review.reviewId),
    )
    .toEqual([kept]);
});

it("keeps the laptop's and other hosts' lines coming while a host hangs", async () => {
  const hungId = randomUUID();

  const hung = await startFake({
    version,
    reviewIds: [hungId],
    handle: (request) =>
      request.url?.startsWith("/reviews-api/watch") ||
      request.url === "/control",
  });

  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a.api, root, "On a");

  const laptop = await startGateway(root, [
    { alias: "wb-h", endpoint: hung.endpoint },
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  const onLaptop = await seed(laptop.api, root, "On the laptop");

  await expect
    .poll(() => laptop.gateway.hosts().map((host) => host.state))
    .toEqual(["online", "online"]);

  const started = Date.now();

  const stream = follow(laptop.url, [
    { reviewId: null },
    { reviewId: hungId },
    { reviewId: onLaptop },
    { reviewId: onA },
  ]);

  await vi.waitFor(() => {
    expect(stream.lines.some((line) => !!entry(line, "On a"))).toBe(true);
    expect(stream.lines.some((line) => !!valueOf(line, onLaptop))).toBe(true);
    expect(stream.lines.some((line) => !!valueOf(line, onA))).toBe(true);
  });
  expect(Date.now() - started).toBeLessThan(3_000);

  // The hung host's review is reported once its host is marked offline.
  const error = errorOf(
    await stream.until((line) => !!errorOf(line, hungId), 12_000),
    hungId,
  );

  expect(error).toContain("wb-h is offline");
  expect(Date.now() - started).toBeLessThan(12_000);
}, 20_000);

it("gives a reader that stops reading the latest state once, not a backlog", async () => {
  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a.api, root, "On a");

  // Large lines fill the socket buffers after a few updates.
  await command(a.api, {
    type: "edit",
    reviewId: onA,
    edit: {
      type: "insert",
      content: { type: "markdown", markdown: "x".repeat(900 * 1024) },
    },
  });

  const laptop = await startGateway(root, [
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  await expect.poll(() => laptop.gateway.hosts()[0]?.state).toBe("online");

  const response = await new Promise<IncomingMessage>((resolve, reject) =>
    get(
      `${laptop.url}/reviews-api/watch?subscriptions=${encodeURIComponent(
        JSON.stringify([{ reviewId: onA }]),
      )}`,
      { headers: { "x-review-token": "laptop-token" } },
      resolve,
    ).on("error", reject),
  );

  stops.push(() => response.destroy());
  response.setEncoding("utf8");
  const lines: string[] = [];
  let pending = "";

  response.on("data", (chunk: string) => {
    pending += chunk;
    let end: number;

    while ((end = pending.indexOf("\n")) !== -1) {
      lines.push(pending.slice(0, end));
      pending = pending.slice(end + 1);
    }
  });

  await vi.waitFor(() => expect(lines).toHaveLength(1));
  response.pause();
  const updates = 40;

  for (let index = 1; index <= updates; index++)
    await step(a.api, onA, `Step ${index}`);

  response.resume();
  const steps: string[] = [];

  await vi.waitFor(
    () => {
      for (const line of lines.splice(0))
        steps.push(focusOf(JSON.parse(line)) ?? "");
      expect(steps.at(-1)).toBe(`Step ${updates}`);
    },
    { timeout: 10_000 },
  );
  expect(steps.filter((value) => value === `Step ${updates}`)).toHaveLength(1);
  expect(steps.length).toBeLessThan(updates / 2);
}, 30_000);
