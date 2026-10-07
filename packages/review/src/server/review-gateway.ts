import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import {
  type JsonValue,
  REVIEW_CLIENT_HEADER,
  REVIEW_HOST_HEADER,
  type ReviewGatewayHost,
  type ReviewGatewayHostState,
  type ReviewRemoteNavigatorAnswer,
  isJsonObject,
  parseJsonText,
} from "@dev.fast/review-protocol";
import { Hono } from "hono";
import type { Dispatcher } from "undici";
import { z } from "zod";

import { StreamLimitError, readBoundedStream } from "./bounded-stream.js";
import type { ReviewDesktopVerbRelay } from "./global-verb-relay.js";
import { DEFAULT_MAX_REQUEST_BYTES } from "./http-json.js";
import {
  FIRST_BYTE_TIMEOUT_MS,
  type GatewayRemote,
  UUID,
  createGatewayHosts,
  errorCode,
  errorText,
  readBody,
  remoteHeaders,
  send,
} from "./review-gateway-hosts.js";
import { openGatewayMemory } from "./review-gateway-memory.js";
import { createGatewayPushes } from "./review-gateway-pushes.js";
import {
  type Located,
  createGatewayStreams,
  downDetail,
  isSnapshotOf,
  withoutTutorial,
} from "./review-gateway-streams.js";
import { serverJson } from "./review-server-core.js";

const LAPTOP_ROUTES = new Set([
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

interface RemoteRoute {
  method: string;
  path: string;
  /** May wait on preparing a checkout or launching an agent. */
  slow?: true;
  wholeBody?: true;
}

const REMOTE_ROUTES: readonly RemoteRoute[] = [
  { method: "GET", path: "" },
  { method: "GET", path: "progress" },
  { method: "POST", path: "progress" },
  { method: "GET", path: "commits" },
  { method: "GET", path: "diff" },
  { method: "GET", path: "structural-diff" },
  { method: "GET", path: "stack" },
  { method: "GET", path: "tree" },
  { method: "GET", path: "file", wholeBody: true },
  { method: "GET", path: "resources/:name" },
  { method: "GET", path: "maps/:name" },
  { method: "POST", path: "navigator", wholeBody: true },
  { method: "POST", path: "copy-context" },
  { method: "GET", path: "language-context", slow: true, wholeBody: true },
  { method: "GET", path: "ask/agents", wholeBody: true },
  {
    method: "GET",
    path: "ask/agents/:agent/offer",
    slow: true,
    wholeBody: true,
  },
  { method: "GET", path: "ask/mentions", slow: true, wholeBody: true },
  { method: "GET", path: "ask/threads", wholeBody: true },
  { method: "GET", path: "ask/:thread/watch" },
  { method: "POST", path: "ask", slow: true },
  {
    method: "POST",
    path: "ask/:thread/:action{open|choice|permissions}",
    slow: true,
  },
  {
    method: "POST",
    path: "ask/:thread/:action{prompt|permission|files|retry|cancel|close}",
  },
  { method: "DELETE", path: "ask/:thread" },
];

const SLOW_ROUTE_TIMEOUT_MS = 120_000;

const PATH_FIELDS = new Set([
  "localPath",
  "rootPath",
  "workspacePath",
  "filePath",
  "localRoot",
]);

const PATH_ROUTE_MAX_BYTES = 64 * 1024 * 1024;

const BODY_IDLE_MS = 10_000;

const BODY_MAX_MS = 120_000;

const STALLED = `its answer stalled for ${BODY_IDLE_MS / 1_000} seconds`;

const TOO_LONG = `its answer took longer than ${BODY_MAX_MS / 1_000} seconds`;

const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "te",
  "trailer",
  "upgrade",
]);

const DROPPED_RESPONSE_HEADERS = new Set(["location", "set-cookie"]);

const DROPPED_REQUEST_HEADERS = new Set([
  ...HOP_HEADERS,
  "host",
  "origin",
  "accept-encoding",
  "x-review-token",
  REVIEW_CLIENT_HEADER,
  REVIEW_HOST_HEADER,
]);

