import { spawn } from "node:child_process";
import { mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { liveLockOwner, processIsAlive } from "@dev.fast/trace-core";
import { findReviewPackageRoot } from "@review/package-paths.js";
import {
  type ReviewServerDiscovery,
  headlessServerLockPath,
  readReviewServerDiscovery,
  readReviewServerHealth,
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

    if (child.error) throw child.error;

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

interface ServerChild {
  pid?: number;
  exited: boolean;
  /** Set when the command itself could not run. */
  error?: Error;
}

async function spawnServer(
  stateDir: string,
  logPath: string,
  input: EnsureBackgroundServerInput,
) {
  const log = await open(logPath, "a", 0o600);
  const { command, args, env } = cliSpawn(input.cli, input.env ?? process.env);

  // The token reaches callers through the discovery file only: never an
  // argument, the environment or this log. The working directory is the
  // state directory, so the server never holds the caller's.
  const child = spawn(
    command,
    [
      ...args,
      "server",
      "start",
      "--state-dir",
      stateDir,
      "--started-by",
      input.startedBy ?? "cli",
      ...(input.args ?? []),
    ],
    {
      cwd: stateDir,
      detached: true,
      env,
      stdio: ["ignore", log.fd, log.fd],
    },
  );

  const state: ServerChild = {
    pid: child.pid,
    exited: false,
  };

  child.once("exit", () => (state.exited = true));
  child.once("error", (error) => {
    state.exited = true;
    state.error = new Error(
      `Could not start the Whiteboard server: ${error.message}`,
    );
  });
  child.unref();
  await log.close();

  return state;
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
