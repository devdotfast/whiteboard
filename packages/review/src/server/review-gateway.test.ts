import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type JsonObject,
  REVIEW_HOST_HEADER,
  ReviewApiClient,
  type ReviewGatewayHost,
} from "@dev.fast/review-protocol";
import {
  findReviewPackageRoot,
  readReviewPackageVersion,
} from "@review/package-paths.js";
import { openReviewProfile } from "@review/review-api/profile.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createGlobalReviewServer } from "./desktop-server.js";
import { gatewayMemoryPath } from "./review-gateway-memory.js";
import {
  repository as createRepository,
  seed as seedReview,
  startFake,
  startGateway as startLocalGateway,
  startRemote,
  stopAll,
  summary,
} from "./review-gateway-test-utils.js";

const version = readReviewPackageVersion(import.meta.url);

const LOCAL_TOKEN = "local-token";

let root: string;

const cleanups: (() => Promise<void>)[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "review-gateway-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  vi.stubEnv("DEV_FAST_REVIEW_TELEMETRY_DISABLED", "1");
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse())
    await cleanup().catch(() => undefined);
  await stopAll();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const startGateway = (hosts: ReviewGatewayHost[], gatewayVersion = version) =>
  startLocalGateway(root, hosts, { version: gatewayVersion });

const repository = () => createRepository(root);

type Remote = Awaited<ReturnType<typeof startRemote>>;

const seed = (remote: Remote, title: string) =>
  seedReview(remote.api, root, title);

const command = (operation: JsonObject) => JSON.stringify({ operation });