const remoteLanguageContext = z.object({
  remoteRootPath: z.string().nullable(),
  serverId: z.string(),
});

/** Absolute POSIX, no `..` segment, no control character or lone surrogate,
 * no `//`; a `:` before the first `/` (a scheme) is not absolute. */
const hostPath = z
  .string()
  .refine(
    (value) =>
      value.startsWith("/") &&
      value.isWellFormed() &&
      !value.includes("//") &&
      !/\p{Cc}/u.test(value) &&
      !value.split("/").includes(".."),
  );

const remoteNavigator = z.strictObject({
  workspacePath: hostPath,
  filePath: hostPath.optional(),
  emptySide: z.literal(true).optional(),
});

/** VS Code's `URI.toString()` path encoding: unreserved characters and `/`
 * stay, everything else is percent-encoded. */
const URI_PATH_KEPT = /[A-Za-z0-9\-._~/]/;

const commandTarget = z.object({
  operation: z.object({ reviewId: z.string().optional() }).optional(),
});

type Owner =
  | { remote: GatewayRemote }
  | { down: ReviewGatewayHostState }
  | undefined;

export function createReviewGateway(input: {
  local(request: Request): Response | Promise<Response>;
  version: string;
  home: string;
  relay: ReviewDesktopVerbRelay;
  heartbeatMs?: number;
  slowRouteMs?: number;
  restarted?(alias: string): void;
  log?(message: string): void;
}) {
  const log = input.log ?? (() => {});
  const memory = openGatewayMemory(input.home, log);
  let changing = false;
  let closed = false;

  const hosts = createGatewayHosts({
    version: input.version,
    log,
    remembered: (serverId) => memory.alias(serverId),
    machine: (serverId, alias) => memory.rename(serverId, alias),
    ...(input.heartbeatMs !== undefined && { heartbeatMs: input.heartbeatMs }),
    restarted: (alias) => input.restarted?.(alias),
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

  const laptopIds = new Set<string>();
  const lookups = new Map<string, Promise<Owner>>();
  const streaming = new Map<AbortController, GatewayRemote>();

  async function ownership(remote: GatewayRemote, reviewId: string) {
    try {
      const response = await send(remote, {
        method: "GET",
        path: `/reviews-api/${encodeURIComponent(reviewId)}/activity`,
        headers: remoteHeaders(remote),
      });

      await response.body.dump();

      return response.statusCode;
    } catch (error) {
      hosts.failed(remote, errorText(error));

      return undefined;
    }
  }

  async function onLaptop(reviewId: string) {
    if (laptopIds.has(reviewId)) return true;

    const laptop = await input.local(
      new Request(
        `http://gateway/reviews-api/${encodeURIComponent(reviewId)}/activity`,
      ),
    );

    await laptop.body?.cancel();

    if (laptop.ok) laptopIds.add(reviewId);

    return laptop.ok;
  }

  const order = () =>
    hosts
      .states()
      .flatMap(
        (state) => state.serverId ?? memory.serverIdOf(state.alias) ?? [],
      );

  async function lookup(reviewId: string): Promise<Owner> {
    const online = hosts.online();
    const found = Promise.withResolvers<Owner>();
    let owner: GatewayRemote | undefined;
    let left = online.length;

    if (!left) found.resolve(undefined);

    for (const remote of online)
      void ownership(remote, reviewId).then((status) => {
        left -= 1;

        if (status === 200 && remote.serverId !== undefined) {
          if (owner)
            log(
              `Review ${reviewId} is on ${owner.alias} and ${remote.alias}; ${owner.alias} keeps it.`,
            );
          else {
            owner = remote;
            memory.remember(
              remote.serverId,
              hosts.machineAlias(remote.serverId) ?? remote.alias,
              reviewId,
            );
            found.resolve({ remote });
          }
        }

        if (!left) found.resolve(undefined);
      });

    return found.promise;
  }

  function locate(reviewId: string): Located {
    if (!UUID.test(reviewId) || laptopIds.has(reviewId)) return "laptop";
    const known = memory.owner(reviewId, order());

    if (!known) return undefined;
    const remote = hosts.serving(known.serverId);

    if (remote) return { remote };
    const down = hosts.unavailable(known.serverId, known.alias);

    return down && { down };
  }

  async function ownerOf(reviewId: string): Promise<Owner> {
    if (UUID.test(reviewId)) await onLaptop(reviewId);
    const located = locate(reviewId);

    if (located === "laptop") return undefined;

    if (located && "remote" in located) {
      const { remote } = located;

      if (remote.serverId !== undefined)
        memory.remember(
          remote.serverId,
          hosts.machineAlias(remote.serverId) ?? remote.alias,
          reviewId,
        );

      return located;
    }

    if (located) return located;
    let pending = lookups.get(reviewId);

    if (!pending) {
      pending = lookup(reviewId).finally(() => lookups.delete(reviewId));
      lookups.set(reviewId, pending);
    }

    return pending;
  }

  function answer(
    alias: string,
    status: number,
    body: { ok: boolean; error?: string } | ReviewRemoteNavigatorAnswer,
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
    options: { reviewId: string; route?: RemoteRoute; body?: Buffer },
  ): Promise<Response> {
    const url = new URL(request.url);
    const { route } = options;
    const routePath = url.pathname.split("/").slice(3).join("/");

    // The laptop's token never leaves the laptop, in a header or the query.
    if (url.searchParams.has("token")) url.searchParams.delete("token");

    const headers: Record<string, string> = remoteHeaders(remote);

    request.headers.forEach((value, key) => {
      if (!DROPPED_REQUEST_HEADERS.has(key)) headers[key] = value;
    });

    const limit = route?.slow
      ? (input.slowRouteMs ?? SLOW_ROUTE_TIMEOUT_MS)
      : FIRST_BYTE_TIMEOUT_MS;

    const snapshotRequest =
      route?.path === "" && url.searchParams.get("full") === "true";

    const whole = snapshotRequest || route?.wholeBody === true;
    const abort = new AbortController();

    // SAFETY: Node's Request body is its own web stream; the DOM type only
    // names the same object.
    const stream = request.body as WebReadableStream | null;
    let response: Dispatcher.ResponseData;

    try {
      response = await send(remote, {
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers,
        body: options.body ?? (stream ? Readable.fromWeb(stream) : undefined),
        signal: AbortSignal.any([request.signal, abort.signal]),
        headersTimeout: limit,
        ...(whole && { bodyTimeout: BODY_IDLE_MS }),
      });
    } catch (error) {
      const timedOut = errorCode(error) === "UND_ERR_HEADERS_TIMEOUT";

      const reason = timedOut
        ? `it did not answer within ${limit / 1_000} seconds`
        : errorText(error);

      if (!route?.slow && !request.signal.aborted) hosts.failed(remote, reason);

      return answer(remote.alias, timedOut ? 504 : 502, {
        ok: false,
        error: `${remote.alias} did not answer: ${reason}.`,
      });
    }

    const status = response.statusCode;

    // A review server never redirects; a remote must not steer the UI.
    if (status >= 300 && status < 400 && status !== 304) {
      await response.body.dump();
      log(`Refused ${remote.alias}'s redirect (${status}).`);

      return answer(remote.alias, 502, {
        ok: false,
        error: `${remote.alias} answered with a redirect, so the answer was refused.`,
      });
    }

    if (status === 404) void confirmOwner(remote, options.reviewId);

    const out = new Headers();

    for (const [key, value] of Object.entries(response.headers))
      if (
        value !== undefined &&
        !HOP_HEADERS.has(key) &&
        !DROPPED_RESPONSE_HEADERS.has(key) &&
        !key.startsWith("access-control-")
      )
        out.set(key, Array.isArray(value) ? value.join(", ") : value);

    out.set(REVIEW_HOST_HEADER, remote.alias);

    const snapshot = snapshotRequest && status === 200;

    if (snapshot || route?.wholeBody) {
      let body: Buffer;

      try {
        body = await readBody(
          response.body,
          PATH_ROUTE_MAX_BYTES,
          AbortSignal.timeout(BODY_MAX_MS),
        );
      } catch (error) {
        const cut =
          errorCode(error) === "UND_ERR_BODY_TIMEOUT"
            ? STALLED
            : error instanceof DOMException && error.name === "TimeoutError"
              ? TOO_LONG
              : undefined;

        return answer(remote.alias, cut ? 504 : 502, {
          ok: false,
          error: `${remote.alias} did not answer: ${cut ?? errorText(error)}.`,
        });
      }

      if (snapshot) {
        const value = parseBody(body);

        if (isSnapshotOf(value, options.reviewId)) {
          const stripped = withoutTutorial(value);

          return new Response(
            stripped ? JSON.stringify(stripped) : new Uint8Array(body),
            { status, headers: out },
          );
        }

        log(
          `Refused ${remote.alias}'s answer for ${options.reviewId}: it carried another review.`,
        );

        return answer(remote.alias, 502, {
          ok: false,
          error: `${remote.alias} answered with another review, so the answer was refused.`,
        });
      }

      if (route?.path === "navigator" && status === 200) {
        const uris = navigatorUris(body, remote.serverId);

        if (uris) return answer(remote.alias, 200, uris);
        log(
          `Refused ${remote.alias}'s /navigator answer: a path or its server id is unusable.`,
        );

        return answer(remote.alias, 502, {
          ok: false,
          error: `${remote.alias} answered with an unusable path, so the answer was refused.`,
        });
      }

      const field = pathField(body);

      if (field) {
        log(
          `Refused ${remote.alias}'s /${routePath} answer: it carried ${field}.`,
        );

        return answer(remote.alias, 502, {
          ok: false,
          error: `${remote.alias} answered with a path on that machine, so the answer was refused.`,
        });
      }

      const unusable =
        route?.path === "language-context" && status === 200
          ? unusableLanguageContext(body, remote.serverId)
          : undefined;

      if (unusable) {
        log(`Refused ${remote.alias}'s /${routePath} answer: ${unusable}.`);

        return answer(remote.alias, 502, {
          ok: false,
          error: `${remote.alias} answered with an unusable language context, so the answer was refused.`,
        });
      }

      return new Response(new Uint8Array(body), { status, headers: out });
    }

    if (request.method === "HEAD" || status === 204 || status === 304) {
      await response.body.dump();

      return new Response(null, { status, headers: out });
    }

    streaming.set(abort, remote);
    response.body.on("close", () => streaming.delete(abort));

    // SAFETY: Node's Response takes its own web stream; the DOM type only
    // names the same object.
    const body = Readable.toWeb(response.body) as ReadableStream<Uint8Array>;

    return new Response(body, { status, headers: out });
  }

  async function confirmOwner(remote: GatewayRemote, reviewId: string) {
    if ((await ownership(remote, reviewId)) === 404) memory.forget(reviewId);
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

    if (!owner || reviewId === undefined)
      return input.local(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: new Uint8Array(body),
          signal: request.signal,
        }),
      );

    if ("down" in owner) return unavailable(owner.down);

    return forward(owner.remote, request, { reviewId, body });
  }

  async function review(
    request: Request,
    reviewId: string,
    route?: RemoteRoute | "telemetry",
  ): Promise<Response> {
    if (!reviewId || LAPTOP_ROUTES.has(reviewId)) return input.local(request);
    const owner = await ownerOf(reviewId);

    if (!owner) {
      const response = await input.local(request);

      if (response.status === 404) laptopIds.delete(reviewId);

      return response;
    }

    const alias = "remote" in owner ? owner.remote.alias : owner.down.alias;

    if (route === "telemetry") {
      await request.body?.cancel();

      return answer(alias, 200, { ok: true });
    }

    if (!route)
      return answer(alias, 404, {
        ok: false,
        error: "This route is not available for a review on another machine.",
      });

    if ("down" in owner) return unavailable(owner.down);

    return forward(owner.remote, request, { reviewId, route });
  }

  const app = new Hono({ strict: false }).basePath("/reviews-api");

  app.post("/commands", (context) => command(context.req.raw));
  app.get("/", (context) => streams.list(context.req.raw));
  app.get("/watch", (context) => streams.watch(context.req.raw));
  app.all("/:id/telemetry/*", (context) =>
    review(context.req.raw, context.req.param("id"), "telemetry"),
  );

  for (const route of REMOTE_ROUTES)
    app.on(route.method, `/:id${route.path && `/${route.path}`}`, (context) =>
      review(context.req.raw, context.req.param("id") ?? "", route),
    );

  for (const path of ["/:id", "/:id/*"])
    app.all(path, (context) =>
      review(context.req.raw, context.req.param("id") ?? ""),
    );

  app.all("*", (context) => input.local(context.req.raw));

  const streams = createGatewayStreams({
    hosts,
    memory,
    local: input.local,
    locate,
    lookup: ownerOf,
    onLaptop: (reviewId) => laptopIds.add(reviewId),
    log,
  });

  async function claim(remote: GatewayRemote, reviewId: string) {
    if (await onLaptop(reviewId)) return `${reviewId} belongs to the laptop.`;
    const known = memory.owner(reviewId, order());

    if (known && known.serverId !== remote.serverId)
      return `${reviewId} belongs to ${known.alias}.`;

    if (remote.serverId === undefined)
      return `${remote.alias} has not reported its server id.`;

    memory.remember(
      remote.serverId,
      hosts.machineAlias(remote.serverId) ?? remote.alias,
      reviewId,
    );

    return undefined;
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
    fetch: (request: Request) => app.fetch(request),
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

function unusableLanguageContext(body: Buffer, serverId: string | undefined) {
  const context = remoteLanguageContext.safeParse(
    parseJsonText(body.toString()),
  );

  if (!context.success) return "its remoteRootPath or serverId is malformed";

  if (context.data.serverId !== serverId) return "it names another server";

  return undefined;
}

/** The remote navigator's host paths as `vscode-remote` URIs on its
 * `whiteboard+<serverId>` authority, as the fork's `reviewRemoteAuthority`
 * names it. */
function navigatorUris(
  body: Buffer,
  serverId: string | undefined,
): ReviewRemoteNavigatorAnswer | undefined {
  const parsed = remoteNavigator.safeParse(parseBody(body));

  if (!parsed.success || !serverId || !/^[0-9a-z-]+$/i.test(serverId))
    return undefined;
  const { workspacePath, filePath, emptySide } = parsed.data;
  const remoteAuthority = `whiteboard+${serverId.toLowerCase()}`;

  const uri = (host: string) =>
    `vscode-remote://${remoteAuthority}${uriPath(host)}`;

  return {
    workspaceUri: uri(workspacePath),
    ...(filePath !== undefined && { fileUri: uri(filePath) }),
    remoteAuthority,
    ...(emptySide && { emptySide }),
  };
}

function uriPath(value: string) {
  let out = "";

  for (const char of value)
    out += URI_PATH_KEPT.test(char)
      ? char
      : encodeURIComponent(char).replace(
          /[!'()*]/g,
          (kept) => `%${kept.charCodeAt(0).toString(16).toUpperCase()}`,
        );

  return out;
}

function pathField(body: Buffer): string | undefined {
  const value = parseBody(body);

  if (value === undefined) return "an unreadable body";
  const pending = [value];

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (Array.isArray(next)) pending.push(...next);
    else if (isJsonObject(next))
      for (const [key, item] of Object.entries(next)) {
        if (PATH_FIELDS.has(key)) return key;
        pending.push(item);
      }
  }

  return undefined;
}

function parseBody(body: Buffer): JsonValue | undefined {
  try {
    return parseJsonText(body.toString());
  } catch {
    return undefined;
  }
}
