import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";
import type { AddressInfo } from "node:net";

import type { ReviewServerHealth } from "@dev.fast/review-protocol";
import type { ReviewServerDiscovery } from "@review/server-discovery.js";

import { runHeadlessServer } from "./headless-host.js";

/** Every server a test starts; `stopAll` in afterEach, also after a failure. */
const stops: (() => Promise<void>)[] = [];

export async function stopAll() {
  await Promise.allSettled(stops.splice(0).map((stop) => stop()));
}

/** A real headless review server on a loopback port. */
export async function startRemote(stateDir: string) {
  const controller = new AbortController();
  const ready = Promise.withResolvers<ReviewServerDiscovery>();

  const running = runHeadlessServer({
    stateDir,
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
    // SAFETY: /health answers ReviewServerHealth on every review server.
    (await (
      await fetch(`${discovery.url}/health`)
    ).json()) as ReviewServerHealth;

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

/**
 * A review server stand-in. `handle` sees every request first (true =
 * handled); /health and ownership of `reviewIds` then answer as a real
 * server would.
 */
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

  const health: ReviewServerHealth = {
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
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(health));

      return;
    }

    const owned = options.reviewIds?.some((id) =>
      request.url?.startsWith(`/reviews-api/${id}`),
    );

    response.statusCode = owned ? 200 : 404;
    response.setHeader("content-type", "application/json");
    response.end(owned ? "{}" : '{"ok":false,"error":"Review not found."}');
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
