import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";

import { isObjectValue } from "@dev.fast/json";
import {
  traceMachineEnabled,
  withFileLock,
  writePrivateJsonAtomic,
} from "@dev.fast/trace-core";
import { createReviewApi } from "@review/review-api/http.js";
import { openReviewProfile } from "@review/review-api/profile.js";
import {
  type ReviewServerDiscovery,
  headlessServerLockPath,
  reviewServerDiscoveryPath,
} from "@review/server-discovery.js";
import { mountSharingPublisher } from "@review/sharing/host.js";

import { GlobalReviewDesktopVerbRelay } from "./global-verb-relay.js";
import { createNodeRequestListener } from "./hono-http.js";
import {
  drainServerCrashReport,
  installProcessErrorTelemetry,
} from "./process-error-telemetry.js";
import {
  createReviewServerApp,
  relayReviewCallbacks,
} from "./review-server-core.js";
import type { ReviewTelemetryCapture } from "./ui-telemetry.js";

interface HeadlessServerInput {
  stateDir: string;
  port?: number;
  softwareMapEnabled?: boolean;
  signal: AbortSignal;
  /** The CLI's instance, already on the `headless` surface. */
  telemetry?: Pick<ReviewTelemetryCapture, "captureUiEvent">;
  onReady(discovery: ReviewServerDiscovery): void;
}

/** One foreground headless endpoint per profile; Desktop shares its database. */
export async function runHeadlessServer(input: HeadlessServerInput) {
  await mkdir(input.stateDir, { recursive: true, mode: 0o700 });
  const stateDir = await realpath(input.stateDir);

  const stopErrorTelemetry =
    input.telemetry && installProcessErrorTelemetry(input.telemetry);

  const outcome = await withHeadlessServerLock(stateDir, () =>
    serve({ ...input, stateDir }),
  ).finally(() => stopErrorTelemetry?.());

  if (!outcome.acquired)
    throw new Error(
      `A Whiteboard server already owns ${stateDir}. Stop it first, or choose another --state-dir.`,
    );
}

/** Held by a running server, so also by anything that must not run beside one. */
export function withHeadlessServerLock<T>(
  stateDir: string,
  operation: () => Promise<T>,
) {
  return withFileLock(
    headlessServerLockPath(stateDir),
    {
      timeoutMs: 0,
      retryMs: 20,
      // A paused live owner must never lose exclusive access to its store.
      staleMs: Infinity,
      unownedGraceMs: 1_000,
      // A reboot or kill can hand the pid to an unrelated live process.
      identifyOwner: true,
    },
    operation,
  );
}

async function serve(input: HeadlessServerInput) {
  if (input.signal.aborted) return;

  if (input.telemetry) await drainServerCrashReport(input.telemetry);

  const local = await openReviewProfile(input.stateDir, {
    manageWorkspaces: false,
  });

  const discovery: ReviewServerDiscovery = {
    version: 1,
    instanceId: randomUUID(),
    url: "http://127.0.0.1:0",
    serverPid: process.pid,
    token: randomBytes(32).toString("base64url"),
  };

  const relay = new GlobalReviewDesktopVerbRelay();

  const app = createReviewServerApp({
    token: discovery.token,
    instanceId: discovery.instanceId,
    serverId: local.store.serverId(),
    relay,
  });

  const callbacks = relayReviewCallbacks(relay, input.softwareMapEnabled);

  const api = createReviewApi(
    local.store,
    local.data,
    callbacks.open,
    undefined,
    callbacks.capabilities,
    // The scratchpad is the laptop's alone, even with a Desktop attached.
    () => false,
    () => traceMachineEnabled(),
    () => ({ key: "headless", home: input.stateDir }),
  );

  mountSharingPublisher(api, local.store, local.data);
  app.route("/reviews-api", api);

  const server = createServer(createNodeRequestListener(app));
  let published = false;

  try {
    const listening = once(server, "listening");
    server.listen(input.port ?? 0, "127.0.0.1");
    await listening;
    const address = server.address();

    if (!isObjectValue(address))
      throw new Error("Whiteboard server did not bind a TCP port.");
    discovery.url = `http://127.0.0.1:${address.port}`;
    await writePrivateJsonAtomic(
      reviewServerDiscoveryPath(input.stateDir),
      discovery,
    );
    published = true;
    input.onReady(discovery);

    await new Promise<void>((resolve) => {
      if (input.signal.aborted) resolve();
      else
        input.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  } finally {
    // Watch streams may live forever. Drain ordinary requests, then bound shutdown.
    const forceClose = setTimeout(() => server.closeAllConnections(), 5_000);
    forceClose.unref();

    try {
      if (published)
        await rm(reviewServerDiscoveryPath(input.stateDir), { force: true });
    } finally {
      // An attached Desktop's stream would otherwise hold the close open.
      relay.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      clearTimeout(forceClose);

      try {
        await local.data.close();
      } finally {
        await local.store.close();
      }
    }
  }
}
