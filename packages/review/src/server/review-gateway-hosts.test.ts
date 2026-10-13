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

function hosts(localVersion = version) {
  const created = createGatewayHosts({ version: localVersion });
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

it("refuses a host on another version, naming both versions", async () => {
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
  expect(gateway.online()).toEqual([]);
});

it("refuses a host whose version could not be read", async () => {
  const fake = await startFake({ version: "unknown" });
  const gateway = hosts("unknown");

  gateway.set([{ alias: "devbox", endpoint: fake.endpoint }]);

  await expect.poll(() => gateway.states()[0]?.state).toBe("incompatible");
});

it("uses neither of two aliases for one server", async () => {
  const remote = await startRemote(path.join(root, "a"));
  const gateway = hosts();

  gateway.set([
    { alias: "first", endpoint: remote.endpoint },
    { alias: "second", endpoint: remote.endpoint },
  ]);

  const { serverId } = await remote.health();
  await expect
    .poll(() => gateway.states().map((host) => host.state))
    .toEqual(["duplicate", "duplicate"]);
  expect(gateway.states()[1]?.detail).toContain("first, second");
  expect(gateway.serving(serverId)).toBeUndefined();
  expect(gateway.online()).toEqual([]);
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

it("uses neither of two machines with a copied id, until one leaves the setting", async () => {
  const first = await startRemote(path.join(root, "a"));
  await first.stop();
  await cp(path.join(root, "a"), path.join(root, "c"), { recursive: true });
  const a = await startRemote(path.join(root, "a"));
  const c = await startRemote(path.join(root, "c"));
  const { serverId } = await a.health();
  const gateway = hosts();

  gateway.set([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-c", endpoint: c.endpoint },
  ]);

  await expect
    .poll(() => gateway.states().map((host) => host.state))
    .toEqual(["duplicate", "duplicate"]);
  expect(gateway.states()[0]?.detail).toContain("wb-a, wb-c");
  expect(gateway.states()[0]?.detail).toContain("whiteboard server reset-id");
  expect(gateway.serving(serverId)).toBeUndefined();

  await c.stop();
  gateway.set([{ alias: "wb-a", endpoint: a.endpoint }]);
  expect(gateway.states()).toEqual([
    { alias: "wb-a", serverId, state: "online" },
  ]);
  expect(gateway.serving(serverId)?.alias).toBe("wb-a");
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
