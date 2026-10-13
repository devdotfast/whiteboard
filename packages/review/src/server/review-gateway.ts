import type http from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import {
  REVIEW_CLIENT_HEADER,
  REVIEW_HOST_HEADER,
  type ReviewGatewayHost,
  type ReviewGatewayHostState,
  parseJsonText,
} from "@dev.fast/review-protocol";
import { z } from "zod";

import { StreamLimitError, readBoundedStream } from "./bounded-stream.js";
import type { ReviewDesktopVerbRelay } from "./global-verb-relay.js";
import { DEFAULT_MAX_REQUEST_BYTES } from "./http-json.js";
import {
  FIRST_BYTE_TIMEOUT_MS,
  type GatewayRemote,
  NO_ANSWER,
  UUID,
  createGatewayHosts,
  errorText,
  remoteHeaders,
  send,
} from "./review-gateway-hosts.js";
import { type ListSource, listedBy } from "./review-gateway-list.js";
import { openGatewayMemory } from "./review-gateway-memory.js";
import { createGatewayPushes } from "./review-gateway-pushes.js";
import {
  type Located,
  createGatewayStreams,
  downDetail,
} from "./review-gateway-streams.js";
import { serverJson } from "./review-server-core.js";

const LOCAL_ROUTES = new Set([
  "repositories",
  "resources",
  "workspace-cleanup",
  "authoring",
  "capabilities",
  "status",
  "instructions",
  "sharing",
  "commands",
]);

const FORWARDED_ROUTES: readonly (readonly [string, RegExp])[] = [
  ["GET", /^$/],
  ["GET", /^progress$/],
  ["POST", /^progress$/],
  ["GET", /^commits$/],
  ["GET", /^diff$/],
  ["GET", /^structural-diff$/],
  ["GET", /^stack$/],
  ["GET", /^tree$/],
  ["GET", /^file$/],
  ["GET", /^resources\/[^/]+$/],
  ["GET", /^maps\/[^/]+$/],
  ["POST", /^navigator$/],
  ["POST", /^copy-context$/],
];

const LIST_WAIT_MS = 2_000;

const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "te",
  "trailer",
  "upgrade",
]);

const DROPPED_REQUEST_HEADERS = new Set([
  ...HOP_HEADERS,
  "host",
  "origin",
  "accept-encoding",
  "cookie",
  "authorization",
  "x-review-token",
  REVIEW_CLIENT_HEADER,
  REVIEW_HOST_HEADER,
]);

const commandTarget = z.object({
  operation: z.object({ reviewId: z.string().optional() }).optional(),
});

