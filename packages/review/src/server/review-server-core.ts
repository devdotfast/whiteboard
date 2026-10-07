import type { JsonObject } from "@dev.fast/json";
import type {
  ReviewServerHealth,
  ReviewServerHealthWithToken,
} from "@dev.fast/review-protocol";
import { traceMachineEnabled } from "@dev.fast/trace-core";
import { detectAskAgents, launchAskAgent } from "@review/ask/agents.js";
import { AskThreads, type AskTools } from "@review/ask/threads.js";
import {
  readBuildCommit,
  readReviewPackageVersion,
} from "@review/package-paths.js";
import { ReviewInputError } from "@review/review-api/document.js";
import {
  type AuthoringCapabilities,
  type ReviewApiHooks,
  createReviewApi,
} from "@review/review-api/http.js";
import type { LocalReviewData } from "@review/review-api/local-data.js";
import type { ReviewStore } from "@review/review-api/store.js";
import { mountSharingPublisher } from "@review/sharing/host.js";
import type { SharedReviewStore } from "@review/sharing/import.js";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ReviewDesktopVerbRelay } from "./global-verb-relay";
import {
  type ReviewHonoEnv,
  applyCorsHeaders,
  corsPreflightResponse,
  isAuthorizedRequest,
  jsonResponse,
  readBoundedRequestJson,
} from "./hono-http";
import { HttpJsonError, ReviewServerError } from "./http-json";

const version = readReviewPackageVersion(import.meta.url);

const commit = readBuildCommit(import.meta.url);

/**
 * What every review server shares: CORS, an open /health, token auth, and
 * the /control relay a Desktop attaches to, with errors answered as JSON.
 * Callers add their routes after.
 */
export function createReviewServerApp(input: {
  token: string;
  instanceId: string;
  /** The review store's `serverId()`. */
  serverId: string;
  relay: ReviewDesktopVerbRelay;
}): Hono<ReviewHonoEnv> {
  const app = new Hono<ReviewHonoEnv>();
  app.use("*", async (context, next) => {
    await next();
    applyCorsHeaders(context.req.raw, context.res);
  });
  app.options("*", (context) => corsPreflightResponse(context.req.raw));
  // Open to any caller, but the stable ids only to one holding the token.
  app.get("/health", (context) => {
    const health: ReviewServerHealth = {
      ok: true,
      instanceId: input.instanceId,
      desktopAttached: input.relay.attached,
      version,
    };

    return serverJson(
      200,
      isAuthorizedRequest(context.req.raw, input.token)
        ? ({
            ...health,
            serverId: input.serverId,
            serverPid: process.pid,
            commit,
          } satisfies ReviewServerHealthWithToken)
        : health,
    );
  });
  app.use("*", async (context, next) => {
    if (!isAuthorizedRequest(context.req.raw, input.token)) {
      return serverJson(401, { ok: false, error: "Unauthorized" });
    }

    await next();
  });
  app.get("/control", (context) => openControlEvents(context, input.relay));
  app.post("/control/result", async (context) => {
    const accepted = input.relay.acceptResult(
      await readBoundedRequestJson(context.req.raw),
    );

    return serverJson(accepted ? 200 : 404, { ok: accepted });
  });
  answerErrorsAsJson(app);

  return app;
}

export function answerErrorsAsJson(app: Hono<ReviewHonoEnv>) {
  app.notFound(() => serverJson(404, { ok: false, error: "Not found." }));
  app.onError((error) => {
    const serverError = error instanceof ReviewServerError ? error : undefined;

    const message = toError(error).message;

    return serverJson(
      serverError?.statusCode ?? httpJsonStatus(error),
      serverError?.code
        ? { ok: false, code: serverError.code, error: message }
        : { ok: false, error: message },
    );
  });
}

export interface WhiteboardCoreInput {
  profile: {
    store: ReviewStore;
    data: LocalReviewData;
    shared?: SharedReviewStore;
  };
  relay: ReviewDesktopVerbRelay;
  token: string;
  instanceId: string;
  softwareMapEnabled?: boolean;
  scratchpad: () => boolean;
  status: () => JsonObject;
  hooks?: ReviewApiHooks;
  ask?: { tools: AskTools };
}

