import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { jsonString } from "@dev.fast/json";
import {
  type JsonObject,
  type JsonValue,
  REVIEW_DESKTOP_DISCOVERY_VERSION,
  type ReviewCliInstallApplyResponse,
  ReviewConnectRequestSchema,
  type ReviewDesktopDiscovery,
  type ReviewGatewayHost,
  isJsonObject,
  isObjectValue,
  parseReviewCliInstallApplyRequest,
  reviewDiffrSummarizerInputSchema,
} from "@dev.fast/review-protocol";
import { shellQuote, writePrivateJsonAtomic } from "@dev.fast/trace-core";
import { connectAgent, detectConnectAgents } from "@review/agent-connect";
import { type AskTools, cliAskTools } from "@review/ask/threads.js";
import {
  applyCliInstall,
  declineCliInstall,
  finishCliInstallUpdate,
  pathShimPath,
  removeCliInstall,
  removeLegacyReviewSkills,
  resetCliInstall,
  resolveCliInstallStatus,
  skipCliInstall,
} from "@review/cli-install";
import {
  REVIEW_INSTANCE_ENV,
  type ReviewInstanceIdentity,
} from "@review/desktop-discovery";
import { readReviewPackageVersion } from "@review/package-paths";
import type { LocalReviewData } from "@review/review-api/local-data.js";
import { pullRequestProvider } from "@review/review-api/provider.js";
import type { ReviewStore } from "@review/review-api/store.js";
import {
  devReviewHome,
  reviewInstanceDiscoveryPath,
  reviewLegacyDiscoveryPath,
} from "@review/review-home-paths";
import {
  ReviewTelemetry,
  type ReviewTelemetryContext,
} from "@review/review-telemetry";
import type { SharedReviewStore } from "@review/sharing/import.js";
import { Hono } from "hono";
import { z } from "zod";

import { aliasInstallationToAccount } from "./account-alias";
import { CrashReportRequestSchema, reportCrashDump } from "./crash-report";
import {
  migrateDiffrConfig,
  readDiffrConfig,
  saveDiffrSummarizer,
  setDiffrConfigValue,
  testDiffrSummarizer,
} from "./diffr-config";
import {
  GlobalReviewDesktopVerbRelay,
  type ReviewDesktopVerbRelay,
} from "./global-verb-relay";
import {
  type ReviewHonoEnv,
  createNodeRequestListener,
  readBoundedRequestJson,
} from "./hono-http";
import { ReviewServerError } from "./http-json";
import {
  captureReviewUiEvent,
  createJsonReviewReporting,
} from "./json-review-reporting";
import { createReviewGateway } from "./review-gateway";
import { reviewLifecycleTelemetry } from "./review-lifecycle-telemetry";
import { ReviewOpenWatchdog } from "./review-open-watchdog";
import {
  answerErrorsAsJson,
  createWhiteboardCore,
  serverJson,
} from "./review-server-core";
import { invalidateStructuralComparisons } from "./structural-comparisons.js";
import { captureSanitizedUiTelemetry } from "./ui-telemetry";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GlobalReviewServerInput {
  /** The desktop host owns this shared database and closes it after the server. */
  reviewStore: ReviewStore;
  sharedReviews?: SharedReviewStore;
  reviewData: LocalReviewData;
  appPid: number;
  packageRoot: string;
  toolingRoot: string;
  cliRuntimePath?: string;
  port: number;
  token?: string;
  instanceId?: string;
  identity?: ReviewInstanceIdentity;
  discoveryPath?: string;
  telemetry?: ReviewTelemetry;
  relay?: ReviewDesktopVerbRelay;
  /** Electron's Review crash dump directory; `/crash-reports` reads only inside it. */
  crashDumpsDir?: string;
  onRemoteHostRestarted?(alias: string): void;
  log?(message: string): void;
}

export interface GlobalReviewServer {
  readonly discovery: ReviewDesktopDiscovery;
  readonly url: string;
  listen(): Promise<void>;
  close(reason?: "app-exit"): Promise<void>;
  setRemoteHosts(hosts: ReviewGatewayHost[]): void;
}