export function createReviewGateway(input: {
  local(request: Request): Response | Promise<Response>;
  isLocal(reviewId: string): boolean;
  version: string;
  home: string;
  relay: ReviewDesktopVerbRelay;
  heartbeatMs?: number;
  log?(message: string): void;
}) {
  const log = input.log ?? (() => {});
  const memory = openGatewayMemory(input.home, log);
  let changing = false;
  let closed = false;

  const hosts = createGatewayHosts({
    version: input.version,
    log,
    machine: (serverId, alias) => memory.rename(serverId, alias),
    ...(input.heartbeatMs !== undefined && { heartbeatMs: input.heartbeatMs }),
    changed() {
      if (changing) return;
      changing = true;
      queueMicrotask(() => {
        changing = false;

        if (closed) return;
        const online = new Set(hosts.online());

        for (const [abort, remote] of streaming)
          if (!online.has(remote)) abort.abort();
        streams.changed();
        pushes.changed();
      });
    },
  });

  const streaming = new Map<AbortController, GatewayRemote>();
  const waiting = new Set<() => void>();

  const lists = (): ListSource => ({
    states: hosts.states(),
    serving: (serverId) => hosts.serving(serverId) !== undefined,
    serverIdOf: memory.serverIdOf,
    list: memory.list,
  });

  function locate(reviewId: string): Located {
    if (!UUID.test(reviewId) || input.isLocal(reviewId)) return "local";
    const listed = listedBy(reviewId, lists());

    if (!listed) return undefined;
    const remote = hosts.serving(listed.serverId);

    return remote ? { remote } : { down: listed.state };
  }

  // A review just created on a host may not be on its list yet.
  function ownerOf(reviewId: string): Located | Promise<Located> {
    const located = locate(reviewId);

    if (located !== undefined || !hosts.online().length) return located;
    const found = Promise.withResolvers<Located>();

    const settle = (owner: Located) => {
      clearTimeout(timer);
      waiting.delete(check);
      found.resolve(owner);
    };

    const check = () => {
      const owner = locate(reviewId);

      if (owner !== undefined) settle(owner);
    };

    const timer = setTimeout(() => settle(undefined), LIST_WAIT_MS);
    waiting.add(check);

    return found.promise;
  }

  function answer(
    alias: string,
    status: number,
    body: { ok: boolean; error?: string },
  ) {
    const response = serverJson(status, body);
    response.headers.set(REVIEW_HOST_HEADER, alias);

    return response;
  }

  function unavailable(down: ReviewGatewayHostState) {
    return answer(down.alias, 503, { ok: false, error: downDetail(down) });
  }

  async function forward(
    remote: GatewayRemote,
    request: Request,
    body?: Buffer,
  ): Promise<Response> {
    const url = new URL(request.url);

    // The local token never leaves this machine, in a header or the query.
    if (url.searchParams.has("token")) url.searchParams.delete("token");

    const headers: http.OutgoingHttpHeaders = remoteHeaders(remote);

    request.headers.forEach((value, key) => {
      if (!DROPPED_REQUEST_HEADERS.has(key)) headers[key] = value;
    });

    const abort = new AbortController();
    const leave = () => abort.abort();
    request.signal.addEventListener("abort", leave, { once: true });

    let timedOut = false;

    const firstByte = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, FIRST_BYTE_TIMEOUT_MS);

    // SAFETY: Node's Request body is its own web stream; the DOM type only
    // names the same object.
    const stream = request.body as WebReadableStream | null;
    let response: http.IncomingMessage;

    try {
      response = await send(remote, {
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers,
        body: body ?? (stream ? Readable.fromWeb(stream) : undefined),
        signal: abort.signal,
      });
    } catch (error) {
      request.signal.removeEventListener("abort", leave);

      const reason = timedOut ? NO_ANSWER : errorText(error);

      if (!request.signal.aborted) hosts.failed(remote, reason);

      return answer(remote.alias, timedOut ? 504 : 502, {
        ok: false,
        error: `${remote.alias} did not answer: ${reason}.`,
      });
    } finally {
      clearTimeout(firstByte);
    }

    response.on("close", () =>
      request.signal.removeEventListener("abort", leave),
    );

    const status = response.statusCode ?? 502;
    const out = new Headers();

    for (const [key, value] of Object.entries(response.headers))
      if (
        value !== undefined &&
        !HOP_HEADERS.has(key) &&
        !key.startsWith("access-control-")
      )
        out.set(key, Array.isArray(value) ? value.join(", ") : value);

    out.set(REVIEW_HOST_HEADER, remote.alias);

    if (request.method === "HEAD" || status === 204 || status === 304) {
      response.resume();

      return new Response(null, { status, headers: out });
    }

    streaming.set(abort, remote);
    response.on("close", () => streaming.delete(abort));

    // SAFETY: Node's Response takes its own web stream; the DOM type only
    // names the same object.
    const piped = Readable.toWeb(response) as ReadableStream<Uint8Array>;

    return new Response(piped, { status, headers: out });
  }

  async function command(request: Request): Promise<Response> {
    if (!request.body) return input.local(request);
    let body: Buffer;

    try {
      body = await readBoundedStream(request.body, DEFAULT_MAX_REQUEST_BYTES);
    } catch (error) {
      if (!(error instanceof StreamLimitError)) throw error;

      return serverJson(413, {
        ok: false,
        error: "Request body exceeds 1 MiB.",
      });
    }

    let reviewId: string | undefined;

    try {
      reviewId = commandTarget.safeParse(parseJsonText(body.toString())).data
        ?.operation?.reviewId;
    } catch {}

    const owner = reviewId === undefined ? undefined : await ownerOf(reviewId);

    if (owner === undefined || owner === "local")
      return input.local(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: new Uint8Array(body),
          signal: request.signal,
        }),
      );

    if ("down" in owner) return unavailable(owner.down);

    return forward(owner.remote, request, body);
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    const [first = "", ...rest] = url.pathname
      .slice("/reviews-api/".length)
      .split("/");

    if (first === "commands" && !rest.length && request.method === "POST")
      return command(request);

    if (request.method === "GET" && !rest.length) {
      if (first === "") return streams.list(request);

      if (first === "watch") return streams.watch(request);
    }

    let reviewId: string;

    try {
      reviewId = decodeURIComponent(first);
    } catch {
      return input.local(request);
    }

    if (!reviewId || LOCAL_ROUTES.has(reviewId)) return input.local(request);
    const owner = await ownerOf(reviewId);

    if (owner === undefined || owner === "local") return input.local(request);

    const route = rest.join("/");
    const alias = "remote" in owner ? owner.remote.alias : owner.down.alias;

    if (route.startsWith("telemetry/")) {
      await request.body?.cancel();

      return answer(alias, 200, { ok: true });
    }

    if (
      !FORWARDED_ROUTES.some(
        ([method, pattern]) => method === request.method && pattern.test(route),
      )
    )
      return answer(alias, 404, {
        ok: false,
        error: "This route is not available for a review on another machine.",
      });

    if ("down" in owner) return unavailable(owner.down);

    return forward(owner.remote, request);
  }

  const streams = createGatewayStreams({
    hosts,
    memory,
    local: input.local,
    lists,
    locate,
    listed() {
      for (const check of waiting) check();
    },
  });

  async function claim(remote: GatewayRemote, reviewId: string) {
    if ((await ownerOf(reviewId)) === undefined)
      return `${reviewId} is not on ${remote.alias}'s list.`;
  }

  const pushes = createGatewayPushes({
    hosts,
    relay: input.relay,
    claim,
    log,
  });

  const stopWatchingWindows = input.relay.onAttachedChange?.(() => {
    if (!closed) pushes.changed();
  });

  return {
    fetch: handle,
    setHosts: (list: ReviewGatewayHost[]) => hosts.set(list),
    hosts: () => hosts.states(),
    async close() {
      closed = true;
      stopWatchingWindows?.();
      streams.close();
      pushes.close();
      hosts.close();
      await memory.flush();
    },
  };
}

export type ReviewGateway = ReturnType<typeof createReviewGateway>;
