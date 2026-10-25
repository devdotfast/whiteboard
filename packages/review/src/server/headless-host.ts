import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { isObjectValue } from "@dev.fast/json";
import {
  processStartIdentity,
  withFileLock,
  writePrivateJsonAtomic,
} from "@dev.fast/trace-core";
import type { AskAgentLauncher } from "@review/ask/agents.js";
import { cliAskTools } from "@review/ask/threads.js";
import { desktopUsesHome } from "@review/desktop-discovery.js";
import { findReviewPackageRoot } from "@review/package-paths.js";
import { openReviewProfile } from "@review/review-api/profile.js";
import {
  DESKTOP_TAKEOVER_SIGNAL,
  type ReviewServerDiscovery,
  desktopOwnsHome,
  headlessServerLockPath,
  reviewServerDiscoveryPath,
} from "@review/server-discovery.js";

import {
  headlessServerOwner,
  recordedBackgroundServer,
  stopBackgroundServer,
} from "./background-server.js";
import { migrateDiffrConfig } from "./diffr-config.js";
import { GlobalReviewDesktopVerbRelay } from "./global-verb-relay.js";
import { createNodeRequestListener } from "./hono-http.js";
import {
  drainServerCrashReport,
  installProcessErrorTelemetry,
} from "./process-error-telemetry.js";
import { createWhiteboardCore } from "./review-server-core.js";
import type { ReviewTelemetryCapture } from "./ui-telemetry.js";

interface HeadlessServerInput {
  stateDir: string;
  port?: number;
  softwareMapEnabled?: boolean;
  startedBy?: ReviewServerDiscovery["startedBy"];
  signal: AbortSignal;
  /** The CLI's instance, already on the `headless` surface. */
  telemetry?: Pick<ReviewTelemetryCapture, "captureUiEvent">;
  onReady(discovery: ReviewServerDiscovery): void;
  launchAskAgent?: AskAgentLauncher;
}

export class HeadlessServerBusyError extends Error {}

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
    throw new HeadlessServerBusyError(
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

/**
 * Desktop owns its home: it stops any server there, then starts under that
 * server's lock, so none can start until Desktop has published its discovery.
 */
export async function takeOverServerHome<T>(
  home: string,
  start: () => Promise<T>,
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<T> {
  const stateDir = await realpath(home);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const outcome = await withHeadlessServerLock(stateDir, start);

    if (outcome.acquired) return outcome.result;

    const owner = await headlessServerOwner(stateDir);
    // A server that answers as its recorded pid; a reused pid would not.
    const server = await recordedBackgroundServer(stateDir);

    if (owner !== undefined && server?.discovery.serverPid === owner)
      await stopBackgroundServer(server.discovery, DESKTOP_TAKEOVER_SIGNAL);
    else if (Date.now() <= deadline) await delay(100);
    // Without a start time (Windows), nothing proves the owner is the server.
    else if (owner !== undefined && processStartIdentity(owner) === null)
      await rm(headlessServerLockPath(stateDir), {
        recursive: true,
        force: true,
      });
    else
      throw new Error(
        `Process ${owner} holds the Whiteboard server's lock in ${stateDir} without serving it.`,
      );
  }
}

const LOGIN_PATH_TIMEOUT_MS = 4_000;

/** Started over ssh, this server has sshd's PATH; agents are on the login
 * shell's. */
async function agentEnv(): Promise<NodeJS.ProcessEnv> {
  const login = process.env.SHELL && (await loginPath(process.env.SHELL));

  return {
    ...process.env,
    PATH: [login, process.env.PATH, path.dirname(process.execPath)]
      .filter(Boolean)
      .join(path.delimiter),
  };
}

function loginPath(shell: string) {
  return new Promise<string | undefined>((resolve) => {
    const child = spawn(
      shell,
      ["-lic", 'printf "\\nWHITEBOARD-PATH=%s\\n" "$PATH"'],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );

    let output = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (output += chunk));

    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}

      resolve(undefined);
    }, LOGIN_PATH_TIMEOUT_MS);

    child.once("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.once("close", () => {
      clearTimeout(timer);

      const found = output
        .replaceAll("\r", "")
        .split("\n")
        .findLast((line) => line.startsWith("WHITEBOARD-PATH="))
        ?.slice("WHITEBOARD-PATH=".length);

      resolve(found?.startsWith("/") ? found : undefined);
    });
  });
}

async function serve(input: HeadlessServerInput) {
  if (input.signal.aborted) return;

  if (await desktopUsesHome(input.stateDir))
    throw new HeadlessServerBusyError(desktopOwnsHome(input.stateDir));

  await migrateDiffrConfig(input.signal);

  if (input.telemetry) await drainServerCrashReport(input.telemetry);

  const local = await openReviewProfile(input.stateDir, {
    manageWorkspaces: true,
  });

  const discovery: ReviewServerDiscovery = {
    version: 1,
    instanceId: randomUUID(),
    url: "http://127.0.0.1:0",
    serverPid: process.pid,
    token: randomBytes(32).toString("base64url"),
    startedBy: input.startedBy ?? "user",
  };

  const relay = new GlobalReviewDesktopVerbRelay();

  const cliPath = path.join(
    findReviewPackageRoot(import.meta.url),
    "dist",
    "cli.js",
  );

  const { app, api, close } = createWhiteboardCore({
    profile: local,
    relay,
    token: discovery.token,
    instanceId: discovery.instanceId,
    softwareMapEnabled: input.softwareMapEnabled,
    status: () => ({ key: "headless", home: input.stateDir }),
    ask: {
      tools: cliAskTools(() => (existsSync(cliPath) ? cliPath : undefined), {
        name: "DEV_REVIEW_SERVER_DIR",
        value: input.stateDir,
      }),
      launch: input.launchAskAgent,
      env: agentEnv(),
    },
  });

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
    close();

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