export function createGlobalReviewServer(
  input: GlobalReviewServerInput,
): GlobalReviewServer {
  const instanceId = input.instanceId ?? crypto.randomUUID();
  const token = input.token ?? crypto.randomBytes(32).toString("base64url");
  // Port 0 asks the OS to choose, so nothing may assume the requested port is
  // the bound one until listen() has resolved.
  let boundPort = input.port;
  const urlForBoundPort = () => `http://127.0.0.1:${boundPort}`;
  const identity = input.identity ?? { key: "stable", channel: "stable" };

  // Stable also writes the pre-instance server.json, so a CLI or shim that
  // predates instances still finds it.
  const discoveryPaths = input.discoveryPath
    ? [input.discoveryPath]
    : identity.key === "stable"
      ? [reviewInstanceDiscoveryPath("stable"), reviewLegacyDiscoveryPath()]
      : [reviewInstanceDiscoveryPath(identity.key)];

  const telemetry = input.telemetry ?? ReviewTelemetry.fromEnv();

  // Each window attaches its own stream; one at a time keeps a verb from
  // opening in every window, and the next takes over when it goes.
  const relay =
    input.relay ?? new GlobalReviewDesktopVerbRelay({ maxClients: 1 });

  const askTools = cliAskTools(() => discovery.cliPath, {
    name: REVIEW_INSTANCE_ENV,
    value: identity.key,
  });

  const reviewStore = input.reviewStore;

  // A reload or a second window starts the workbench again, but the launch
  // this server belongs to became ready once.
  let appReadyReported = false;

  const openWatchdog = new ReviewOpenWatchdog({
    onTimeout: (context, elapsedMs) =>
      void telemetry.captureEvent(
        "review_open_timeout",
        { elapsed_ms: elapsedMs },
        context,
      ),
  });

  let closing = false;
  const cliPath = path.join(input.packageRoot, "dist", "cli.js");

  const discovery: ReviewDesktopDiscovery = {
    version: REVIEW_DESKTOP_DISCOVERY_VERSION,
    instanceId,
    url: urlForBoundPort(),
    appPid: input.appPid,
    serverPid: process.pid,
    token,
    startedAt: Date.now(),
    ...identity,
  };

  // A source-run dev server has no built CLI to advertise.
  if (existsSync(cliPath)) {
    discovery.cliPath = cliPath;
    discovery.cliVersion = readReviewPackageVersion(
      pathToFileURL(cliPath).href,
    );

    if (input.cliRuntimePath && existsSync(input.cliRuntimePath)) {
      discovery.cliRuntimePath = input.cliRuntimePath;
    }
  }

  const core = createWhiteboardCore({
    profile: {
      store: reviewStore,
      data: input.reviewData,
      shared: input.sharedReviews,
    },
    relay,
    token,
    instanceId,
    status: () => {
      const { key, channel, checkout, appVersion, cliVersion, instanceId } =
        discovery;

      return {
        key: key ?? null,
        channel: channel ?? null,
        checkout: checkout ?? null,
        appVersion: appVersion ?? null,
        cliVersion: cliVersion ?? null,
        instanceId,
        url: urlForBoundPort(),
        home: devReviewHome(),
      };
    },
    hooks: reviewLifecycleTelemetry(
      telemetry,
      (reviewId) => reviewStore.summary(reviewId)?.firstCreatedAt,
      () => aliasInstallationToAccount(telemetry),
    ),
    ask: { tools: askTools },
  });

  const { app } = core;

  const localApi = new Hono<ReviewHonoEnv>();
  answerErrorsAsJson(localApi);

  localApi.route(
    "/reviews-api",
    createJsonReviewReporting(input.reviewStore, telemetry, {
      shared: input.sharedReviews,
    }),
  );

  localApi.route("/reviews-api", core.api);

  const gateway = createReviewGateway({
    local: (request) => localApi.fetch(request),
    isLocal: (reviewId) => reviewStore.has(reviewId),
    version: readReviewPackageVersion(import.meta.url),
    home: devReviewHome(),
    relay,
    restarted: (alias) => input.onRemoteHostRestarted?.(alias),
    remoteEvent: (request, reviewId) =>
      captureReviewUiEvent(telemetry, request, reviewId),
    log: input.log,
  });

  app.all("/reviews-api", (context) => gateway.fetch(context.req.raw));
  app.all("/reviews-api/*", (context) => gateway.fetch(context.req.raw));
  app.get("/remote-hosts", () => serverJson(200, gateway.hosts()));
  app.post("/app/focus", async () => {
    const result = await relay.dispatch({
      name: "focusWindow",
      args: {},
    });

    return serverJson(result.ok ? 200 : 409, result);
  });
  app.post("/telemetry/event", async (context) => {
    try {
      const body = await readBoundedRequestJson(context.req.raw, undefined, {});
      const payload: JsonObject = isJsonObject(body) ? body : {};
      let flushBeforeOptOut = false;

      if (payload.name === "app_ready") {
        if (appReadyReported) return serverJson(200, { ok: true });

        appReadyReported = true;
      }

      // The workbench has no reader on the stored review; the server does, so
      // `session_started`'s source_kind is filled in here rather than trusted
      // from the client.
      const eventProperties: JsonObject = isJsonObject(payload.properties)
        ? { ...payload.properties }
        : {};

      if (payload.name === "session_started") {
        // Both are server-derived only: a client can never assert its own
        // source_kind or agent_kind, so a review the store cannot resolve
        // must not fall back to whatever the client sent.
        delete eventProperties.source_kind;
        delete eventProperties.agent_kind;

        const rawContext = isJsonObject(payload.context) ? payload.context : {};

        const reviewUuid = jsonString(rawContext.reviewUuid);

        Object.assign(
          eventProperties,
          sessionStartedSource(reviewStore, reviewUuid),
        );

        if (reviewUuid) eventProperties.remote = gateway.isRemote(reviewUuid);
      }

      await captureSanitizedUiTelemetry(
        telemetry,
        context.req.raw,
        payload.name,
        eventProperties,
        (event, eventContext) => {
          flushBeforeOptOut =
            event.event === "review_setting_changed" &&
            event.properties.setting === "telemetry_enabled" &&
            event.properties.enabled === false;
          watchSessionOpen(openWatchdog, event.event, eventContext);
        },
        payload.error,
        payload.context,
        payload.occurredAt,
      );

      if (flushBeforeOptOut) await telemetry.flush(500);
    } catch (error) {
      console.error(error);
    }

    return serverJson(200, { ok: true });
  });
  app.post("/crash-reports", async (context) => {
    const body = CrashReportRequestSchema.safeParse(
      await readBoundedRequestJson(context.req.raw),
    );

    if (!body.success)
      throw new ReviewServerError(
        "dump_path, crashed_at and covered are required.",
        400,
      );

    const result = await reportCrashDump(
      telemetry,
      body.data,
      input.crashDumpsDir,
    );

    return serverJson(result.status, result.body);
  });
  app.get("/diffr-config", async () =>
    serverJson(200, await readDiffrConfig()),
  );
  app.put("/diffr-config", async (context) => {
    const body = await readBoundedRequestJson(context.req.raw);

    const key = isJsonObject(body) ? jsonString(body.key) : undefined;

    const value = isJsonObject(body) ? body.value : undefined;

    if (key === undefined || value === undefined) {
      throw new ReviewServerError("key and value are required.", 400);
    }

    return serverJson(200, await setDiffrConfigValue(key, value));
  });
  app.put("/diffr-config/summarizer", async (context) => {
    const input = reviewDiffrSummarizerInputSchema.safeParse(
      await readBoundedRequestJson(context.req.raw),
    );

    if (!input.success)
      throw new ReviewServerError("Invalid summary settings.", 400);

    return serverJson(200, await saveDiffrSummarizer(input.data));
  });
  app.post("/diffr-config/summarizer/test", async (context) => {
    const input = reviewDiffrSummarizerInputSchema.safeParse(
      await readBoundedRequestJson(context.req.raw),
    );

    if (!input.success)
      throw new ReviewServerError("Invalid summary settings.", 400);

    return serverJson(200, {
      summary: await testDiffrSummarizer(
        input.data,
        undefined,
        context.req.raw.signal,
      ),
    });
  });
  app.get("/install/status", async () =>
    serverJson(
      200,
      await resolveCliInstallStatus({ packageRoot: input.packageRoot }),
    ),
  );
  app.post("/install/apply", async (context) => {
    const request = parseReviewCliInstallApplyRequest(
      await readBoundedRequestJson(context.req.raw),
    );

    const applyInput: Parameters<typeof applyCliInstall>[0] = {
      packageRoot: input.packageRoot,
    };

    if (request.shim !== undefined) applyInput.shim = request.shim;

    if (request.autoUpdate) applyInput.autoUpdate = true;

    if (request.trace !== undefined) applyInput.trace = request.trace;

    if (discovery.cliPath) applyInput.cliPath = discovery.cliPath;

    if (discovery.cliRuntimePath) {
      applyInput.cliRuntimePath = discovery.cliRuntimePath;
    }

    const result = await applyCliInstall(applyInput);

    const body: ReviewCliInstallApplyResponse = {
      ok: result.code === 0,
      output: result.output,
    };

    if (result.shimPath) body.shimPath = result.shimPath;

    return serverJson(result.code === 0 ? 200 : 500, body);
  });
  app.post("/install/remove", async (context) => {
    const request = parseReviewCliInstallApplyRequest(
      await readBoundedRequestJson(context.req.raw),
    );

    const removeInput: Parameters<typeof removeCliInstall>[0] = {};

    if (request.shim) removeInput.shim = true;

    if (request.trace) removeInput.trace = true;
    const result = await removeCliInstall(removeInput);

    return serverJson(200, { ok: true, output: result.output });
  });
  app.post("/install/legacy-skills/remove", async () => {
    const { removed } = await removeLegacyReviewSkills();

    return serverJson(200, { ok: true, removed });
  });
  app.post("/install/finish-update", async () => {
    await finishCliInstallUpdate();

    return serverJson(200, { ok: true });
  });
  app.post("/install/decline", async () => {
    await declineCliInstall();

    return serverJson(200, { ok: true });
  });
  app.post("/install/skip", async () => {
    await skipCliInstall();

    return serverJson(200, { ok: true });
  });
  app.post("/install/reset", async () => {
    await resetCliInstall();

    return serverJson(200, { ok: true });
  });
  // The harnesses first run connects for the user, instead of asking them
  // to paste a prompt into each one.
  app.get("/install/agents", async () =>
    serverJson(200, { agents: await detectConnectAgents() }),
  );
  app.post("/install/connect", async (context) => {
    const request = ReviewConnectRequestSchema.safeParse(
      await readBoundedRequestJson(context.req.raw),
    );

    if (!request.success) throw new ReviewServerError("Invalid agent.", 400);

    return serverJson(
      200,
      await connectAgent(request.data.target, {
        hasShim: existsSync(pathShimPath()),
      }),
    );
  });

  const httpServer = createServer(createNodeRequestListener(app));

  return {
    discovery,
    get url() {
      return urlForBoundPort();
    },
    listen: async () => {
      await migrateDiffrConfig();
      boundPort = await listen(httpServer, input.port);
      discovery.url = urlForBoundPort();

      for (const discoveryPath of discoveryPaths)
        await writePrivateJsonAtomic(discoveryPath, discovery);
    },
    close: async () => {
      if (closing) return;
      closing = true;
      core.close();

      for (const discoveryPath of discoveryPaths)
        await removeMatchingDiscovery(discoveryPath, discovery);
      relay.close();
      openWatchdog.dispose();

      await closeHttpServer(httpServer);
      await gateway.close();
      await telemetry.shutdown(1_500);
    },
    setRemoteHosts: (hosts) => gateway.setHosts(hosts),
  };
}

