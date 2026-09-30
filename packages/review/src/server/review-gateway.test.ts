import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type JsonObject,
  REVIEW_HOST_HEADER,
  type ReviewGatewayHost,
} from "@dev.fast/review-protocol";
import { getRequestListener } from "@hono/node-server";
import {
  findReviewPackageRoot,
  readReviewPackageVersion,
} from "@review/package-paths.js";
import { createReviewApi } from "@review/review-api/http.js";
import { openReviewProfile } from "@review/review-api/profile.js";
import type { Result } from "@review/review-api/store.js";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createGlobalReviewServer } from "./desktop-server.js";
import { gatewayMemoryPath } from "./review-gateway-memory.js";
import {
  type FakeHandler,
  startFake,
  startRemote,
  stopAll,
} from "./review-gateway-test-utils.js";
import { createReviewGateway } from "./review-gateway.js";

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

/** The laptop's review API in process, and a gateway over it on a real port. */
async function startGateway(
  hosts: ReviewGatewayHost[],
  gatewayVersion = version,
) {
  const home = path.join(root, "laptop");
  const local = await openReviewProfile(home, { manageWorkspaces: true });
  await local.store.ensureScratchpad();

  const laptop = new Hono().route(
    "/reviews-api",
    createReviewApi(
      local.store,
      local.data,
      undefined,
      undefined,
      undefined,
      () => true,
    ),
  );

  const logged: string[] = [];

  const gateway = createReviewGateway({
    local: (request) => laptop.fetch(request),
    version: gatewayVersion,
    home,
    log: (message) => logged.push(message),
  });

  gateway.setHosts(hosts);

  const server = createServer(getRequestListener(gateway.fetch));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await gateway.close();
    await local.data.close();
    await local.store.close();
  };

  cleanups.push(close);

  // SAFETY: a TCP listener's address() is an AddressInfo.
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const request = (route: string, init: RequestInit = {}) =>
    fetch(`${url}/reviews-api${route}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-review-token": LAPTOP_TOKEN,
        ...init.headers,
      },
    });

  return { gateway, local, request, close, logged };
}

async function repository() {
  const directory = path.join(root, `repo-${randomUUID()}`);
  await mkdir(directory, { recursive: true });

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();

  git("init", "-q", "-b", "main");
  git("config", "user.name", "Review Test");
  git("config", "user.email", "review-test@example.invalid");
  await writeFile(path.join(directory, "example.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  await writeFile(path.join(directory, "example.ts"), "export const a = 2;\n");
  git("commit", "-qam", "head");

  return { directory, base, head: git("rev-parse", "HEAD") };
}

type Remote = Awaited<ReturnType<typeof startRemote>>;

async function seed(remote: Remote, title: string) {
  const repo = await repository();

  const registered = await remote.api<{ id: string }>("/repositories", {
    method: "POST",
    body: JSON.stringify({ path: repo.directory }),
  });

  const created = await remote.api<Result>("/commands", {
    method: "POST",
    body: JSON.stringify({
      commandId: randomUUID(),
      operation: {
        type: "create",
        title,
        pins: { repositoryId: registered.id, base: repo.base, head: repo.head },
      },
    }),
  });

  return created.reviewId;
}

const command = (operation: JsonObject) =>
  JSON.stringify({ commandId: randomUUID(), operation });

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

  // Registering and creating name no review; they belong to the laptop.
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
      pins: { repositoryId, base: repo.base, head: repo.head },
    }),
  });

  expect(created.status).toBe(200);
  expect(created.headers.has(REVIEW_HOST_HEADER)).toBe(false);
  const { reviewId: onLaptop } = await created.json();
  expect(local.store.summary(onLaptop)?.title).toBe("On the laptop");

  const readLaptop = await request(`/${onLaptop}`);
  expect(readLaptop.status).toBe(200);
  expect(readLaptop.headers.has(REVIEW_HOST_HEADER)).toBe(false);

  // An id no machine has gets the laptop's own answer.
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
  ["language-context", "GET", "rootPath"],
  ["navigator", "POST", "workspacePath"],
  ["navigator", "POST", "filePath"],
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

  expect(fake.requests.map((entry) => entry.url)).toEqual(["/health"]);
});

it("answers 503 with the install command for a review on another version, also from its memory file", async () => {
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
    error: expect.stringContaining(
      "npm install -g @dev.fast/whiteboard@0.0.0-other",
    ),
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
    commandId: randomUUID(),
    operation: {
      type: "create",
      title: "On the laptop",
      pins: { repositoryId, base: repo.base, head: repo.head },
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
  // The first request finds a gone; later ones are refused, never sent to c.
  expect((await request(`/${onA}?full=true`)).status).toBe(502);

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

/** A loopback port nothing listens on yet. */
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

/** A /health that answers after `delayMs`, or never when it is undefined. */
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

  await startFake({ version, serverId, reviewIds: [reviewId] }, port);

  await expect
    .poll(() => states(gateway), { timeout: 5_000 })
    .toEqual(["online", "duplicate"]);
  // The memory follows the machine, not the alias that served last.
  await expect
    .poll(memoryOf)
    .toEqual({ [serverId]: { alias: "wb-a", reviewIds: [reviewId] } });
  expect((await request(`/${reviewId}`)).headers.get(REVIEW_HOST_HEADER)).toBe(
    "wb-a",
  );
});

it("names the 10 second limit when a lookup finds a host hung", async () => {
  const fake = await startFake({
    version,
    handle: (request) => request.url !== "/health",
  });

  const { request, gateway, logged } = await startGateway([
    { alias: "wb-a", endpoint: fake.endpoint },
  ]);

  await expect.poll(() => gateway.hosts()[0]?.state).toBe("online");
  expect((await request(`/${randomUUID()}`)).status).toBe(404);
  expect(logged).toContain(
    "Host wb-a: offline (wb-a is offline: it did not answer within 10 seconds.)",
  );
}, 20_000);
