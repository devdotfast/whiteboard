import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openLocalReviewStore } from "@review/review-api/local-data.js";
import { ReviewTelemetry } from "@review/review-telemetry.js";
import { reviewServerDiscoveryPath } from "@review/server-discovery.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGlobalReviewServer } from "./desktop-server.js";
import { runHeadlessServer } from "./headless-host.js";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let root: string;

const stops: (() => Promise<void>)[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "review-server-core-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  vi.stubEnv("DEV_FAST_REVIEW_TELEMETRY_DISABLED", "1");
  vi.stubEnv("SHELL", "");
});

afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

interface Running {
  url: string;
  token: string;
}

const servers = {
  async desktop(): Promise<Running> {
    const local = openLocalReviewStore(path.join(root, "review-api.db"));

    const server = createGlobalReviewServer({
      reviewStore: local.store,
      reviewData: local.data,
      appPid: process.pid,
      packageRoot: root,
      toolingRoot: root,
      port: 0,
      discoveryPath: path.join(root, "desktop-server.json"),
      telemetry: ReviewTelemetry.fromEnv(process.env),
    });

    stops.push(async () => {
      await server.close();
      await local.data.close();
      await local.store.close();
    });
    await server.listen();

    return server.discovery;
  },
  async headless(): Promise<Running> {
    const controller = new AbortController();
    const ready = Promise.withResolvers<Running>();

    const running = runHeadlessServer({
      stateDir: path.join(root, "server"),
      signal: controller.signal,
      onReady: ready.resolve,
    });

    stops.push(async () => {
      controller.abort();
      await running;
    });

    return ready.promise;
  },
};

