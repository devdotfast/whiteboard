#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

import { reviewInstanceIdentity } from "@review/desktop-discovery";
import { findReviewPackageRoot } from "@review/package-paths";
import { openReviewProfile } from "@review/review-api/profile";
import { ensureBundledRustAnalyzer } from "@review/review-bundled-tools";
import { devReviewHome } from "@review/review-home-paths";
import { ReviewTelemetry } from "@review/review-telemetry";
import { reviewTelemetryChannel } from "@review/telemetry-config";

import {
  listenForDesktopHostShutdown,
  postToDesktop,
} from "./desktop-host-shutdown";
import { createGlobalReviewServer } from "./desktop-server";
import { takeOverServerHome } from "./headless-host";
import {
  drainServerCrashReport,
  installProcessErrorTelemetry,
  serverCrashReportPath,
} from "./process-error-telemetry";

export async function runDesktopHost(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // Port 0 lets the OS choose; the ready event below reports what was bound.
  const port = requiredPort(env.DEV_FAST_REVIEW_SERVER_PORT);

  const appPid = requiredPositiveInteger(
    env.DEV_FAST_REVIEW_APP_PID,
    "DEV_FAST_REVIEW_APP_PID",
  );

  const packageRoot = findReviewPackageRoot(import.meta.url);
  const toolingRoot = env.DEV_FAST_REVIEW_TOOLING_ROOT || packageRoot;
  const tls = takeLoopbackTls(env);
  const telemetryEnv = { ...env };
  delete telemetryEnv.DEV_FAST_REVIEW_TELEMETRY_DISABLED;

  const telemetry = ReviewTelemetry.fromEnv(telemetryEnv, {
    surface: "desktop",
  });

  installProcessErrorTelemetry(telemetry, {
    appSessionId: env.DEV_FAST_REVIEW_APP_SESSION_ID,
    crashReportPath: serverCrashReportPath(env),
  });

  await telemetry.setEnabled(
    !isEnabledEnvValue(env.DEV_FAST_REVIEW_TELEMETRY_DISABLED),
  );

  // An unpackaged Desktop is ours; remember that so every later process on
  // this machine, CLI included, reports internal.
  if (reviewTelemetryChannel(env) === "dev") await telemetry.setInternal(true);
  await telemetry.captureInstallationCreated().catch(() => undefined);
  await telemetry.reconcileOpenSessions().catch(() => undefined);
  await drainServerCrashReport(telemetry, serverCrashReportPath(env));
  const installationId = await telemetry.getInstallationId();
  // This value bootstraps the stored setting. Remove it after persistence so
  // a later in-app enable also reaches telemetry instances created elsewhere.
  delete env.DEV_FAST_REVIEW_TELEMETRY_DISABLED;

  const serverInput = {
    appPid,
    packageRoot,
    toolingRoot,
    port,
    token: env.DEV_FAST_REVIEW_SERVER_TOKEN,
    instanceId: env.DEV_FAST_REVIEW_INSTANCE_ID,
    identity: reviewInstanceIdentity(env),
    telemetry,
    tls,
  };

  const home = devReviewHome(env);
  await mkdir(home, { recursive: true });

  const log = (message: string) =>
    process.stdout.write(`[Whiteboard gateway] ${message}\n`);

  const { local, server } = await takeOverServerHome(home, async () => {
    const local = await openReviewProfile(home, {
      manageWorkspaces: true,
      // Desktop shows each PR's state beside its board.
      pullRequestStates: true,
    });

    // JSON is the sole user-review store. A failure is surfaced, never replaced
    // by a second catalog or an old document renderer.

    // Shares opened as read-only boards here, each with its own checkout;
    // they open as copies now.
    const legacy = path.join(home, "shared-reviews");

    if (existsSync(legacy)) {
      const root = await realpath(legacy);

      for (const repository of local.store.repositories())
        if (repository.path.startsWith(root + path.sep))
          await local.store.unregisterRepository(repository.id);
      await rm(legacy, { recursive: true, force: true });
    }

    const server = createGlobalReviewServer({
      ...serverInput,
      log,
      sharing: true,
      reviewStore: local.store,
      reviewData: local.data,
      cliRuntimePath: env.DEV_FAST_REVIEW_CLI_RUNTIME,
      crashDumpsDir: env.DEV_FAST_REVIEW_CRASH_DUMPS_DIR,
      onRemoteHostRestarted: (alias) =>
        postToDesktop(process, { type: "remote-host-restarted", alias }),
    });

    try {
      await server.listen();
    } catch (error) {
      await local?.data.close();
      await local?.store.close();
      throw error;
    }

    return { local, server };
  });

  process.stdout.write(
    `${JSON.stringify({ event: "ready", ...server.discovery, installationId, ...(server.secure && { tls: true }) })}\n`,
  );

  const stageRustAnalyzer = () =>
    ensureBundledRustAnalyzer({ env }).catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[Review tools] Could not stage bundled rust-analyzer: ${reason}\n`,
      );
    });

  void stageRustAnalyzer();

  let stopping: Promise<void> | null = null;

  const stop = () => {
    if (!stopping) {
      stopping = server
        .close("app-exit")
        .finally(() => local?.data.close())
        .finally(() => local?.store.close());
    }

    return stopping;
  };

  listenForDesktopHostShutdown(
    process,
    () => {
      void stop().then(() => process.exit(0));
    },
    (enabled) => {
      void telemetry.setEnabled(enabled).catch(() => undefined);
    },
    (sourcePath) => {
      env.DEV_FAST_REVIEW_RUST_ANALYZER = sourcePath;
      void stageRustAnalyzer();
    },
    (hosts) => server.setRemoteHosts(hosts),
  );
  process.once("SIGINT", () => {
    void stop().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop().then(() => process.exit(0));
  });
}

function isEnabledEnvValue(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

/** Read once, then dropped so no child process inherits the private key. */
function takeLoopbackTls(env: NodeJS.ProcessEnv) {
  const key = env.DEV_FAST_REVIEW_SERVER_TLS_KEY;
  const cert = env.DEV_FAST_REVIEW_SERVER_TLS_CERT;

  delete env.DEV_FAST_REVIEW_SERVER_TLS_KEY;
  delete env.DEV_FAST_REVIEW_SERVER_TLS_CERT;

  return key && cert ? { key, cert } : undefined;
}

function requiredPort(value: string | undefined): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(
      "DEV_FAST_REVIEW_SERVER_PORT must be a port between 0 and 65535.",
    );
  }

  return parsed;
}

function requiredPositiveInteger(
  value: string | undefined,
  name: string,
): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

if (process.env.DEV_FAST_REVIEW_DESKTOP_HOST_AUTOSTART !== "0") {
  void runDesktopHost().catch((error) => {
    // Exit now: a host that couldn't start (a store that couldn't be
    // upgraded) must not linger with timers alive, or Desktop waits out its
    // ready timeout instead of reporting why.
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      () => process.exit(1),
    );
  });
}
