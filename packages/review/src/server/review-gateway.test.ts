import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type JsonObject,
  REVIEW_HOST_HEADER,
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
  type FakeHandler,
  repository as createRepository,
  seed as seedReview,
  startFake,
  startGateway as startLaptopGateway,
  startRemote,
  stopAll,
} from "./review-gateway-test-utils.js";

const version = readReviewPackageVersion(import.meta.url);

const LAPTOP_TOKEN = "laptop-token";

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
  startLaptopGateway(root, hosts, { version: gatewayVersion });

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
      title: "On the laptop",
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
  const { reviewId: onLaptop } = await created.json();
  expect(local.store.summary(onLaptop)?.title).toBe("On the laptop");

  const readLaptop = await request(`/${onLaptop}`);
  expect(readLaptop.status).toBe(200);
  expect(readLaptop.headers.has(REVIEW_HOST_HEADER)).toBe(false);

  const missing = await request(`/${randomUUID()}`);
  expect(missing.status).toBe(404);
  expect(missing.headers.has(REVIEW_HOST_HEADER)).toBe(false);
});

it("replaces the laptop's token with the remote's and marks the caller remote", async () => {
  const reviewId = randomUUID();
  const fake = await startFake({ version, reviewIds: [reviewId] });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const response = await request(
    `/${reviewId}/progress?token=${LAPTOP_TOKEN}`,
    {
      headers: { "x-review-client": "local" },
    },
  );

  expect(response.status).toBe(200);

  const forwarded = fake.requests.filter((entry) =>
    entry.url?.startsWith(`/reviews-api/${reviewId}/progress`),
  );

  expect(forwarded).toHaveLength(1);
  const [seen] = forwarded;
  expect(seen?.url).toBe(`/reviews-api/${reviewId}/progress`);
  expect(seen?.headers["x-review-token"]).toBe(fake.endpoint.token);
  expect(seen?.headers["x-review-client"]).toBe("remote");
  expect(JSON.stringify(seen?.headers)).not.toContain(LAPTOP_TOKEN);
});

it("answers per-review telemetry for a remote review itself and refuses laptop-only routes", async () => {
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
    fake.requests.filter(
      (entry) =>
        entry.url?.startsWith(`/reviews-api/${reviewId}/`) &&
        !entry.url.endsWith("/activity"),
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
    identity: expect.stringMatching(/^[0-9a-f]{64}$/),
    serverId: (await a.health()).serverId,
  });
  expect(
    await readFile(path.join(context.remoteRootPath, "example.ts"), "utf8"),
  ).toBe("export const a = 2;\n");
});