it("sends a read, a command and a file request to the machine that owns the review", async () => {
  const a = await startRemote(path.join(root, "a"));
  const b = await startRemote(path.join(root, "b"));
  const onA = await seed(a, "On a");
  const onB = await seed(b, "On b");

  const { request, gateway, local } = await startGateway([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-b", endpoint: b.endpoint },
  ]);

  await expect
    .poll(() => gateway.hosts().map((host) => host.state))
    .toEqual(["online", "online"]);

  const readA = await request(`/${onA}?full=true`);
  expect(readA.status).toBe(200);
  expect(readA.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
  expect(await readA.json()).toMatchObject({ reviewId: onA, title: "On a" });

  const readB = await request(`/${onB}?full=true`);
  expect(readB.headers.get(REVIEW_HOST_HEADER)).toBe("wb-b");
  expect(await readB.json()).toMatchObject({ title: "On b" });

  const renamed = await request("/commands", {
    method: "POST",
    body: command({ type: "rename", reviewId: onA, title: "Renamed on a" }),
  });

  expect(renamed.status).toBe(200);
  expect(renamed.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
  expect(await a.api(`/${onA}?full=true`)).toMatchObject({
    title: "Renamed on a",
  });

  const file = await request(`/${onB}/file?side=head&file=example.ts`);
  expect(file.status).toBe(200);
  expect(file.headers.get(REVIEW_HOST_HEADER)).toBe("wb-b");
  const body = await file.json();
  expect(body).toMatchObject({ text: "export const a = 2;\n" });
  expect(body).not.toHaveProperty("localPath");

  const repo = await repository();

  const registered = await request("/repositories", {
    method: "POST",
    body: JSON.stringify({ path: repo.directory }),
  });

  expect(registered.headers.has(REVIEW_HOST_HEADER)).toBe(false);
  const { id: repositoryId } = await registered.json();

  const created = await request("/commands", {
    method: "POST",
    body: command({
      type: "create",
      title: "On this machine",
      target: {
        kind: "commits",
        repositoryId,
        base: repo.base,
        head: repo.head,
      },
    }),
  });

  expect(created.status).toBe(200);
  expect(created.headers.has(REVIEW_HOST_HEADER)).toBe(false);
  const { reviewId: onLocal } = await created.json();
  expect(local.store.summary(onLocal)?.title).toBe("On this machine");

  const readLocal = await request(`/${onLocal}`);
  expect(readLocal.status).toBe(200);
  expect(readLocal.headers.has(REVIEW_HOST_HEADER)).toBe(false);

  const missing = await request(`/${randomUUID()}`);
  expect(missing.status).toBe(404);
  expect(missing.headers.has(REVIEW_HOST_HEADER)).toBe(false);
});

it("replaces this machine's token with the remote's, drops its credentials and marks the caller remote", async () => {
  const reviewId = randomUUID();
  const fake = await startFake({ version, reviewIds: [reviewId] });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const response = await request(`/${reviewId}/progress?token=${LOCAL_TOKEN}`, {
    headers: {
      "x-review-client": "local",
      cookie: "local=1",
      authorization: "Bearer local",
    },
  });

  expect(response.status).toBe(200);

  const forwarded = fake.requests.filter((entry) =>
    entry.url?.startsWith(`/reviews-api/${reviewId}/progress`),
  );

  expect(forwarded).toHaveLength(1);
  const [seen] = forwarded;
  expect(seen?.url).toBe(`/reviews-api/${reviewId}/progress`);
  expect(seen?.headers["x-review-token"]).toBe(fake.endpoint.token);
  expect(seen?.headers["x-review-client"]).toBe("remote");
  expect(JSON.stringify(seen?.headers)).not.toContain(LOCAL_TOKEN);
  expect(seen?.headers.cookie).toBeUndefined();
  expect(seen?.headers.authorization).toBeUndefined();
});

it("answers per-review telemetry for a remote review itself and refuses local-only routes", async () => {
  const reviewId = randomUUID();
  const fake = await startFake({ version, reviewIds: [reviewId] });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const telemetry = await request(`/${reviewId}/telemetry/event`, {
    method: "POST",
    body: "{}",
  });

  expect(telemetry.status).toBe(200);
  expect(telemetry.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");

  for (const [method, route] of [
    ["POST", "open"],
    ["GET", "agent-traces"],
    ["GET", "workspaces"],
    ["POST", "environment"],
  ] as const) {
    const refused = await request(`/${reviewId}/${route}`, {
      method,
      ...(method === "POST" && { body: "{}" }),
    });

    expect(refused.status).toBe(404);
    expect(await refused.json()).toMatchObject({
      error: expect.stringContaining(
        "not available for a review on another machine",
      ),
    });
  }

  expect(
    fake.requests.filter((entry) =>
      entry.url?.startsWith(`/reviews-api/${reviewId}/`),
    ),
  ).toEqual([]);
});

it("gives a remote review's language context with its path on that machine and its server id", async () => {
  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a, "On a");

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const read = async () => {
    const response = await request(`/${onA}/language-context?side=head`);
    expect(response.status).toBe(200);
    expect(response.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");

    return response.json();
  };

  await expect
    .poll(async () => (await read()).remoteRootPath, { timeout: 20_000 })
    .toEqual(expect.any(String));

  const context = await read();
  expect(context).toEqual({
    remoteRootPath: expect.any(String),
    identity: expect.any(String),
    serverId: (await a.health()).serverId,
  });
  expect(
    await readFile(path.join(context.remoteRootPath, "example.ts"), "utf8"),
  ).toBe("export const a = 2;\n");
});

it("waits past the 10 s limit for a slow language context and keeps the host online when it never answers", async () => {
  const slow = randomUUID();
  const hung = randomUUID();
  const serverId = randomUUID();

  const fake = await startFake({
    version,
    serverId,
    reviewIds: [slow, hung],
    handle(request, response) {
      if (request.url?.startsWith(`/reviews-api/${hung}/language-context`))
        return true;

      if (!request.url?.startsWith(`/reviews-api/${slow}/language-context`))
        return false;

      setTimeout(() => {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            remoteRootPath: "/home/dev/repo",
            identity: "a",
            serverId,
          }),
        );
      }, 11_000);

      return true;
    },
  });

  const { request, gateway } = await startLocalGateway(
    root,
    [{ alias: "wb-a", endpoint: fake.endpoint }],
    { slowRouteMs: 14_000 },
  );

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const [answered, unanswered] = await Promise.all([
    request(`/${slow}/language-context`),
    request(`/${hung}/language-context`),
  ]);

  expect(answered.status).toBe(200);
  expect(await answered.json()).toMatchObject({
    remoteRootPath: "/home/dev/repo",
  });
  expect(unanswered.status).toBe(504);
  expect(unanswered.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
  expect(gateway.hosts()[0]?.state).toBe("online");
  expect((await request(`/${slow}/progress`)).status).toBe(200);
}, 30_000);

it("streams a remote answer line by line and closes the remote connection when the client leaves", async () => {
  const reviewId = randomUUID();
  const next = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();

  const fake = await startFake({
    version,
    reviewIds: [reviewId],
    handle(request, response) {
      if (!request.url?.startsWith(`/reviews-api/${reviewId}/structural-diff`))
        return false;
      response.setHeader("content-type", "application/x-ndjson");
      response.write('{"line":1}\n');
      void next.promise.then(() => response.write('{"line":2}\n'));
      response.on("close", () => closed.resolve());

      return true;
    },
  });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const abort = new AbortController();

  const response = await request(`/${reviewId}/structural-diff`, {
    signal: abort.signal,
  });

  const reader = response
    .body!.pipeThrough(new TextDecoderStream())
    .getReader();

  expect((await reader.read()).value).toBe('{"line":1}\n');
  next.resolve();
  expect((await reader.read()).value).toBe('{"line":2}\n');

  abort.abort();
  await closed.promise;
});

it("answers 503 naming the version to install for a review on another version, also from its memory file", async () => {
  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a, "On a");

  const first = await startGateway([{ alias: "wb-a", endpoint: a.endpoint }]);
  await expect.poll(() => first.gateway.hosts()[0]?.state).toBe("online");
  expect((await first.request(`/${onA}`)).status).toBe(200);
  await first.close();

  const second = await startGateway(
    [{ alias: "wb-a", endpoint: a.endpoint }],
    "0.0.0-other",
  );

  await expect
    .poll(() => second.gateway.hosts()[0]?.state)
    .toBe("incompatible");

  const response = await second.request(`/${onA}`);
  expect(response.status).toBe(503);
  expect(response.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
  expect(await response.json()).toMatchObject({
    error: expect.stringContaining("Install Whiteboard 0.0.0-other on wb-a."),
  });
});

it("marks a host that stops answering offline while others answer", async () => {
  const hung = randomUUID();
  let hang = false;

  const fake = await startFake({
    version,
    reviewIds: [hung],
    handle: () => hang,
  });

  const b = await startRemote(path.join(root, "b"));
  const onB = await seed(b, "On b");

  const { request, gateway, local } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
    { alias: "wb-b", endpoint: b.endpoint },
  ]);

  await expect
    .poll(() => gateway.hosts().map((host) => host.state))
    .toEqual(["online", "online"]);
  expect((await request(`/${hung}/progress`)).status).toBe(200);
  const repo = await repository();

  const { id: repositoryId } = await (
    await request("/repositories", {
      method: "POST",
      body: JSON.stringify({ path: repo.directory }),
    })
  ).json();

  const onLocal = await local.store.execute({
    operation: {
      type: "create",
      title: "On this machine",
      target: {
        kind: "commits",
        repositoryId,
        base: repo.base,
        head: repo.head,
      },
    },
  });

  const progressAsks = () =>
    fake.requests.filter((entry) => entry.url?.includes(`${hung}/progress`))
      .length;

  hang = true;
  const stuck = request(`/${hung}/progress`);
  let answered = false;
  void stuck.then(() => (answered = true));

  await vi.waitFor(() => expect(progressAsks()).toBe(2));
  expect((await request(`/${onLocal.reviewId}`)).status).toBe(200);
  expect((await request(`/${onB}`)).status).toBe(200);
  expect(answered).toBe(false);

  expect((await stuck).status).toBe(504);
  expect(gateway.hosts()[0]?.state).toBe("offline");

  const refused = await request(`/${hung}/progress`);
  expect(refused.status).toBe(503);
}, 20_000);