export function createWhiteboardCore(input: WhiteboardCoreInput) {
  const { store, data, shared } = input.profile;

  const app = createReviewServerApp({
    token: input.token,
    instanceId: input.instanceId,
    serverId: store.serverId(),
    relay: input.relay,
  });

  const callbacks = relayReviewCallbacks(input.relay, input.softwareMapEnabled);

  const askThreads =
    input.ask && new AskThreads(launchAskAgent, input.ask.tools);

  const api = createReviewApi(
    store,
    data,
    callbacks.open,
    shared,
    callbacks.capabilities,
    input.scratchpad,
    () => traceMachineEnabled(),
    input.status,
    input.hooks,
    askThreads && { threads: askThreads, agents: () => detectAskAgents() },
  );

  // A shared store mounts the publisher with the rest of sharing.
  if (!shared) mountSharingPublisher(api, store, data);

  return { app, api, close: () => askThreads?.closeAll() };
}

/** The Desktop callbacks `createReviewApi` takes, answered over the relay. */
export function relayReviewCallbacks(
  relay: ReviewDesktopVerbRelay,
  softwareMapEnabled = false,
) {
  return {
    async open(review: {
      reviewId: string;
      title: string;
    }): Promise<{ softwareMapEnabled: boolean }> {
      const result = await relay.dispatch({
        name: "openApiReview",
        args: review,
      });

      if (!result.ok) throw new ReviewInputError(result.error, 409);

      return z.object({ softwareMapEnabled: z.boolean() }).parse(result.result);
    },
    async capabilities(): Promise<
      Omit<AuthoringCapabilities, "scratchpadEnabled">
    > {
      if (!relay.attached)
        return { desktopAvailable: false, softwareMapEnabled };

      const result = await relay.dispatch({
        name: "authoringCapabilities",
        args: {},
      });

      if (!result.ok) throw new ReviewInputError(result.error, 409);

      return {
        desktopAvailable: true,
        ...z.object({ softwareMapEnabled: z.boolean() }).parse(result.result),
      };
    },
  };
}

function openControlEvents(
  context: Context<ReviewHonoEnv>,
  relay: ReviewDesktopVerbRelay,
): Response {
  let attached = false;

  const response = streamSSE(context, async (output) => {
    let finish!: () => void;

    const disconnected = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const abort = new AbortController();

    let pending: Promise<void> = output
      .write(": attached\n\n")
      .then(() => undefined);

    const writer = {
      signal: abort.signal,
      write(frame: string) {
        pending = pending.then(async () => {
          await output.write(frame);
        });
      },
      close() {
        finish();
        void output.close();
      },
    };

    output.onAbort(() => {
      abort.abort();
      finish();
    });
    attached = relay.attach(writer);

    if (!attached) {
      finish();

      return;
    }

    try {
      await disconnected;
      await pending;
    } finally {
      abort.abort();
    }
  });

  if (!attached) {
    void response.body?.cancel();

    // A new Response: one built on the stream's context would keep its
    // chunked framing beside a Content-Length.
    return serverJson(409, {
      ok: false,
      error: "This server has no room for another Whiteboard Desktop.",
    });
  }

  // Never reused: a kept-alive socket would hold shutdown open after the
  // relay ends the stream.
  response.headers.set("connection", "close");
  response.headers.set("cache-control", "no-cache, no-transform");
  response.headers.set("content-type", "text/event-stream; charset=utf-8");

  return response;
}

export function serverJson<T>(status: number, body: T): Response {
  // SAFETY: callers pass 2xx/4xx/5xx codes (literals, ReviewServerError and
  // HttpJsonError statusCode); none is a bodyless 1xx/204/205/304 status.
  return jsonResponse(body, status as ContentfulStatusCode, {
    cacheControl: "no-store",
  });
}

function httpJsonStatus(cause: unknown): number {
  return cause instanceof HttpJsonError ? cause.statusCode : 400;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