it.each([
  ["a remoteRootPath that is not a string", { remoteRootPath: 7 }],
  ["another server's id", { serverId: "another-server" }],
])("refuses a remote language context with %s", async (_, change) => {
  const reviewId = randomUUID();
  const serverId = randomUUID();

  const fake = await startFake({
    version,
    serverId,
    reviewIds: [reviewId],
    handle(request, response) {
      if (!request.url?.startsWith(`/reviews-api/${reviewId}/language-context`))
        return false;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          remoteRootPath: "/home/dev/repo",
          identity: "a".repeat(64),
          serverId,
          ...change,
        }),
      );

      return true;
    },
  });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const response = await request(`/${reviewId}/language-context`);
  expect(response.status).toBe(502);
  expect(response.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
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

  const { request, gateway } = await startLaptopGateway(
    root,
    [{ alias: "wb-a", endpoint: fake.endpoint }],
    { languageContextMs: 14_000 },
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

it.each([
  ["file", "GET", "localPath"],
  ["file", "GET", "localRoot"],
  ["navigator", "POST", "workspacePath"],
  ["navigator", "POST", "filePath"],
  ["language-context", "GET", "rootPath"],
  ["ask/agents", "GET", "localPath"],
  ["ask/agents/codex/offer", "GET", "localPath"],
  ["ask/mentions", "GET", "localPath"],
  ["ask/threads", "GET", "localPath"],
])(
  "refuses a remote %s answer that carries %s",
  async (route, method, field) => {
    const reviewId = randomUUID();
    const leaked = "/home/dev/secret/project";

    const fake = await startFake({
      version,
      reviewIds: [reviewId],
      handle(request, response) {
        if (!request.url?.startsWith(`/reviews-api/${reviewId}/${route}`))
          return false;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({ nested: { [field]: leaked }, text: "x" }),
        );

        return true;
      },
    });

    const { request, gateway, logged } = await startGateway([
      { alias: "wb-a", endpoint: fake.endpoint },
    ]);

    await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

    const response = await request(`/${reviewId}/${route}`, {
      method,
      ...(method === "POST" && { body: "{}" }),
    });

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(leaked);
    expect(logged.join("\n")).toContain(field);
  },
);

it("reaches the laptop for the scratchpad and shared reviews, even when a remote has one", async () => {
  const fake = await startFake({
    version,
    reviewIds: ["scratchpad", `shared-${"a".repeat(64)}`],
  });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const pad = await request("/scratchpad?full=true");
  expect(pad.status).toBe(200);
  expect(pad.headers.has(REVIEW_HOST_HEADER)).toBe(false);
  expect(await pad.json()).toMatchObject({ reviewId: "scratchpad" });

  const shared = await request(`/shared-${"a".repeat(64)}`);
  expect(shared.headers.has(REVIEW_HOST_HEADER)).toBe(false);

  expect(
    fake.requests.filter((entry) => /scratchpad|shared-/.test(entry.url ?? "")),
  ).toEqual([]);
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

it("marks a host that stops answering offline within 11 s while others answer", async () => {
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

  const onLaptop = await local.store.execute({
    operation: {
      type: "create",
      title: "On the laptop",
      target: {
        kind: "commits",
        repositoryId,
        base: repo.base,
        head: repo.head,
      },
    },
  });

  hang = true;
  const started = Date.now();
  const stuck = request(`/${hung}/progress`);

  await new Promise((resolve) => setTimeout(resolve, 500));
  const quick = Date.now();
  expect((await request(`/${onLaptop.reviewId}`)).status).toBe(200);
  expect((await request(`/${onB}`)).status).toBe(200);
  expect(Date.now() - quick).toBeLessThan(3_000);

  expect((await stuck).status).toBe(504);
  expect(gateway.hosts()[0]?.state).toBe("offline");
  expect(Date.now() - started).toBeLessThan(11_000);

  const refused = await request(`/${hung}/progress`);
  expect(refused.status).toBe(503);
}, 20_000);

it("mounts the gateway in the Desktop server, with host states behind the token", async () => {
  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a, "On a");

  const local = await openReviewProfile(path.join(root, "laptop"), {
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
    token: LAPTOP_TOKEN,
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
      headers: { "x-review-token": LAPTOP_TOKEN, ...headers },
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

it("never serves a review from a copied store while its machine is down", async () => {
  const first = await startRemote(path.join(root, "a"));
  const onA = await seed(first, "On a");
  await first.stop();
  await cp(path.join(root, "a"), path.join(root, "c"), { recursive: true });
  const a = await startRemote(path.join(root, "a"));
  const c = await startRemote(path.join(root, "c"));

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-c", endpoint: c.endpoint },
  ]);

  await expect
    .poll(() => gateway.hosts().map((host) => host.state))
    .toEqual(["online", "duplicate"]);
  expect(
    (await request(`/${onA}?full=true`)).headers.get(REVIEW_HOST_HEADER),
  ).toBe("wb-a");

  await a.stop();
  const statuses: number[] = [];

  await expect
    .poll(async () => {
      const { status } = await request(`/${onA}?full=true`);
      statuses.push(status);

      return status;
    })
    .toBe(503);
  expect(statuses.every((status) => status === 502 || status === 503)).toBe(
    true,
  );

  const refused = await request(`/${onA}?full=true`);
  expect(refused.status).toBe(503);
  expect(refused.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
  expect(await refused.json()).toMatchObject({
    error: expect.stringContaining("wb-a is offline"),
  });
  expect(gateway.hosts().map((host) => host.state)).toEqual([
    "offline",
    "duplicate",
  ]);
});

it("refuses a redirect from a remote and drops its cookies", async () => {
  const reviewId = randomUUID();

  const fake = await startFake({
    version,
    reviewIds: [reviewId],
    handle(request, response) {
      if (request.url?.startsWith(`/reviews-api/${reviewId}/progress`)) {
        response.writeHead(302, { location: "/remote-hosts" }).end();

        return true;
      }

      if (request.url?.startsWith(`/reviews-api/${reviewId}/commits`)) {
        response
          .writeHead(200, {
            "content-type": "application/json",
            "set-cookie": ["a=1", "b=2"],
          })
          .end("[]");

        return true;
      }

      return false;
    },
  });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const redirected = await request(`/${reviewId}/progress`, {
    redirect: "manual",
  });

  expect(redirected.status).toBe(502);
  expect(redirected.headers.has("location")).toBe(false);

  const commits = await request(`/${reviewId}/commits`);
  expect(commits.status).toBe(200);
  expect(commits.headers.has("set-cookie")).toBe(false);
});

it("forgets a review its owner no longer has", async () => {
  const a = await startRemote(path.join(root, "a"));
  const onA = await seed(a, "On a");

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  const memoryFile = gatewayMemoryPath(path.join(root, "laptop"));

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");
  expect((await request(`/${onA}?full=true`)).status).toBe(200);
  await expect.poll(() => readFile(memoryFile, "utf8")).toContain(onA);

  await a.api("/commands", {
    method: "POST",
    body: command({ type: "delete", reviewId: onA }),
  });

  const gone = await request(`/${onA}?full=true`);
  expect(gone.status).toBe(404);
  expect(gone.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
  await expect.poll(() => readFile(memoryFile, "utf8")).not.toContain(onA);
});

async function freePort() {
  const probe = await startFake({ version });

  await probe.stop();

  return probe.port;
}

async function rememberOwner(
  serverId: string,
  alias: string,
  reviewId: string,
) {
  const home = path.join(root, "laptop");

  await mkdir(home, { recursive: true });
  await writeFile(
    gatewayMemoryPath(home),
    JSON.stringify({ [serverId]: { alias, reviewIds: [reviewId] } }),
  );
}

const states = (gateway: { hosts(): { state: string }[] }) =>
  gateway.hosts().map((host) => host.state);

it.each([
  ["another instance: a is the machine, c the duplicate", false, "duplicate"],
  ["the same instance: one machine under two aliases", true, "online"],
])(
  "holds a copy as duplicate until the remembered alias reports (%s)",
  async (_name, sameInstance, cState) => {
    const serverId = randomUUID();
    const reviewId = randomUUID();
    await rememberOwner(serverId, "wb-a", reviewId);
    const port = await freePort();
    const c = await startFake({ version, serverId, reviewIds: [reviewId] });

    const { request, gateway } = await startGateway([
      {
        alias: "wb-a",
        endpoint: { url: `http://127.0.0.1:${port}`, token: "a" },
      },
      { alias: "wb-c", endpoint: c.endpoint },
    ]);

    await expect.poll(() => states(gateway)).toEqual(["offline", "duplicate"]);
    const detail = gateway.hosts()[1]?.detail;
    expect(detail).toContain("wb-a");
    expect(detail).toContain("wb-c");
    expect(detail).toContain("whiteboard server reset-id");
    expect(detail).toContain("wb-c is waiting for wb-a");

    const refused = await request(`/${reviewId}`);
    expect(refused.status).toBe(503);
    expect(refused.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
    expect(await refused.json()).toMatchObject({
      error: expect.stringContaining("wb-a is offline"),
    });
    expect(c.requests.some((entry) => entry.url?.includes(reviewId))).toBe(
      false,
    );

    await startFake(
      {
        version,
        serverId,
        token: "a",
        reviewIds: [reviewId],
        ...(sameInstance && { instanceId: c.health.instanceId }),
      },
      port,
    );

    await expect
      .poll(() => states(gateway), { timeout: 5_000 })
      .toEqual(["online", cState]);
    const served = await request(`/${reviewId}`);
    expect(served.status).toBe(200);
    expect(served.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
  },
);

it("takes a reporting alias as the machine when the remembered alias left the setting", async () => {
  const serverId = randomUUID();
  const reviewId = randomUUID();
  await rememberOwner(serverId, "wb-a", reviewId);
  const c = await startFake({ version, serverId, reviewIds: [reviewId] });

  const { request, gateway } = await startGateway([
    { alias: "wb-c", endpoint: c.endpoint },
  ]);

  await expect.poll(() => states(gateway)).toEqual(["online"]);
  const served = await request(`/${reviewId}`);
  expect(served.status).toBe(200);
  expect(served.headers.get(REVIEW_HOST_HEADER)).toBe("wb-c");
  await expect
    .poll(async () =>
      JSON.parse(
        await readFile(gatewayMemoryPath(path.join(root, "laptop")), "utf8"),
      ),
    )
    .toEqual({ [serverId]: { alias: "wb-c", reviewIds: [reviewId] } });
});

function slowHealth(
  delayMs: number | undefined,
  serverId: string,
  instanceId: string,
): FakeHandler {
  return (request, response) => {
    if (request.url !== "/health") return false;

    if (delayMs !== undefined)
      setTimeout(
        () =>
          response.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              ok: true,
              serverId,
              instanceId,
              serverPid: process.pid,
              desktopAttached: false,
              version,
              commit: null,
            }),
          ),
        delayMs,
      );

    return true;
  };
}

const memoryOf = async () =>
  JSON.parse(
    await readFile(gatewayMemoryPath(path.join(root, "laptop")), "utf8"),
  );

it("holds a later alias until an earlier one answers, then setting order decides", async () => {
  const serverId = randomUUID();
  const reviewId = randomUUID();

  const a = await startFake({
    version,
    serverId,
    reviewIds: [reviewId],
    handle: slowHealth(1_000, serverId, randomUUID()),
  });

  const c = await startFake({ version, serverId, reviewIds: [reviewId] });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-c", endpoint: c.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[1]?.serverId).toBe(serverId);
  expect(gateway.hosts()[1]).toMatchObject({
    state: "connecting",
    detail: expect.stringContaining("wb-a"),
  });

  await expect.poll(() => states(gateway)).toEqual(["online", "duplicate"]);
  const served = await request(`/${reviewId}`);
  expect(served.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
  await expect
    .poll(memoryOf)
    .toEqual({ [serverId]: { alias: "wb-a", reviewIds: [reviewId] } });
  expect(c.requests.map((entry) => entry.url)).toEqual(["/health"]);
});

it("takes a later alias as the machine once an earlier one fails its first check", async () => {
  const serverId = randomUUID();
  const reviewId = randomUUID();

  const a = await startFake({
    version,
    serverId,
    handle: slowHealth(undefined, serverId, randomUUID()),
  });

  const c = await startFake({ version, serverId, reviewIds: [reviewId] });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-c", endpoint: c.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[1]?.serverId).toBe(serverId);
  expect(states(gateway)).toEqual(["connecting", "connecting"]);
  await expect
    .poll(() => states(gateway), { timeout: 5_000 })
    .toEqual(["offline", "online"]);
  expect((await request(`/${reviewId}`)).headers.get(REVIEW_HOST_HEADER)).toBe(
    "wb-c",
  );
  await expect
    .poll(memoryOf)
    .toEqual({ [serverId]: { alias: "wb-c", reviewIds: [reviewId] } });
});

it("holds a second alias of the same machine until the first answers", async () => {
  const serverId = randomUUID();
  const instanceId = randomUUID();
  const reviewId = randomUUID();

  const a = await startFake({
    version,
    serverId,
    instanceId,
    reviewIds: [reviewId],
    handle: slowHealth(1_000, serverId, instanceId),
  });

  const b = await startFake({
    version,
    serverId,
    instanceId,
    reviewIds: [reviewId],
  });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-b", endpoint: b.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[1]?.serverId).toBe(serverId);
  expect(gateway.hosts()[1]?.state).toBe("connecting");
  await expect.poll(() => states(gateway)).toEqual(["online", "online"]);
  expect((await request(`/${reviewId}`)).headers.get(REVIEW_HOST_HEADER)).toBe(
    "wb-a",
  );
});

it("without memory, uses a later alias while an earlier one is down, then setting order", async () => {
  const serverId = randomUUID();
  const reviewId = randomUUID();
  const port = await freePort();
  const c = await startFake({ version, serverId, reviewIds: [reviewId] });

  const { request, gateway } = await startGateway([
    {
      alias: "wb-a",
      endpoint: { url: `http://127.0.0.1:${port}`, token: "a" },
    },
    { alias: "wb-c", endpoint: c.endpoint },
  ]);

  await expect.poll(() => states(gateway)).toEqual(["offline", "online"]);
  expect((await request(`/${reviewId}`)).headers.get(REVIEW_HOST_HEADER)).toBe(
    "wb-c",
  );
  await expect
    .poll(memoryOf)
    .toEqual({ [serverId]: { alias: "wb-c", reviewIds: [reviewId] } });

  await startFake(
    { version, serverId, token: "a", reviewIds: [reviewId] },
    port,
  );

  await expect
    .poll(() => states(gateway), { timeout: 5_000 })
    .toEqual(["online", "duplicate"]);
  await expect
    .poll(memoryOf)
    .toEqual({ [serverId]: { alias: "wb-a", reviewIds: [reviewId] } });
  expect((await request(`/${reviewId}`)).headers.get(REVIEW_HOST_HEADER)).toBe(
    "wb-a",
  );
});

it("does not hold the first alias behind a later remembered one", async () => {
  const serverId = randomUUID();
  const reviewId = randomUUID();
  await rememberOwner(serverId, "wb-c", reviewId);
  const a = await startFake({ version, serverId, reviewIds: [reviewId] });

  const c = await startFake({
    version,
    serverId,
    handle: slowHealth(1_000, serverId, randomUUID()),
  });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-c", endpoint: c.endpoint },
  ]);

  await expect.poll(() => states(gateway)).toEqual(["online", "connecting"]);
  expect((await request(`/${reviewId}`)).headers.get(REVIEW_HOST_HEADER)).toBe(
    "wb-a",
  );

  await expect.poll(() => states(gateway)).toEqual(["online", "duplicate"]);
  await expect
    .poll(memoryOf)
    .toEqual({ [serverId]: { alias: "wb-a", reviewIds: [reviewId] } });
});

it("holds a later remembered alias until the first alias answers", async () => {
  const serverId = randomUUID();
  const reviewId = randomUUID();
  await rememberOwner(serverId, "wb-c", reviewId);

  const a = await startFake({
    version,
    serverId,
    reviewIds: [reviewId],
    handle: slowHealth(1_000, serverId, randomUUID()),
  });

  const c = await startFake({ version, serverId, reviewIds: [reviewId] });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-c", endpoint: c.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[1]?.serverId).toBe(serverId);
  expect(states(gateway)).toEqual(["connecting", "connecting"]);
  const held = await request(`/${reviewId}`);
  expect(held.status).toBe(503);
  expect(held.headers.get(REVIEW_HOST_HEADER)).toBe("wb-c");
  expect(await held.json()).toMatchObject({
    error: expect.stringContaining("Waiting for wb-a"),
  });

  await expect.poll(() => states(gateway)).toEqual(["online", "duplicate"]);
  expect((await request(`/${reviewId}`)).headers.get(REVIEW_HOST_HEADER)).toBe(
    "wb-a",
  );
  await expect
    .poll(memoryOf)
    .toEqual({ [serverId]: { alias: "wb-a", reviewIds: [reviewId] } });
  expect(c.requests.some((entry) => entry.url?.includes(reviewId))).toBe(false);
});

it("refuses a remote's snapshot of another review, and passes its own byte for byte", async () => {
  const reviewId = randomUUID();
  const own = `{"reviewId":"${reviewId}",  "title":"Own"}`;

  const fake = await startFake({
    version,
    reviewIds: [reviewId],
    handle(request, response) {
      if (!request.url?.startsWith(`/reviews-api/${reviewId}?`)) return false;
      response.setHeader("content-type", "application/json");
      response.end(
        request.url.includes("version=")
          ? own
          : JSON.stringify({ reviewId: "scratchpad", title: "Other" }),
      );

      return true;
    },
  });

  const { request, gateway, logged } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const other = await request(`/${reviewId}?full=true`);
  expect(other.status).toBe(502);
  expect(await other.json()).toEqual({
    ok: false,
    error: "wb-a answered with another review, so the answer was refused.",
  });
  expect(logged).toContain(
    `Refused wb-a's answer for ${reviewId}: it carried another review.`,
  );

  const mine = await request(`/${reviewId}?full=true&version=1`);
  expect(mine.status).toBe(200);
  expect(await mine.text()).toBe(own);
});

it("answers 504 for an answer that stalls after its headers, and keeps the host online", async () => {
  const reviewId = randomUUID();

  const fake = await startFake({
    version,
    reviewIds: [reviewId],
    handle(request, response) {
      if (!request.url?.startsWith(`/reviews-api/${reviewId}/file`))
        return false;
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"text":"');

      return true;
    },
  });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const started = Date.now();
  const stalled = await request(`/${reviewId}/file?side=head&file=a.ts`);

  expect(stalled.status).toBe(504);
  expect(await stalled.json()).toEqual({
    ok: false,
    error: "wb-a did not answer: its answer stalled for 10 seconds.",
  });
  expect(Date.now() - started).toBeLessThan(11_500);
  expect(gateway.hosts()[0]?.state).toBe("online");
}, 15_000);

it("passes a whole answer that arrives slowly but steadily, past 10 seconds", async () => {
  const reviewId = randomUUID();
  const timers: NodeJS.Timeout[] = [];

  cleanups.push(async () => {
    for (const timer of timers) clearInterval(timer);
  });

  const fake = await startFake({
    version,
    reviewIds: [reviewId],
    handle(request, response) {
      if (!request.url?.startsWith(`/reviews-api/${reviewId}/file`))
        return false;
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"text":"');
      let sent = 0;

      const timer = setInterval(() => {
        if (++sent <= 12) return void response.write("x");
        clearInterval(timer);
        response.end('"}');
      }, 1_000);

      timers.push(timer);

      return true;
    },
  });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const slow = await request(`/${reviewId}/file?side=head&file=a.ts`);

  expect(slow.status).toBe(200);
  expect(await slow.json()).toEqual({ text: "x".repeat(12) });
  expect(gateway.hosts()[0]?.state).toBe("online");
}, 20_000);

it("ends a forwarded stream when the heartbeat finds its host gone", async () => {
  const reviewId = randomUUID();
  let hang = false;

  const fake = await startFake({
    version,
    reviewIds: [reviewId],
    handle(request, response) {
      if (request.url?.startsWith(`/reviews-api/${reviewId}/structural-diff`)) {
        response.writeHead(200, { "content-type": "application/x-ndjson" });
        response.write('{"type":"file"}\n');

        return true;
      }

      return hang;
    },
  });

  const laptop = await startLaptopGateway(
    root,
    [{ alias: "wb-a", endpoint: fake.endpoint }],
    { heartbeatMs: 1_000 },
  );

  await expect.poll(() => laptop.gateway.hosts()[0]?.state).toBe("online");

  const stream = await laptop.request(`/${reviewId}/structural-diff`);
  expect(stream.status).toBe(200);
  const read = stream.text();

  hang = true;
  const started = Date.now();

  await expect(read).rejects.toThrow("terminated");
  expect(laptop.gateway.hosts()[0]?.state).toBe("offline");
  expect(Date.now() - started).toBeLessThan(1_000 + 3_000 + 500);
}, 10_000);

const ASK_ROUTES: [string, string][] = [
  ["GET", "ask/agents"],
  ["GET", "ask/agents/codex/offer"],
  ["GET", "ask/mentions?query=f"],
  ["GET", "ask/threads"],
  ["POST", "ask"],
  ["POST", "ask/t1/open"],
  ["POST", "ask/t1/prompt"],
  ["POST", "ask/t1/permission"],
  ["POST", "ask/t1/permissions"],
  ["POST", "ask/t1/files"],
  ["POST", "ask/t1/choice"],
  ["POST", "ask/t1/retry"],
  ["POST", "ask/t1/cancel"],
  ["POST", "ask/t1/close"],
  ["DELETE", "ask/t1"],
];

it("forwards every Ask route of a remote review and marks the caller remote", async () => {
  const reviewId = randomUUID();
  const seen: string[] = [];

  const fake = await startFake({
    version,
    reviewIds: [reviewId],
    handle(request, response) {
      if (!request.url?.startsWith(`/reviews-api/${reviewId}/ask`))
        return false;
      seen.push(
        `${request.method} ${request.url.split(`/${reviewId}/`)[1]} ${request.headers["x-review-client"]}`,
      );
      response.setHeader("content-type", "application/json");
      response.end('{"ok":true}');

      return true;
    },
  });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  for (const [method, route] of ASK_ROUTES) {
    const response = await request(`/${reviewId}/${route}`, {
      method,
      body: method === "GET" ? undefined : "{}",
    });

    expect(response.status, `${method} ${route}`).toBe(200);
  }

  expect(seen).toEqual(
    ASK_ROUTES.map(([method, route]) => `${method} ${route} remote`),
  );
});

it("keeps an Ask watch stream open across a 12 s silence and ends it when the host goes", async () => {
  const reviewId = randomUUID();
  let hang = false;
  let remote: import("node:http").ServerResponse | undefined;

  const fake = await startFake({
    version,
    reviewIds: [reviewId],
    handle(request, response) {
      if (request.url === "/health") return hang;

      if (!request.url?.startsWith(`/reviews-api/${reviewId}/ask/t1/watch`))
        return false;
      remote = response;
      response.setHeader("content-type", "text/event-stream");
      response.write('data: {"n":1}\n\n');

      return true;
    },
  });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const response = await request(`/${reviewId}/ask/t1/watch`);
  expect(response.status).toBe(200);

  const reader = response
    .body!.pipeThrough(new TextDecoderStream())
    .getReader();

  expect((await reader.read()).value).toContain('{"n":1}');
  await new Promise((resolve) => setTimeout(resolve, 12_000));
  remote!.write('data: {"n":2}\n\n');
  expect((await reader.read()).value).toContain('{"n":2}');

  hang = true;
  await expect
    .poll(() => gateway.hosts()[0]?.state, { timeout: 15_000 })
    .toBe("offline");
  await expect(reader.read()).rejects.toThrow("terminated");
}, 40_000);

it("passes a 2 MB Ask files body to the remote intact", async () => {
  const reviewId = randomUUID();
  let received = 0;

  const fake = await startFake({
    version,
    reviewIds: [reviewId],
    handle(request, response) {
      if (!request.url?.startsWith(`/reviews-api/${reviewId}/ask/t1/files`))
        return false;
      request.on("data", (chunk: Buffer) => (received += chunk.length));
      request.on("end", () => response.end('{"ok":true}'));

      return true;
    },
  });

  const { request, gateway } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const body = JSON.stringify({ paths: ["x".repeat(2 * 1024 * 1024)] });

  const response = await request(`/${reviewId}/ask/t1/files`, {
    method: "POST",
    body,
  });

  expect(response.status).toBe(200);
  expect(received).toBe(Buffer.byteLength(body));
});

it("waits past the 10 s limit for a slow Ask offer and keeps the host online when it never answers", async () => {
  const slow = randomUUID();
  const hung = randomUUID();

  const fake = await startFake({
    version,
    reviewIds: [slow, hung],
    handle(request, response) {
      if (
        request.url?.startsWith(`/reviews-api/${hung}/ask/agents/codex/offer`)
      )
        return true;

      if (
        !request.url?.startsWith(`/reviews-api/${slow}/ask/agents/codex/offer`)
      )
        return false;

      setTimeout(() => {
        response.setHeader("content-type", "application/json");
        response.end('{"ok":true}');
      }, 11_000);

      return true;
    },
  });

  const { request, gateway } = await startLaptopGateway(
    root,
    [{ alias: "wb-a", endpoint: fake.endpoint }],
    { languageContextMs: 14_000 },
  );

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");

  const [answered, unanswered] = await Promise.all([
    request(`/${slow}/ask/agents/codex/offer`),
    request(`/${hung}/ask/agents/codex/offer`),
  ]);

  expect(answered.status).toBe(200);
  expect(unanswered.status).toBe(504);
  expect(unanswered.headers.get(REVIEW_HOST_HEADER)).toBe("wb-a");
  expect(gateway.hosts()[0]?.state).toBe("online");
}, 30_000);
