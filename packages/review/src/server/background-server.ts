import { spawn } from "node:child_process";
import { mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { liveLockOwner, processIsAlive } from "@dev.fast/trace-core";
import type { ReviewInstanceSelection } from "@review/desktop-discovery.js";
import { findReviewPackageRoot } from "@review/package-paths.js";
import { desktopApplicationInstalled } from "@review/review-app-launcher.js";
import {
  type ReviewServerDiscovery,
  headlessServerLockPath,
  readReviewServerDiscovery,
  readReviewServerHealth,
  reviewServerStateDir,
} from "@review/server-discovery.js";

export interface EnsureBackgroundServerInput {
  stateDir: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  startedBy?: "cli" | "desktop";
  /** Extra `server start` arguments, such as a port. */
  args?: readonly string[];
  /** The CLI to run; this process's own by default. */
  cli?: readonly string[];
}

export function backgroundServerLogPath(stateDir: string) {
  return path.join(stateDir, "review-server", "server.log");
}

/** The healthy server that owns `stateDir`, starting a detached one if none does. */
export async function ensureBackgroundServer(
  input: EnsureBackgroundServerInput,
): Promise<{ discovery: ReviewServerDiscovery; started: boolean }> {
  const stateDir = path.resolve(input.stateDir);
  const running = await healthyDiscovery(stateDir);

  if (running) return { discovery: running, started: false };

  const logPath = backgroundServerLogPath(stateDir);
  await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
  const logStart = (await stat(logPath).catch(() => null))?.size ?? 0;
  const deadline = Date.now() + (input.timeoutMs ?? 15_000);
  let child = await spawnServer(stateDir, logPath, input);
  let respawned = false;

  while (Date.now() < deadline) {
    const discovery = await healthyDiscovery(stateDir);

    if (discovery)
      return { discovery, started: discovery.serverPid === child.pid };

    if (child.error)
      throw new Error(
        `Could not start the Whiteboard server: ${child.error.message}`,
      );

    // Our child lost the start to another, or failed. Only a live lock
    // holder can still publish a server; without one, try once more.
    if (child.exited && (await headlessServerOwner(stateDir)) === undefined) {
      if (respawned) break;
      respawned = true;
      child = await spawnServer(stateDir, logPath, input);
    }

    await delay(100);
  }

  const owner = await headlessServerOwner(stateDir);

  throw new Error(
    `The Whiteboard server did not become ready${child.exited ? "" : ` within ${Math.round((input.timeoutMs ?? 15_000) / 1_000)} s; process ${child.pid} is still starting`}.${owner !== undefined && owner !== child.pid ? ` Process ${owner} holds its state directory without answering; \`whiteboard server stop\` ends it.` : ""} The end of ${logPath}:\n${await logTail(logPath, logStart)}`,
  );
}

/**
 * With no Desktop here at all, not even a record of one or its app, the CLI
 * keeps this machine's own server up; undefined when a Desktop owns serving.
 */
export async function ensureServerWithoutDesktop(input: {
  selection: ReviewInstanceSelection;
  env: NodeJS.ProcessEnv;
  /** Test seam: the launcher's own check by default. */
  desktopInstalled?: () => boolean;
  /** Test seam: this process's CLI by default. */
  cli?: readonly string[];
}) {
  const { selection, env } = input;

  if (
    selection.source !== "fallback" ||
    selection.instances.length !== 0 ||
    selection.problem ||
    (input.desktopInstalled ?? (() => desktopApplicationInstalled({ env })))()
  )
    return undefined;

  const { discovery } = await ensureBackgroundServer({
    stateDir: reviewServerStateDir(env),
    env,
    cli: input.cli,
  });

  return discovery;
}

/**
 * The process holding `stateDir`'s server lock while it lives, answering or
 * not: its recorded pid and start, the rule `server start` and `reset-id`
 * meet when they take the lock. Never `/health` alone: a paused server is
 * silent but still owns the store.
 */
export async function headlessServerOwner(stateDir: string) {
  const resolved = await realpath(stateDir).catch(() => path.resolve(stateDir));

  return liveLockOwner(headlessServerLockPath(resolved));
}

/** The recorded server and its `/health`, when that answer proves the pid is still its. */
export async function recordedBackgroundServer(stateDir: string) {
  const discovery = await readReviewServerDiscovery(stateDir).catch(() => null);
  const health = discovery && (await readReviewServerHealth(discovery));

  return discovery && health?.serverPid === discovery.serverPid
    ? { discovery, health }
    : undefined;
}

/**
 * SIGTERMs a server the CLI or Desktop started and waits for it to exit;
 * one still there after 10 s, hung or paused, is SIGKILLed. The caller has
 * checked the pid is the recorded server's.
 */
export async function stopBackgroundServer(
  discovery: Pick<ReviewServerDiscovery, "serverPid">,
) {
  const { serverPid } = discovery;

  // Shutdown force-closes open streams after 5 s.
  for (const [signal, waitMs] of [
    ["SIGTERM", 10_000],
    ["SIGKILL", 2_000],
  ] as const) {
    try {
      process.kill(serverPid, signal);
    } catch (error) {
      // It exited before the signal.
      if (error instanceof Error && "code" in error && error.code === "ESRCH")
        return;
      throw error;
    }

    for (let waited = 0; waited < waitMs; waited += 100) {
      if (!processIsAlive(serverPid)) return;
      await delay(100);
    }
  }

  throw new Error(`The Whiteboard server (process ${serverPid}) did not stop.`);
}

interface DetachedChild {
  pid?: number;
  exited: boolean;
  /** Set when the command itself could not run. */
  error?: Error;
}

/** Spawns a process group of its own, writing to `log`, that outlives this process. */
export async function spawnDetached(input: {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: string;
}) {
  const log = await open(input.log, "a", 0o600);

  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    detached: true,
    env: input.env,
    stdio: ["ignore", log.fd, log.fd],
  });

  const state: DetachedChild = { pid: child.pid, exited: false };

  child.once("exit", () => (state.exited = true));
  child.once("error", (error) => {
    state.exited = true;
    state.error = error;
  });
  child.unref();
  await log.close();

  return state;
}

function spawnServer(
  stateDir: string,
  logPath: string,
  input: EnsureBackgroundServerInput,
) {
  const { command, args, env } = cliSpawn(input.cli, input.env ?? process.env);

  // The token reaches callers through the discovery file only: never an
  // argument, the environment or this log. The working directory is the
  // state directory, so the server never holds the caller's.
  return spawnDetached({
    command,
    args: [
      ...args,
      "server",
      "start",
      "--state-dir",
      stateDir,
      "--started-by",
      input.startedBy ?? "cli",
      ...(input.args ?? []),
    ],
    cwd: stateDir,
    env,
    log: logPath,
  });
}

/** How to spawn `cli`, this process's own CLI by default. */
export function cliSpawn(
  cli: readonly string[] | undefined,
  env: NodeJS.ProcessEnv,
) {
  const [command, ...args] = cli ?? currentCli();

  return {
    command: command!,
    args,
    // Run from source, tsx finds the path aliases only through this.
    env:
      args.at(-1)?.endsWith(".ts") && !env.TSX_TSCONFIG_PATH
        ? {
            ...env,
            TSX_TSCONFIG_PATH: path.join(
              findReviewPackageRoot(import.meta.url),
              "tsconfig.json",
            ),
          }
        : env,
  };
}

function currentCli() {
  return [
    process.execPath,
    ...process.execArgv,
    path.resolve(process.argv[1]!),
  ];
}

async function healthyDiscovery(stateDir: string) {
  const discovery = await readReviewServerDiscovery(stateDir).catch(() => null);

  return discovery && (await readReviewServerHealth(discovery))
    ? discovery
    : null;
}

async function logTail(logPath: string, from: number) {
  const text = (await readFile(logPath)).subarray(from).toString("utf8");

  return text.trimEnd().split("\n").slice(-20).join("\n");
}