describe.each(["desktop", "headless"] as const)("the %s server", (kind) => {
  const start = servers[kind];

  it("answers /health without a token, but names no machine or build", async () => {
    const server = await start();

    const callers: Record<string, string>[] = [
      {},
      { "x-review-token": "wrong" },
    ];

    for (const headers of callers) {
      const response = await fetch(`${server.url}/health`, { headers });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        instanceId: expect.stringMatching(uuid),
        desktopAttached: false,
        version: expect.any(String),
      });
    }
  });

  it("says which store, process and build answer /health to the token", async () => {
    const server = await start();

    const health = await (
      await fetch(`${server.url}/health`, {
        headers: { "x-review-token": server.token },
      })
    ).json();

    expect(health).toMatchObject({
      serverId: expect.stringMatching(uuid),
      serverPid: process.pid,
      version: JSON.parse(
        await readFile(path.join(packageRoot, "package.json"), "utf8"),
      ).version,
      // From source there is no build, whatever an old dist holds.
      commit: null,
    });
    expect(health.instanceId).not.toBe(health.serverId);
  });

  it("answers an unknown path with a JSON 404", async () => {
    const server = await start();
    const headers = { "x-review-token": server.token };

    for (const route of ["/nothing-here", "/reviews-api/nothing/here/at/all"]) {
      const response = await fetch(`${server.url}${route}`, { headers });

      expect({
        route,
        status: response.status,
        body: await response.json(),
      }).toEqual({
        route,
        status: 404,
        body: { ok: false, error: "Not found." },
      });
    }
  });

  it("refuses every other route without the right token", async () => {
    const server = await start();

    for (const token of [undefined, "wrong"])
      for (const [method, route] of [
        ["GET", "/reviews-api"],
        ["GET", "/control"],
        ["POST", "/control/result"],
      ] as const) {
        const response = await fetch(`${server.url}${route}`, {
          method,
          headers: token ? { "x-review-token": token } : {},
        });

        expect(response.status, `${method} ${route}`).toBe(401);
      }
  });

  it("answers a preflight from the Desktop's origin with CORS headers", async () => {
    const server = await start();
    const origin = "vscode-file://vscode-app";

    const response = await fetch(`${server.url}/reviews-api`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-review-token",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "x-review-token",
    );
    expect(
      (
        await fetch(`${server.url}/health`, { headers: { origin } })
      ).headers.get("access-control-allow-origin"),
    ).toBe(origin);
  });

  // Each Desktop window attaches its own stream; the Desktop keeps one so a
  // verb never opens in every window.
  const limit = { desktop: 1, headless: 16 }[kind];

  it(`refuses a /control client beyond ${limit} with a well-formed response`, async () => {
    const server = await start();
    const headers = { "x-review-token": server.token };
    const abort = new AbortController();

    try {
      for (let index = 0; index < limit; index++) {
        const attached = await fetch(`${server.url}/control`, {
          headers,
          signal: abort.signal,
        });

        expect(attached.status).toBe(200);
      }

      const refused = await fetch(`${server.url}/control`, { headers });

      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ ok: false });

      // Node's parser rejects a reply framed both ways.
      const [raw] = await once(
        request(`${server.url}/control`, { headers }).end(),
        "response",
      );

      expect(raw.statusCode).toBe(409);
      expect(
        raw.headers["transfer-encoding"] && raw.headers["content-length"],
      ).toBeFalsy();
      await once(raw.resume(), "end");
    } finally {
      abort.abort();
    }
  });

  it("answers a malformed /control/result with a JSON 400", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/control/result`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-review-token": server.token,
      },
      body: "not json",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Invalid JSON body.",
    });
  });
});

// The servers as they run: the Desktop's host process and `server start`.
const processes = {
  desktop: (home: string) =>
    spawnSource("src/server/desktop-host.ts", [], {
      DEV_REVIEW_HOME: home,
      DEV_FAST_REVIEW_SERVER_PORT: "0",
      DEV_FAST_REVIEW_APP_PID: String(process.pid),
    }),
  headless: (home: string, stateDir = path.join(home, "server")) =>
    spawnSource(
      "src/cli.ts",
      ["server", "start", "--json", "--state-dir", stateDir],
      { DEV_REVIEW_HOME: home },
    ),
};

it("gives the Desktop and headless servers on one home one serverId, and another home another", async () => {
  const other = path.join(root, "other");

  // Started together, so both race to create the id.
  const children = [
    ["desktop", processes.desktop(root), undefined],
    ["headless", processes.headless(root, root), root],
    ["headless", processes.headless(other, other), other],
  ] as const;

  try {
    const [desktop, headless, elsewhere] = await Promise.all(
      children.map(async ([kind, child, stateDir]) => {
        const server = await discovery(kind, child, stateDir);

        return (
          await (
            await fetch(`${server.url}/health`, {
              headers: { "x-review-token": server.token },
            })
          ).json()
        ).serverId;
      }),
    );

    expect(desktop).toMatch(uuid);
    expect(headless).toBe(desktop);
    expect(elsewhere).toMatch(uuid);
    expect(elsewhere).not.toBe(desktop);
  } finally {
    await Promise.all(
      children.map(async ([, child]) => {
        if (child.exitCode !== null) return;
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }),
    );
  }
}, 30_000);

it.each([
  ["desktop", 1],
  ["headless", 1],
  ["headless", 2],
] as const)(
  "the %s server exits on SIGTERM with %i /control clients attached",
  async (kind, clients) => {
    const child = processes[kind](root);
    const exited = once(child, "exit");

    try {
      const server = await discovery(kind, child);

      for (let index = 0; index < clients; index++) {
        const control = await fetch(`${server.url}/control`, {
          headers: { "x-review-token": server.token },
        });

        expect(control.status).toBe(200);
      }

      child.kill("SIGTERM");

      // Under the headless server's 5 s force-close: the relay must end the
      // streams itself.
      let timer: NodeJS.Timeout | undefined;

      const [code] = await Promise.race([
        exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("still running after 3 s")),
            3_000,
          );
        }),
      ]).finally(() => clearTimeout(timer));

      expect(code).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await exited;
    }
  },
  20_000,
);

it("refuses to reset the id while a paused headless server holds the store", async ({
  onTestFinished,
}) => {
  const stateDir = path.join(root, "server");
  const child = processes.headless(root, stateDir);
  const exited = once(child, "exit");

  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGCONT");
      child.kill("SIGKILL");
    }

    await exited;
  });

  const server = await discovery("headless", child, stateDir);

  const serverId = async () =>
    (
      await (
        await fetch(`${server.url}/health`, {
          headers: { "x-review-token": server.token },
        })
      ).json()
    ).serverId;

  const before = await serverId();
  child.kill("SIGSTOP");

  const reset = spawnSource(
    "src/cli.ts",
    ["--state-dir", stateDir, "server", "reset-id", "--json"],
    { DEV_REVIEW_HOME: root },
  );

  let output = "";
  reset.stdout!.on("data", (chunk) => (output += chunk));
  const [code] = await once(reset, "exit");

  expect(code).toBe(1);
  expect(JSON.parse(output).error.message).toMatch(/Stop it first/);

  child.kill("SIGCONT");
  expect(await serverId()).toBe(before);

  const local = openLocalReviewStore(path.join(stateDir, "review-api.db"));
  onTestFinished(async () => {
    await local.data.close();
    await local.store.close();
  });
  expect(local.store.serverId()).toBe(before);
}, 30_000);

function spawnSource(
  entry: string,
  args: string[],
  env: Record<string, string>,
): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", entry, ...args], {
    cwd: packageRoot,
    env: {
      ...process.env,
      ...env,
      DEV_FAST_REVIEW_TELEMETRY_DISABLED: "1",
      DEV_FAST_REVIEW_CLI_NO_DELEGATE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function discovery(
  kind: string,
  child: ChildProcess,
  stateDir = path.join(root, "server"),
): Promise<Running> {
  let output = "";
  let errors = "";
  const ready = Promise.withResolvers<void>();

  child.stdout!.on("data", (chunk) => {
    output += chunk;

    if (/"(ready|server\.ready)"/.test(output)) ready.resolve();
  });
  child.stderr!.on("data", (chunk) => {
    errors += chunk;
  });
  child.once("exit", (code, signal) =>
    ready.reject(
      new Error(
        `The ${kind} server exited before ready (${signal ?? code}):\n${errors}`,
      ),
    ),
  );
  await ready.promise;

  if (kind === "desktop")
    return JSON.parse(
      output.split("\n").find((line) => line.includes('"ready"'))!,
    );

  return JSON.parse(
    await readFile(reviewServerDiscoveryPath(stateDir), "utf8"),
  );
}