function watchSessionOpen(
  watchdog: ReviewOpenWatchdog,
  event: string,
  context: ReviewTelemetryContext | undefined,
): void {
  const reviewUuid = context?.reviewUuid;
  const presentationSessionId = context?.presentationSessionId;

  if (!reviewUuid || !presentationSessionId) return;

  if (event === "review_session_started")
    watchdog.started({ reviewUuid, presentationSessionId });
  else if (
    event === "review_review_presented" ||
    event === "review_session_ended"
  )
    watchdog.presented(presentationSessionId);
}

/**
 * `session_started`'s `source_kind` and `pr_provider`. Empty when the review
 * is not in this store: a shared or remote review, or one deleted between open
 * and the event arriving.
 */
export function sessionStartedSource(
  reviewStore: ReviewStore,
  reviewUuid: string | undefined,
) {
  if (!reviewUuid) return {};

  try {
    const snapshot = reviewStore.read(reviewUuid);

    const sourceKind = snapshot.target?.kind;

    const pullRequestUrl = snapshot.origin?.pullRequestUrl;

    const prProvider = pullRequestUrl && prProviderOf(pullRequestUrl);

    return {
      ...(sourceKind && { source_kind: sourceKind }),
      ...(prProvider && { pr_provider: prProvider }),
    };
  } catch {
    return {};
  }
}

function prProviderOf(url: string) {
  const resolved = pullRequestProvider(url);

  if (!resolved) return undefined;

  if (resolved.provider.id === "azure-devops") return "azure_devops";

  return resolved.address.host === "github.com"
    ? "github"
    : "github_enterprise";
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();

      if (!isTcpAddress(address)) {
        reject(new Error("The Whiteboard server did not bind a TCP port."));

        return;
      }

      resolve(address.port);
    });
  });
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();

      return;
    }

    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function removeMatchingDiscovery(
  filePath: string,
  discovery: ReviewDesktopDiscovery,
): Promise<void> {
  try {
    const current: JsonValue = JSON.parse(await readFile(filePath, "utf8"));

    if (
      isJsonObject(current) &&
      current.instanceId === discovery.instanceId &&
      current.appPid === discovery.appPid
    ) {
      await rm(filePath, { force: true });
    }
  } catch (error) {
    // SAFETY: fs/promises rejects with a Node ErrnoException carrying `code`.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** `server.address()` is a string for pipe and socket listeners. */
function isTcpAddress(
  address: string | AddressInfo | null,
): address is AddressInfo {
  return isObjectValue(address);
}
