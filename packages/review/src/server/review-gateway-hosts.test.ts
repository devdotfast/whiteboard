import { once } from "node:events";
import { cp, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { readReviewPackageVersion } from "@review/package-paths.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createGatewayHosts, readBody, send } from "./review-gateway-hosts.js";
import {
  startFake,
  startRemote,
  stopAll,
} from "./review-gateway-test-utils.js";

const version = readReviewPackageVersion(import.meta.url);

let root: string;

const closes: (() => void)[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "review-gateway-hosts-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  vi.stubEnv("DEV_FAST_REVIEW_TELEMETRY_DISABLED", "1");
});

afterEach(async () => {
  for (const close of closes.splice(0)) close();
  await stopAll();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function hosts(laptopVersion = version) {
  const created = createGatewayHosts({ version: laptopVersion });
  closes.push(() => created.close());

  return created;
}

it("never contacts a host that arrives with a problem", async () => {
  const fake = await startFake({ version });
  const gateway = hosts();

  gateway.set([
    {
      alias: "devbox",
      endpoint: fake.endpoint,
      problem: { state: "auth-failed", detail: "Permission denied." },
    },
    { alias: "later" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 200));

  expect(gateway.states()).toEqual([
    { alias: "devbox", state: "auth-failed", detail: "Permission denied." },
    { alias: "later", state: "connecting", detail: expect.any(String) },
  ]);
  expect(fake.requests).toEqual([]);
});

it("refuses a host on another version, naming both versions, with the install command beside the detail", async () => {
  const remote = await startRemote(path.join(root, "a"));
  const gateway = hosts("0.0.0-other");

  gateway.set([{ alias: "devbox", endpoint: remote.endpoint }]);

  await expect.poll(() => gateway.states()[0]?.state).toBe("incompatible");
  const [state] = gateway.states();
  expect(state?.serverId).toBe((await remote.health()).serverId);
  expect(state?.detail).toContain(version);
  expect(state?.detail).toContain("0.0.0-other");
  expect(state?.detail).toContain("Install Whiteboard 0.0.0-other on devbox.");
  expect(state?.detail).not.toContain("npm install");
  expect(state?.installCommand).toBe(
    "npm install -g @dev.fast/whiteboard@0.0.0-other",
  );
  expect(gateway.online()).toEqual([]);
});

it("refuses a host whose version is not a version, without repeating it", async () => {
  const fake = await startFake({ version: "x npm install -g evil" });
  const gateway = hosts("0.1.6");

  gateway.set([{ alias: "devbox", endpoint: fake.endpoint }]);

  await expect.poll(() => gateway.states()[0]?.state).toBe("incompatible");
  const [state] = gateway.states();
  expect(state?.detail).toBe("devbox reports an invalid version.");
  expect(state?.installCommand).toBe(
    "npm install -g @dev.fast/whiteboard@0.1.6",
  );
  expect(gateway.online()).toEqual([]);
});

it("names the laptop's install command for a host without Whiteboard", () => {
  const gateway = hosts("0.1.6");

  gateway.set([
    {
      alias: "devbox",
      problem: {
        state: "not-installed",
        detail: "Whiteboard is not installed on devbox.",
      },
    },
    {
      alias: "other",
      problem: { state: "auth-failed", detail: "Permission denied." },
    },
  ]);

  expect(gateway.states()).toEqual([
    {
      alias: "devbox",
      state: "not-installed",
      detail: "Whiteboard is not installed on devbox.",
      installCommand: "npm install -g @dev.fast/whiteboard@0.1.6",
    },
    { alias: "other", state: "auth-failed", detail: "Permission denied." },
  ]);
});

it("refuses a host whose version could not be read", async () => {
  const fake = await startFake({ version: "unknown" });
  const gateway = hosts("unknown");

  gateway.set([{ alias: "devbox", endpoint: fake.endpoint }]);

  await expect.poll(() => gateway.states()[0]?.state).toBe("incompatible");
});

it("shows Desktop's language features on an online host, and keeps the host online when only they change", async () => {
  const fake = await startFake({ version });
  const gateway = hosts();

  const detail =
    "language features need the same Whiteboard version on devbox: it runs 1111111, this Desktop 2222222";

  gateway.set([
    {
      alias: "devbox",
      endpoint: fake.endpoint,
      languageFeatures: false,
      languageFeaturesDetail: detail,
    },
  ]);

  await expect.poll(() => gateway.states()[0]?.state).toBe("online");
  expect(gateway.states()[0]).toMatchObject({
    languageFeatures: false,
    languageFeaturesDetail: detail,
  });

  const languageGroups = [
    {
      group: "swift",
      installed: true,
      detail: "swift was not found on the login shell's PATH",
    },
  ];

  gateway.set([
    {
      alias: "devbox",
      endpoint: fake.endpoint,
      languageFeatures: true,
      languageGroups,
    },
  ]);

  expect(gateway.states()[0]).toMatchObject({
    state: "online",
    languageFeatures: true,
    languageGroups,
  });
  expect(gateway.states()[0]?.languageFeaturesDetail).toBeUndefined();
  expect(gateway.online().map((host) => host.alias)).toEqual(["devbox"]);
});

it("says nothing of language features for a host that is not online", () => {
  const gateway = hosts();

  gateway.set([{ alias: "devbox", languageFeatures: true }]);

  expect(gateway.states()).toEqual([
    { alias: "devbox", state: "connecting", detail: expect.any(String) },
  ]);
});

it("treats one server under two aliases as one machine", async () => {
  const remote = await startRemote(path.join(root, "a"));
  const gateway = hosts();

  gateway.set([
    { alias: "first", endpoint: remote.endpoint },
    { alias: "second", endpoint: remote.endpoint },
  ]);

  const { serverId } = await remote.health();
  await expect
    .poll(() => gateway.states())
    .toEqual([
      { alias: "first", serverId, state: "online" },
      { alias: "second", serverId, state: "online" },
    ]);
  expect(gateway.serving(serverId)?.alias).toBe("first");
  expect(gateway.online().map((host) => host.alias)).toEqual(["first"]);
});

it("marks the second of two machines with a copied id as a duplicate", async () => {
  const first = await startRemote(path.join(root, "a"));
  await first.stop();
  await cp(path.join(root, "a"), path.join(root, "c"), { recursive: true });
  const a = await startRemote(path.join(root, "a"));
  const c = await startRemote(path.join(root, "c"));
  const { serverId } = await a.health();
  expect((await c.health()).serverId).toBe(serverId);

  const gateway = hosts();
  gateway.set([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-c", endpoint: c.endpoint },
  ]);

  await expect.poll(() => gateway.states()[1]?.state).toBe("duplicate");
  const [online, duplicate] = gateway.states();
  expect(online).toEqual({ alias: "wb-a", serverId, state: "online" });
  expect(duplicate?.detail).toContain("wb-a");
  expect(duplicate?.detail).toContain("wb-c");
  expect(duplicate?.detail).toContain("whiteboard server reset-id");
  expect(gateway.online().map((host) => host.alias)).toEqual(["wb-a"]);
});

it("retries an offline host until it answers", async () => {
  const fake = await startFake({ version });
  await fake.stop();
  const gateway = hosts();

  gateway.set([{ alias: "devbox", endpoint: fake.endpoint }]);
  await expect.poll(() => gateway.states()[0]?.state).toBe("offline");

  await startFake({ version }, fake.port);
  await expect
    .poll(() => gateway.states()[0]?.state, { timeout: 5_000 })
    .toBe("online");
});

async function copiedStore() {
  const first = await startRemote(path.join(root, "a"));
  await first.stop();
  await cp(path.join(root, "a"), path.join(root, "c"), { recursive: true });
  const a = await startRemote(path.join(root, "a"));
  const c = await startRemote(path.join(root, "c"));

  return { a, c, serverId: (await a.health()).serverId };
}

it("keeps a copied store a duplicate while the first alias is down", async () => {
  const { a, c, serverId } = await copiedStore();
  const port = Number(new URL(a.endpoint.url).port);
  const gateway = hosts();

  gateway.set([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-c", endpoint: c.endpoint },
  ]);
  await expect.poll(() => gateway.states()[1]?.state).toBe("duplicate");

  await a.stop();
  gateway.failed(gateway.serving(serverId)!, "test");
  await expect.poll(() => gateway.states()[0]?.state).toBe("offline");

  expect(gateway.states()[1]?.state).toBe("duplicate");
  expect(gateway.serving(serverId)).toBeUndefined();
  expect(gateway.online()).toEqual([]);
  expect(gateway.unavailable(serverId, "wb-a")).toMatchObject({
    alias: "wb-a",
    state: "offline",
  });

  await expect
    .poll(() => gateway.states()[0]?.detail)
    .toBe("wb-a is offline: it refused the connection; attaching again.");
  const restarted = await startRemote(path.join(root, "a"), port);

  gateway.set([
    { alias: "wb-a", endpoint: restarted.endpoint },
    { alias: "wb-c", endpoint: c.endpoint },
  ]);
  await expect
    .poll(() => gateway.states()[0]?.state, { timeout: 5_000 })
    .toBe("online");
  expect(gateway.states()[1]?.state).toBe("duplicate");
  expect(gateway.serving(serverId)?.alias).toBe("wb-a");
});

it("decides the duplicate by the order of the setting", async () => {
  const { a, c, serverId } = await copiedStore();
  const gateway = hosts();

  gateway.set([
    { alias: "wb-c", endpoint: c.endpoint },
    { alias: "wb-a", endpoint: a.endpoint },
  ]);

  await expect
    .poll(() => gateway.states().map((host) => host.state))
    .toEqual(["online", "duplicate"]);
  expect(gateway.states()[1]?.detail).toContain("wb-c");
  expect(gateway.serving(serverId)?.alias).toBe("wb-c");
});

it("leaves a host in backoff alone when only another host changes, and checks it at once when its own entry does", async () => {
  let failing = true;
  let checks = 0;

  const fake = await startFake({
    version,
    handle(request, response) {
      if (request.url !== "/health") return false;
      checks += 1;

      if (!failing) return false;
      response.statusCode = 500;
      response.end();

      return true;
    },
  });

  const gateway = hosts();

  gateway.set([{ alias: "devbox", endpoint: fake.endpoint }]);
  await expect
    .poll(() => checks, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(4);
  expect(gateway.states()[0]?.state).toBe("offline");
  const before = checks;

  failing = false;
  gateway.set([
    { alias: "devbox", endpoint: fake.endpoint },
    { alias: "other" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 500));

  expect(checks).toBe(before);
  expect(gateway.states()[0]?.state).toBe("offline");

  gateway.set([{ alias: "devbox" }, { alias: "other" }]);
  gateway.set([
    { alias: "devbox", endpoint: fake.endpoint },
    { alias: "other" },
  ]);

  await expect
    .poll(() => gateway.states()[0]?.state, { timeout: 1_000 })
    .toBe("online");
}, 20_000);

it("sends a request again when the host closed the kept-alive socket it reused", async () => {
  let requests = 0;

  const server = net.createServer((socket) => {
    socket.on("data", () => {
      requests += 1;

      if (requests === 2) socket.destroy();
      else socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  closes.push(() => server.close());
  const agent = new http.Agent({ keepAlive: true });
  closes.push(() => agent.destroy());

  // SAFETY: a TCP listener's address() is an AddressInfo.
  const { port } = server.address() as AddressInfo;

  const remote = {
    alias: "devbox",
    endpoint: { url: `http://127.0.0.1:${port}`, token: "" },
    agent,
  };

  const get = async () => {
    const response = await send(remote, {
      method: "GET",
      path: "/health",
      signal: new AbortController().signal,
    });

    return (await readBody(response, 64)).toString();
  };

  expect(await get()).toBe("ok");
  expect(await get()).toBe("ok");
  expect(requests).toBe(3);
});

it("a restarted server is offline until Desktop attaches again, then online with the new token", async () => {
  const stateDir = path.join(root, "a");
  const a = await startRemote(stateDir);
  const port = Number(new URL(a.endpoint.url).port);
  const restarted: string[] = [];

  const gateway = createGatewayHosts({
    version,
    restarted: (alias) => restarted.push(alias),
  });

  closes.push(() => gateway.close());

  gateway.set([
    { alias: "wb-a1", endpoint: a.endpoint },
    { alias: "wb-a2", endpoint: a.endpoint },
  ]);
  const { serverId } = await a.health();
  await expect
    .poll(() => gateway.states().map((host) => host.state))
    .toEqual(["online", "online"]);

  await a.stop();
  const b = await startRemote(stateDir, port);
  gateway.failed(gateway.serving(serverId)!, "test");

  await expect
    .poll(() => gateway.states().map((host) => [host.state, host.detail]))
    .toEqual([
      ["offline", "wb-a1 restarted; attaching again."],
      ["offline", "wb-a2 restarted; attaching again."],
    ]);
  expect(restarted).toEqual(["wb-a1", "wb-a2"]);

  gateway.set([
    { alias: "wb-a1", endpoint: b.endpoint },
    { alias: "wb-a2", endpoint: b.endpoint },
  ]);
  await expect
    .poll(() => gateway.states().map((host) => host.state))
    .toEqual(["online", "online"]);
  expect(restarted).toHaveLength(2);
  expect(gateway.serving(serverId)?.alias).toBe("wb-a1");
}, 20_000);

it("a 401 from a host asks Desktop once to attach again", async () => {
  const fake = await startFake({
    version,
    handle: (request, response) => {
      if (request.url === "/health") return false;
      response.statusCode = 401;
      response.end();

      return true;
    },
  });

  const restarted: string[] = [];

  const gateway = createGatewayHosts({
    version,
    restarted: (alias) => restarted.push(alias),
  });

  closes.push(() => gateway.close());

  gateway.set([{ alias: "devbox", endpoint: fake.endpoint }]);
  await expect.poll(() => gateway.states()[0]?.state).toBe("online");
  const [remote] = gateway.online();

  for (let i = 0; i < 2; i++)
    (
      await send(remote!, {
        method: "GET",
        path: "/reviews-api",
        signal: new AbortController().signal,
      })
    ).resume();

  expect(gateway.states()[0]).toMatchObject({
    state: "offline",
    detail: "devbox restarted; attaching again.",
  });
  expect(restarted).toEqual(["devbox"]);
});

it("a server that stops answering /health is attached again after three timeouts in a row", async () => {
  let hanging = false;

  const fake = await startFake({
    version,
    handle: (request) => hanging && request.url === "/health",
  });

  const restarted: string[] = [];

  const gateway = createGatewayHosts({
    version,
    restarted: (alias) => restarted.push(alias),
  });

  closes.push(() => gateway.close());
  gateway.set([{ alias: "devbox", endpoint: fake.endpoint }]);
  await expect.poll(() => gateway.states()[0]?.state).toBe("online");

  hanging = true;
  gateway.failed(gateway.online()[0]!, "test");

  await expect
    .poll(() => gateway.states()[0]?.detail, { timeout: 5_000 })
    .toBe("devbox is offline: it did not answer within 3 seconds.");
  expect(restarted).toEqual([]);

  await expect.poll(() => restarted, { timeout: 20_000 }).toEqual(["devbox"]);
  expect(gateway.states()[0]).toMatchObject({
    state: "offline",
    detail:
      "devbox is offline: it did not answer within 3 seconds, 3 times in a row; attaching again.",
  });
}, 30_000);

it("a server gone from behind a working forward asks Desktop to attach again", async () => {
  const a = await startRemote(path.join(root, "a"));
  const restarted: string[] = [];

  const gateway = createGatewayHosts({
    version,
    restarted: (alias) => restarted.push(alias),
  });

  closes.push(() => gateway.close());
  gateway.set([{ alias: "wb-a", endpoint: a.endpoint }]);
  await expect.poll(() => gateway.states()[0]?.state).toBe("online");

  await a.stop();
  gateway.failed(gateway.online()[0]!, "test");

  await expect.poll(() => restarted).toEqual(["wb-a"]);
  expect(gateway.states()[0]).toMatchObject({
    state: "offline",
    detail: "wb-a is offline: it refused the connection; attaching again.",
  });
});
