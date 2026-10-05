import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import type {
  ReviewGatewayHost,
  ReviewServerHealthWithToken,
} from "@dev.fast/review-protocol";
import { getRequestListener } from "@hono/node-server";
import { readReviewPackageVersion } from "@review/package-paths.js";
import { createReviewApi } from "@review/review-api/http.js";
import { openReviewProfile } from "@review/review-api/profile.js";
import type { Result } from "@review/review-api/store.js";
import type { ReviewServerDiscovery } from "@review/server-discovery.js";
import { Hono } from "hono";

import {
  GlobalReviewDesktopVerbRelay,
  type ReviewDesktopVerbRelay,
} from "./global-verb-relay.js";
import { runHeadlessServer } from "./headless-host.js";
import { createReviewGateway } from "./review-gateway.js";

const version = readReviewPackageVersion(import.meta.url);

const stops: (() => Promise<void>)[] = [];

export async function stopAll() {
  for (const stop of stops.splice(0).reverse())
    await stop().catch(() => undefined);
}

export async function startRemote(stateDir: string, port?: number) {
  const controller = new AbortController();
  const ready = Promise.withResolvers<ReviewServerDiscovery>();

  const running = runHeadlessServer({
    stateDir,
    ...(port !== undefined && { port }),
    signal: controller.signal,
    onReady: ready.resolve,
  });

  const stop = async () => {
    controller.abort();
    await running;
  };

  stops.push(stop);

  const discovery = await Promise.race([
    ready.promise,
    running.then(() => {
      throw new Error("Server exited before readiness");
    }),
  ]);

  const api = async <T>(route: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${discovery.url}/reviews-api${route}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-review-token": discovery.token,
      },
    });

    if (!response.ok)
      throw new Error(`${route}: ${response.status} ${await response.text()}`);

    // SAFETY: test helper; callers name the shape the route answers.
    return (await response.json()) as T;
  };

  const health = async () =>
    // SAFETY: /health answers ReviewServerHealthWithToken to the token.
    (await (
      await fetch(`${discovery.url}/health`, {
        headers: { "x-review-token": discovery.token },
      })
    ).json()) as ReviewServerHealthWithToken;

  return {
    discovery,
    stop,
    api,
    health,
    endpoint: { url: discovery.url, token: discovery.token },
  };
}

export type FakeHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => boolean | void;

export async function startFake(
  options: {
    version: string;
    serverId?: string;
    instanceId?: string;
    token?: string;
    reviewIds?: string[];
    handle?: FakeHandler;
  },
  port = 0,
) {
  const requests: IncomingMessage[] = [];
  const token = options.token ?? "fake-token";

  const health: ReviewServerHealthWithToken = {
    ok: true,
    instanceId: options.instanceId ?? randomUUID(),
    serverId: options.serverId ?? randomUUID(),
    serverPid: process.pid,
    desktopAttached: false,
    version: options.version,
    commit: null,
  };

  const server: Server = createServer((request, response) => {
    requests.push(request);

    if (options.handle?.(request, response)) return;

    if (request.url === "/health") {
      const { ok, instanceId, desktopAttached, version } = health;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          request.headers["x-review-token"] === token
            ? health
            : { ok, instanceId, desktopAttached, version },
        ),
      );

      return;
    }

    const owned = options.reviewIds?.find((id) =>
      request.url?.startsWith(`/reviews-api/${id}`),
    );

    response.statusCode = owned ? 200 : 404;
    response.setHeader("content-type", "application/json");
    response.end(
      owned
        ? JSON.stringify({ reviewId: owned })
        : '{"ok":false,"error":"Review not found."}',
    );
  });

  server.listen(port, "127.0.0.1");
  await once(server, "listening");

  const stop = async () => {
    if (!server.listening) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  stops.push(stop);

  // SAFETY: a TCP listener's address() is an AddressInfo.
  const address = server.address() as AddressInfo;

  return {
    requests,
    health,
    stop,
    port: address.port,
    endpoint: { url: `http://127.0.0.1:${address.port}`, token },
  };
}

export async function startGateway(
  root: string,
  hosts: ReviewGatewayHost[],
  options: {
    version?: string;
    home?: string;
    relay?: ReviewDesktopVerbRelay;
    heartbeatMs?: number;
    languageContextMs?: number;
  } = {},
) {
  const home = options.home ?? path.join(root, "laptop");
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
  const localPaths: string[] = [];
  const relay = options.relay ?? new GlobalReviewDesktopVerbRelay();

  const gateway = createReviewGateway({
    local: (request) => {
      localPaths.push(new URL(request.url).pathname);

      return laptop.fetch(request);
    },
    version: options.version ?? version,
    home,
    relay,
    ...(options.heartbeatMs !== undefined && {
      heartbeatMs: options.heartbeatMs,
    }),
    ...(options.languageContextMs !== undefined && {
      languageContextMs: options.languageContextMs,
    }),
    log: (message) => logged.push(message),
  });

  gateway.setHosts(hosts);

  const server = createServer(getRequestListener(gateway.fetch));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await gateway.close();
    await local.data.close();
    await local.store.close();
  };

  stops.push(close);

  // SAFETY: a TCP listener's address() is an AddressInfo.
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const request = (route: string, init: RequestInit = {}) =>
    fetch(`${url}/reviews-api${route}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-review-token": "laptop-token",
        ...init.headers,
      },
    });

  const api = async <T>(route: string, init: RequestInit = {}): Promise<T> => {
    const response = await request(route, init);

    if (!response.ok)
      throw new Error(`${route}: ${response.status} ${await response.text()}`);

    // SAFETY: test helper; callers name the shape the route answers.
    return (await response.json()) as T;
  };

  return {
    gateway,
    local,
    direct: (route: string) =>
      laptop.fetch(new Request(`http://laptop${route}`)),
    request,
    api,
    close,
    logged,
    localPaths,
    url,
    relay,
  };
}

export async function repository(root: string) {
  const directory = path.join(root, `repo-${randomUUID()}`);
  await mkdir(directory, { recursive: true });

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
    }).trim();

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

export async function seed(
  api: <T>(route: string, init?: RequestInit) => Promise<T>,
  root: string,
  title: string,
  extra: { open?: boolean } = {},
) {
  const repo = await repository(root);

  const registered = await api<{ id: string }>("/repositories", {
    method: "POST",
    body: JSON.stringify({ path: repo.directory }),
  });

  const created = await api<Result>("/commands", {
    method: "POST",
    body: JSON.stringify({
      operation: {
        type: "create",
        title,
        target: {
          kind: "commits",
          repositoryId: registered.id,
          base: repo.base,
          head: repo.head,
        },
        ...extra,
      },
    }),
  });

  return created.reviewId;
}
