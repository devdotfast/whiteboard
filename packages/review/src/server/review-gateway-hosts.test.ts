import { once } from "node:events";
import { cp, mkdtemp, rm } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { readReviewPackageVersion } from "@review/package-paths.js";
import { Agent } from "undici";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createGatewayHosts } from "./review-gateway-hosts.js";
import {
  startFake,
  startRemote,
  stopAll,
} from "./review-gateway-test-utils.js";
import { readBody, send } from "./review-gateway-transport.js";

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
  const answering = await startFake({ version });
  const gateway = hosts();

  gateway.set([
    {
      alias: "devbox",
      endpoint: fake.endpoint,
      problem: { state: "auth-failed", detail: "Permission denied." },
    },
    { alias: "later" },
    { alias: "up", endpoint: answering.endpoint },
  ]);
  await expect.poll(() => gateway.states()[2]?.state).toBe("online");

  expect(gateway.states().slice(0, 2)).toEqual([
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

it("names this machine's install command for a host without Whiteboard", () => {
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
  gateway.set([
    { alias: "devbox", endpoint: fake.endpoint, languageFeatures: true },
  ]);

  expect(gateway.states()[0]).toMatchObject({
    state: "online",
    languageFeatures: true,
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
  expect(gateway.online()).toEqual([]);

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

async function listen(answer: (socket: net.Socket, request: number) => void) {
  let requests = 0;

  const server = net.createServer((socket) => {
    let received = "";

    socket.on("data", (chunk) => {
      received += chunk.toString();

      if (!received.endsWith("\r\n\r\nhi")) return;
      received = "";
      requests += 1;
      answer(socket, requests);
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  closes.push(() => server.close());
  const dispatcher = new Agent();
  closes.push(() => dispatcher.destroy());

  // SAFETY: a TCP listener's address() is an AddressInfo.
  const { port } = server.address() as AddressInfo;

  const post = async () => {
    const response = await send(
      {
        alias: "devbox",
        endpoint: { url: `http://127.0.0.1:${port}`, token: "" },
        dispatcher,
      },
      { method: "POST", path: "/ask", body: Buffer.from("hi") },
    );

    return (await readBody(response.body, 64)).toString();
  };

  return { post, requests: () => requests };
}

it("sends a request again when the host closed the kept-alive socket it reused", async () => {
  const host = await listen((socket, request) => {
    if (request === 2) socket.destroy();
    else socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
  });

  expect(await host.post()).toBe("ok");
  // Wait for undici to free the connection, so the next request reuses it.
  await new Promise((resolve) => setImmediate(resolve));
  expect(await host.post()).toBe("ok");
  expect(host.requests()).toBe(3);
});

it("does not send a request with a body again when a new connection closed", async () => {
  const host = await listen((socket) => socket.destroy());

  await expect(host.post()).rejects.toMatchObject({ code: "UND_ERR_SOCKET" });
  expect(host.requests()).toBe(1);
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

  gateway.set([{ alias: "wb-a", endpoint: a.endpoint }]);
  const { serverId } = await a.health();
  await expect.poll(() => gateway.states()[0]?.state).toBe("online");

  await a.stop();
  const b = await startRemote(stateDir, port);
  gateway.failed(gateway.serving(serverId)!, "test");

  await expect.poll(() => restarted).toEqual(["wb-a"]);
  expect(gateway.states()[0]?.state).toBe("offline");

  gateway.set([{ alias: "wb-a", endpoint: b.endpoint }]);
  await expect.poll(() => gateway.states()[0]?.state).toBe("online");
  expect(restarted).toHaveLength(1);
  expect(gateway.serving(serverId)?.alias).toBe("wb-a");
}, 20_000);

it("a server that stops answering /health once its id is known is attached again once, even if a request then gets a 401", async () => {
  let down = false;
  const held = Promise.withResolvers<void>();

  const fake = await startFake({
    version,
    handle: (request, response) => {
      if (request.url === "/health") {
        if (down) response.destroy();

        return down;
      }

      void held.promise.then(() => {
        response.statusCode = 401;
        response.end();
      });

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
  const request = send(remote!, { method: "GET", path: "/reviews-api" });

  down = true;
  gateway.failed(remote!, "test");
  await expect.poll(() => restarted).toEqual(["devbox"]);
  held.resolve();
  await (await request).body.dump();

  expect(gateway.states()[0]?.state).toBe("offline");
  expect(restarted).toEqual(["devbox"]);
});

it("a 401 on a forwarded request marks the host restarted and asks Desktop to attach again once", async () => {
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

  for (const response of await Promise.all([
    send(remote!, { method: "GET", path: "/reviews-api" }),
    send(remote!, { method: "GET", path: "/reviews-api" }),
  ]))
    await response.body.dump();

  expect(gateway.states()[0]).toMatchObject({
    state: "offline",
    detail: "devbox restarted; attaching again.",
  });
  expect(restarted).toEqual(["devbox"]);
});