it("mounts the gateway in the Desktop server, with host states behind the token", async () => {
  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a, "On a");

  const local = await openReviewProfile(path.join(root, "local"), {
    manageWorkspaces: true,
  });

  const packageRoot = findReviewPackageRoot(import.meta.url);

  const desktop = createGlobalReviewServer({
    reviewStore: local.store,
    reviewData: local.data,
    appPid: process.pid,
    packageRoot,
    toolingRoot: packageRoot,
    port: 0,
    token: LOCAL_TOKEN,
    discoveryPath: path.join(root, "desktop.json"),
  });

  cleanups.push(async () => {
    await desktop.close();
    await local.data.close();
    await local.store.close();
  });
  await desktop.listen();

  const get = (route: string, headers: Record<string, string> = {}) =>
    fetch(`${desktop.url}${route}`, {
      headers: { "x-review-token": LOCAL_TOKEN, ...headers },
    });

  expect((await fetch(`${desktop.url}/remote-hosts`)).status).toBe(401);
  expect(await (await get("/remote-hosts")).json()).toEqual([]);

  desktop.setRemoteHosts([{ alias: "wb-a", endpoint: a.endpoint }]);
  await expect
    .poll(async () => (await get("/remote-hosts")).json())
    .toEqual([
      { alias: "wb-a", serverId: (await a.health()).serverId, state: "online" },
    ]);

  const read = await get(`/reviews-api/${onA}?full=true`, {
    origin: "vscode-file://vscode-app",
  });

  expect(read.status).toBe(200);
  expect(read.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
  expect(read.headers.get("access-control-expose-headers")).toContain(
    REVIEW_HOST_HEADER,
  );
  expect(await read.json()).toMatchObject({ title: "On a" });

  const unknown = await get("/reviews-api/status/unknown");
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({ ok: false, error: "Not found." });
});

