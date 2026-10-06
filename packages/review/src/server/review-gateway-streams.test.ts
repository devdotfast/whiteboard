import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

import { gatewayMemoryPath } from "./review-gateway-memory.js";
import {
  seed,
  startFake,
  startGateway,
  startRemote,
  stopAll,
  summary,
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

type Subscription = { reviewId: string | null };

function follow(url: string, subscriptions: Subscription[]) {
  const client = new ReviewApiClient({ serverUrl: url, token: "local-token" });
  const abort = new AbortController();
  const lines: ReviewStreamLine[] = [];
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
    ? (
        line.value.activity as {
          activities?: { focus?: { description: string } }[];
        }
      ).activities?.[0]?.focus?.description
    : undefined;

const activities = new Map<string, string>();

const step = async (api: Api, reviewId: string, description: string) => {
  const activityId = activities.get(reviewId);

  const result = await api<{ activityId?: string }>(
    `/${reviewId}/activity/${activityId ? "update" : "begin"}`,
    {
      method: "POST",
      body: JSON.stringify({ activityId, focus: { description } }),
    },
  );

  if (!activityId && result.activityId)
    activities.set(reviewId, result.activityId);

  return result;
};

const command = (api: Api, operation: JsonObject) =>
  api("/commands", {
    method: "POST",
    body: JSON.stringify({ operation }),
  });

const withoutPad = (reviews: ReviewApiSummary[]) =>
  reviews.filter((review) => review.kind !== "scratchpad");

it("lists this machine's reviews, then each host's in the setting's order, with host, state and availability", async () => {
  const a = await startRemote(path.join(root, "a"));
  const b = await startRemote(path.join(root, "b"));
  const onA = await seed(a.api, root, "On a");
  await seed(b.api, root, "On b");

  const desktop = await startGateway(root, [
    { alias: "wb-b", endpoint: b.endpoint },
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  await seed(desktop.api, root, "On this machine");

  await expect
    .poll(
      async () =>
        withoutPad(await desktop.api<ReviewApiSummary[]>("")).map((review) => [
          review.title,
          review.host ?? null,
          review.hostState ?? null,
        ]),
      { timeout: 5_000 },
    )
    .toEqual([
      ["On this machine", null, null],
      ["On b", "wb-b", "online"],
      ["On a", "wb-a", "online"],
    ]);

  const merged = await desktop.api<ReviewApiSummary[]>("");

  const asSent = (await a.api<ReviewApiSummary[]>("")).find(
    (review) => review.reviewId === onA,
  )!;

  const fromA = merged.find((review) => review.reviewId === onA)!;
  const { project, ...rest } = asSent;

  expect(fromA).toEqual({
    ...rest,
    project: { id: `wb-a:${project!.id}`, name: project!.name },
    host: "wb-a",
    hostState: "online",
    available: { sourceWindows: false },
  });

  const onLocal = merged.find((review) => review.title === "On this machine")!;
  expect(onLocal).not.toHaveProperty("host");
  expect(onLocal).not.toHaveProperty("hostState");
  expect(onLocal).not.toHaveProperty("available");

  const stream = follow(desktop.url, [{ reviewId: null }]);
  expect(listed(await stream.until((line) => line.kind === "list"))).toEqual(
    merged,
  );
});

it("shows create, rename, dismiss and delete on every machine in the list", async () => {
  const a = await startRemote(path.join(root, "a"));
  const b = await startRemote(path.join(root, "b"));

  const desktop = await startGateway(root, [
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-b", endpoint: b.endpoint },
  ]);

  await expect
    .poll(() => desktop.gateway.hosts().map((host) => host.state))
    .toEqual(["online", "online"]);

  const stream = follow(desktop.url, [{ reviewId: null }]);

  for (const [api, host] of [
    [desktop.api, undefined],
    [a.api, "wb-a"],
    [b.api, "wb-b"],
  ] as const) {
    const title = `Made on ${host ?? "this machine"}`;
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

    await command(api, { type: "lifecycle", reviewId, state: "trash" });
    await stream.until((line) => !!entry(line, `${title}, renamed`)?.trashedAt);

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

  const desktop = await startGateway(root, [
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-b", endpoint: b.endpoint },
  ]);

  const onLocal = await seed(desktop.api, root, "On this machine");

  await expect
    .poll(() => desktop.gateway.hosts().map((host) => host.state))
    .toEqual(["online", "online"]);

  const stream = follow(desktop.url, [
    { reviewId: onLocal },
    { reviewId: onA },
    { reviewId: onB },
  ]);

  await vi.waitFor(() =>
    expect(
      stream.lines.map((line) => line.kind === "review" && line.reviewId),
    ).toEqual(expect.arrayContaining([onLocal, onA, onB])),
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(
    stream.lines.map((line) => line.kind === "review" && line.reviewId),
  ).toHaveLength(3);
  stream.lines.splice(0);

  const machines = { [onLocal]: desktop.api, [onA]: a.api, [onB]: b.api };
  const order = [onA, onLocal, onB, onB, onA, onLocal, onA];

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

it("passes this machine's list and stream through as they are while no host is set, then ends the stream when one is", async () => {
  const desktop = await startGateway(root, []);
  const a = await startRemote(path.join(root, "a"));
  await seed(a.api, root, "On a");

  const watch = `/reviews-api/watch?subscriptions=${encodeURIComponent(
    JSON.stringify([{ reviewId: null, mode: "structural" }]),
  )}`;

  const firstLine = async (response: Response) => {
    const reader = response.body!.getReader();
    stops.push(() => void reader.cancel().catch(() => undefined));
    let text = "";

    while (!text.includes("\n"))
      text += Buffer.from((await reader.read()).value!).toString();

    return { line: text.slice(0, text.indexOf("\n")), reader };
  };

  const through = await firstLine(
    await fetch(`${desktop.url}${watch}`, {
      headers: { "x-review-token": "local-token" },
    }),
  );

  expect(through.line).toBe(
    (await firstLine(await desktop.direct(watch))).line,
  );
  expect(await (await desktop.request("")).text()).toBe(
    await (await desktop.direct("/reviews-api")).text(),
  );

  desktop.gateway.setHosts([{ alias: "wb-a", endpoint: a.endpoint }]);

  for (;;) if ((await through.reader.read()).done) break;

  const merged = follow(desktop.url, [{ reviewId: null }]);
  await merged.until((line) => entry(line, "On a")?.host === "wb-a");
});

it("forwards a remote's review line byte for byte", async () => {
  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a.api, root, "On a");

  const desktop = await startGateway(root, [
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  await expect.poll(() => desktop.gateway.hosts()[0]?.state).toBe("online");

  const direct = await rawLines(a.endpoint.url, a.endpoint.token, onA);
  const through = await rawLines(desktop.url, "local-token", onA);
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

  const desktop = await startGateway(root, [
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-b", endpoint: b.endpoint },
  ]);

  const onLocal = await seed(desktop.api, root, "On this machine");

  await expect
    .poll(() => desktop.gateway.hosts().map((host) => host.state))
    .toEqual(["online", "online"]);

  const stream = follow(desktop.url, [
    { reviewId: null },
    { reviewId: onLocal },
    { reviewId: onA },
    { reviewId: onB },
  ]);

  await stream.until((line) => entry(line, "On b")?.hostState === "online");
  await vi.waitFor(() =>
    expect(stream.lines.some((line) => !!valueOf(line, onB))).toBe(true),
  );

  await b.stop();

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
  await step(desktop.api, onLocal, "Local while b is down");
  await stream.until((line) => focusOf(line) === "Local while b is down");

  const again = await startRemote(path.join(root, "b"));
  expect(again.endpoint.url).not.toBe(b.endpoint.url);

  desktop.gateway.setHosts([
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

  const hung = await startFake({ version, handle: () => true });

  const second = await startGateway(root, [
    hosts[0]!,
    { alias: "wb-b", endpoint: hung.endpoint },
  ]);

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

it("keeps this machine's and other hosts' lines coming while a host hangs", async () => {
  const hungId = randomUUID();

  const hung = await startFake({
    version,
    reviewIds: [hungId],
    handle: (request) =>
      request.url?.includes(hungId) || request.url === "/control",
  });

  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a.api, root, "On a");

  const desktop = await startGateway(root, [
    { alias: "wb-h", endpoint: hung.endpoint },
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  const onLocal = await seed(desktop.api, root, "On this machine");

  await expect
    .poll(() => desktop.gateway.hosts().map((host) => host.state))
    .toEqual(["online", "online"]);

  const stream = follow(desktop.url, [
    { reviewId: null },
    { reviewId: hungId },
    { reviewId: onLocal },
    { reviewId: onA },
  ]);

  await vi.waitFor(
    () => {
      expect(stream.lines.some((line) => !!entry(line, "On a"))).toBe(true);
      expect(stream.lines.some((line) => !!valueOf(line, onLocal))).toBe(true);
      expect(stream.lines.some((line) => !!valueOf(line, onA))).toBe(true);
      expect(stream.all.some((line) => !!errorOf(line, hungId))).toBe(false);
    },
    { timeout: 3_000 },
  );

  const error = errorOf(
    await stream.until((line) => !!errorOf(line, hungId), 12_000),
    hungId,
  );

  expect(error).toContain("wb-h is offline");
}, 20_000);

it("gives a reader that stops reading the latest state once, not a backlog", async () => {
  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a.api, root, "On a");

  await command(a.api, {
    type: "edit",
    reviewId: onA,
    edit: {
      type: "insert",
      content: { type: "markdown", markdown: "x".repeat(900 * 1024) },
    },
  });

  const desktop = await startGateway(root, [
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  await expect.poll(() => desktop.gateway.hosts()[0]?.state).toBe("online");

  const response = await new Promise<IncomingMessage>((resolve, reject) =>
    get(
      `${desktop.url}/reviews-api/watch?subscriptions=${encodeURIComponent(
        JSON.stringify([{ reviewId: onA }]),
      )}`,
      { headers: { "x-review-token": "local-token" } },
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

  await vi.waitFor(() => expect(lines).toHaveLength(1), { timeout: 30_000 });
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
}, 60_000);

it("sends nothing for a review whose host is still connecting, then its value", async () => {
  const serverId = randomUUID();
  const reviewId = randomUUID();
  const home = path.join(root, "local");

  await mkdir(home, { recursive: true });
  await writeFile(
    gatewayMemoryPath(home),
    JSON.stringify({
      [serverId]: {
        alias: "wb-b",
        lastList: { structural: [summary(reviewId, "On b")] },
      },
    }),
  );

  const value = { reviewId, title: "On b", activity: {}, coverageRevision: 0 };

  const b = await startFake({
    version,
    serverId,
    reviewIds: [reviewId],
    handle(request, response) {
      if (request.url === "/health") {
        setTimeout(
          () =>
            response.writeHead(200, { "content-type": "application/json" }).end(
              JSON.stringify({
                ok: true,
                serverId,
                instanceId: "b",
                serverPid: 1,
                desktopAttached: false,
                version,
                commit: null,
              }),
            ),
          1_500,
        );

        return true;
      }

      if (
        !request.url?.includes(reviewId) ||
        !request.url.startsWith("/reviews-api/watch")
      )
        return false;
      response.setHeader("content-type", "application/x-ndjson");
      response.write(
        `${JSON.stringify({ kind: "review", reviewId, value })}\n`,
      );

      return true;
    },
  });

  const desktop = await startGateway(root, [
    { alias: "wb-b", endpoint: b.endpoint },
  ]);

  expect(desktop.gateway.hosts()[0]?.state).toBe("connecting");
  const stream = follow(desktop.url, [{ reviewId }]);

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  expect(stream.all).toEqual([]);

  const line = await stream.until((next) => !!valueOf(next, reviewId));
  expect(valueOf(line, reviewId)).toMatchObject({ title: "On b" });
  expect(stream.all.filter((next) => !!errorOf(next, reviewId))).toEqual([]);
});

it("finds a host that stops answering while its streams are open, and ends them", async () => {
  const reviewId = randomUUID();
  let hang = false;

  const hung = await startFake({
    version,
    reviewIds: [reviewId],
    handle(request, response) {
      if (request.url?.startsWith(`/reviews-api/${reviewId}/structural-diff`)) {
        response.writeHead(200, { "content-type": "application/x-ndjson" });
        response.write('{"type":"file"}\n');

        return true;
      }

      if (hang) return true;

      if (!request.url?.startsWith("/reviews-api/watch")) return false;
      response.setHeader("content-type", "application/x-ndjson");
      response.write(
        `${JSON.stringify({ kind: "list", mode: "structural", reviews: [summary(reviewId, "Hung")] })}\n`,
      );

      return true;
    },
  });

  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a.api, root, "On a");

  const desktop = await startGateway(
    root,
    [
      { alias: "wb-h", endpoint: hung.endpoint },
      { alias: "wb-a", endpoint: a.endpoint },
    ],
    { heartbeatMs: 1_000 },
  );

  const onLocal = await seed(desktop.api, root, "On this machine");

  await expect
    .poll(() => desktop.gateway.hosts().map((host) => host.state))
    .toEqual(["online", "online"]);
  await vi.waitFor(() =>
    expect(
      hung.requests.some((request) =>
        request.url?.startsWith("/reviews-api/watch"),
      ),
    ).toBe(true),
  );

  const forwarded = await desktop.request(`/${reviewId}/structural-diff`);
  expect(forwarded.status).toBe(200);
  const read = forwarded.text();

  hang = true;

  await expect(read).rejects.toThrow("terminated");
  await vi.waitFor(
    () => expect(desktop.gateway.hosts()[0]?.state).toBe("offline"),
    { timeout: 5_000 },
  );

  expect((await desktop.request(`/${onA}`)).status).toBe(200);
  expect((await desktop.request(`/${onLocal}`)).status).toBe(200);
}, 20_000);

it("closes a client's streams to remotes when the client leaves", async () => {
  const reviewId = randomUUID();
  const closed = Promise.withResolvers<void>();
  let opened = false;

  const fake = await startFake({
    version,
    reviewIds: [reviewId],
    handle(request, response) {
      if (
        !request.url?.startsWith("/reviews-api/watch") ||
        !request.url.includes(reviewId)
      )
        return false;
      opened = true;
      response.setHeader("content-type", "application/x-ndjson");
      response.write(
        `${JSON.stringify({ kind: "review", reviewId, value: { reviewId } })}\n`,
      );
      response.on("close", () => closed.resolve());

      return true;
    },
  });

  const desktop = await startGateway(root, [
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => desktop.gateway.hosts()[0]?.state).toBe("online");
  const abort = new AbortController();

  const response = await fetch(
    `${desktop.url}/reviews-api/watch?subscriptions=${encodeURIComponent(
      JSON.stringify([{ reviewId }]),
    )}`,
    { headers: { "x-review-token": "local-token" }, signal: abort.signal },
  );

  const reader = response.body!.getReader();
  await reader.read();
  expect(opened).toBe(true);

  abort.abort();
  await closed.promise;
});
