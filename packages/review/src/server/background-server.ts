import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

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
  const log = await open(logPath, "a", 0o600);
  const logStart = (await log.stat()).size;
  const [command, ...cliArgs] = input.cli ?? currentCli();

  // The token reaches callers through the discovery file only: never an
  // argument, the environment or this log.
  const child = spawn(
    command!,
    [
      ...cliArgs,
      "server",
      "start",
      "--state-dir",
      stateDir,
      "--started-by",
      input.startedBy ?? "cli",
      ...(input.args ?? []),
    ],
    {
      detached: true,
      env: input.env ?? process.env,
      stdio: ["ignore", log.fd, log.fd],
    },
  );

  let exited = false;
  child.once("exit", () => (exited = true));
  child.once("error", () => (exited = true));
  child.unref();
  await log.close();

  const deadline = Date.now() + (input.timeoutMs ?? 15_000);

  while (Date.now() < deadline) {
    const discovery = await healthyDiscovery(stateDir);

    if (discovery)
      return { discovery, started: discovery.serverPid === child.pid };

    // Our child lost the start to another, or failed. Only a lock holder
    // can still publish a server.
    if (exited && !existsSync(headlessServerLockPath(stateDir))) break;
    await delay(100);
  }

  throw new Error(
    `The Whiteboard server did not become ready${exited ? "" : ` within ${Math.round((input.timeoutMs ?? 15_000) / 1_000)} s; process ${child.pid} is still starting`}. The end of ${logPath}:\n${await logTail(logPath, logStart)}`,
  );
}

function currentCli() {
  return [process.execPath, ...process.execArgv, process.argv[1]!];
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