it("keeps routing a review its host trashed, and stops once the host's list drops it", async () => {
  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a, "On a");

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  const memoryFile = gatewayMemoryPath(path.join(root, "local"));

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");
  await expect.poll(() => readFile(memoryFile, "utf8")).toContain(onA);

  await a.api("/commands", {
    method: "POST",
    body: command({ type: "lifecycle", reviewId: onA, state: "trash" }),
  });

  const trashed = await request(`/${onA}?full=true`);
  expect(trashed.status).toBe(200);
  expect(trashed.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");

  await a.api("/commands", {
    method: "POST",
    body: command({ type: "delete", reviewId: onA }),
  });
  await expect.poll(() => readFile(memoryFile, "utf8")).not.toContain(onA);

  const gone = await request(`/${onA}?full=true`);
  expect(gone.status).toBe(404);
  expect(gone.headers.has(REVIEW_HOST_HEADER)).toBe(false);
});

it("gives an id two hosts list to the first in the setting's order, in the list and in routing", async () => {
  const reviewId = randomUUID();
  const a = await startFake({ version, reviewIds: [reviewId] });
  const b = await startFake({ version, reviewIds: [reviewId] });

  const desktop = await startGateway([
    { alias: "wb-b", endpoint: b.endpoint },
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  const hosts = async () => ({
    listed: (await desktop.api<{ reviewId: string; host?: string }[]>(""))
      .filter((entry) => entry.reviewId === reviewId)
      .map((entry) => entry.host),
    routed: (await desktop.request(`/${reviewId}/progress`)).headers.get(
      REVIEW_HOST_HEADER,
    ),
  });

  await expect.poll(hosts).toEqual({ listed: ["wb-b"], routed: "wb-b" });

  desktop.gateway.setHosts([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-b", endpoint: b.endpoint },
  ]);

  await expect.poll(hosts).toEqual({ listed: ["wb-a"], routed: "wb-a" });
});

it("routes a review a host just created once its list line arrives, and an unknown id here after a short wait", async () => {
  const reviewId = randomUUID();
  const feeds: ServerResponse[] = [];

  const fake = await startFake({
    version,
    reviewIds: [reviewId],
    handle(request, response) {
      if (!request.url?.startsWith("/reviews-api/watch")) return false;
      response.setHeader("content-type", "application/x-ndjson");

      if (request.url.includes(reviewId))
        response.write(
          `${JSON.stringify({ kind: "review", reviewId, value: { reviewId } })}\n`,
        );
      else {
        response.write('{"kind":"list","mode":"structural","reviews":[]}\n');
        feeds.push(response);
      }

      return true;
    },
  });

  const desktop = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => feeds.length).toBe(1);

  const watched = (async () => {
    for await (const line of new ReviewApiClient({
      serverUrl: desktop.url,
      token: LOCAL_TOKEN,
    }).watch([{ reviewId, mode: "structural" }], AbortSignal.timeout(5_000)))
      if (line.kind === "review" && "value" in line) return line.value;

    return undefined;
  })();

  const started = Date.now();
  const read = desktop.request(`/${reviewId}/progress`);

  await new Promise((resolve) => setTimeout(resolve, 300));
  feeds[0]!.write(
    `${JSON.stringify({ kind: "list", mode: "structural", reviews: [summary(reviewId, "New")] })}\n`,
  );

  const routed = await read;
  expect(routed.status).toBe(200);
  expect(routed.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
  expect(Date.now() - started).toBeLessThan(1_000);

  expect(await watched).toEqual({ reviewId });

  const waited = Date.now();
  const unknown = await desktop.request(`/${randomUUID()}`);
  expect(unknown.status).toBe(404);
  expect(unknown.headers.has(REVIEW_HOST_HEADER)).toBe(false);
  expect(Date.now() - waited).toBeGreaterThanOrEqual(1_900);
  expect(Date.now() - waited).toBeLessThan(3_000);
});

it("answers 503 with an offline host's reason for a review on its last list, after a restart", async () => {
  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a, "On a");

  const first = await startGateway([{ alias: "wb-a", endpoint: a.endpoint }]);
  await expect
    .poll(async () => (await first.request(`/${onA}`)).status)
    .toBe(200);
  await first.close();
  await a.stop();

  const second = await startGateway([{ alias: "wb-a", endpoint: a.endpoint }]);
  await expect.poll(() => second.gateway.hosts()[0]?.state).toBe("offline");

  const response = await second.request(`/${onA}`);
  expect(response.status).toBe(503);
  expect(response.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
  expect(await response.json()).toEqual({
    ok: false,
    error: "wb-a is offline: it refused the connection.",
  });
});
