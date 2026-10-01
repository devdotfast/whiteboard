import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { processIsAlive } from "@dev.fast/trace-core";

import {
  readReviewServerDiscovery,
  readReviewServerHealth,
} from "./server-discovery";

/** The line Desktop's installer writes into `~/.local/bin/whiteboard`; the fork holds the same text. */
export const REMOTE_WRAPPER_MARK =
  "# Written by Whiteboard Desktop, which replaces it with each install.";

/** An install refreshes its lock at least this often; an older one is stale. */
const LOCK_STALE_MS = 15 * 60_000;

/** The review store: the reviews' database and its workspaces database, with their write-ahead files, in the review home. */
const REVIEW_STORE = [
  "review-api.db",
  "review-api.db-wal",
  "review-api.db-shm",
  "review-api.db.workspaces",
  "review-api.db.workspaces-wal",
  "review-api.db.workspaces-shm",
];

export type RemoteUninstallResult =
  | {
      event: "remote.uninstall";
      ok: true;
      removed: string[];
      keptReviews: boolean;
      stoppedServer?: { pid: number; version: string | null };
    }
  | { event: "remote.uninstall"; ok: false; reason: string };

/**
 * Removes what Desktop installed on this host: `~/.dev/whiteboard-remote/`
 * and its `~/.local/bin/whiteboard`. A server Desktop or the CLI started is
 * stopped first. Any other process running from the install is a refusal.
 */
export async function remoteUninstall(input: {
  home: string;
  /** The review home the server uses. */
  stateDir: string;
  deleteReviews: boolean;
}): Promise<RemoteUninstallResult> {
  const refuse = (reason: string): RemoteUninstallResult => ({
    event: "remote.uninstall",
    ok: false,
    reason,
  });

  // A relative home would aim every removal at the working directory.
  if (!path.isAbsolute(input.home))
    return refuse(
      `HOME is ${input.home ? JSON.stringify(input.home) : "not set"}; Whiteboard removes nothing without an absolute home.`,
    );

  if (!path.isAbsolute(input.stateDir))
    return refuse(
      `The review home ${JSON.stringify(input.stateDir)} is not an absolute path.`,
    );

  const install = path.join(input.home, ".dev", "whiteboard-remote");
  const wrapper = path.join(input.home, ".local", "bin", "whiteboard");
  const lock = path.join(install, "install.lock");

  const holder = await installRunning(lock);

  if (holder !== undefined)
    return refuse(
      `Desktop on ${holder || "another computer"} is installing Whiteboard here. Try again when it is done.`,
    );

  if (existsSync(install) && !(await takeLock(install, lock)))
    return refuse(
      "Desktop started installing Whiteboard here just now. Try again when it is done.",
    );

  let removedInstall = false;

  try {
    const discovery = await readReviewServerDiscovery(input.stateDir).catch(
      () => null,
    );

    const health = discovery && (await readReviewServerHealth(discovery));

    // Only the recorded instance's own answer proves the pid is still its.
    const recorded =
      discovery && health?.serverPid === discovery.serverPid
        ? { ...discovery, version: health.version ?? null }
        : undefined;

    const stoppable =
      recorded && recorded.startedBy !== "user"
        ? recorded.serverPid
        : undefined;

    const running = await processesFrom(`${install}/`);

    if (running === undefined)
      return refuse(
        `Cannot list this host's processes to check that none runs from ${install}.`,
      );

    const others = running.filter((pid) => pid !== stoppable);

    if (others.length)
      return refuse(
        `${others.map((pid) => (pid === recorded?.serverPid ? `A Whiteboard server you started (process ${pid})` : `Process ${pid}`)).join(", ")} ${others.length > 1 ? "run" : "runs"} from ${install}. Stop ${others.length > 1 ? "them" : "it"}, then run whiteboard remote uninstall again.`,
      );

    if (recorded?.startedBy === "user" && input.deleteReviews)
      return refuse(
        `A Whiteboard server you started (process ${recorded.serverPid}) uses the reviews in ${input.stateDir}. Stop it, then run whiteboard remote uninstall again.`,
      );

    let stoppedServer: { pid: number; version: string | null } | undefined;

    if (recorded && stoppable !== undefined) {
      if (!(await stop(stoppable)))
        return refuse(
          `The Whiteboard server (process ${stoppable}) did not stop within 10 s.`,
        );
      stoppedServer = { pid: stoppable, version: recorded.version };
    }

    const removed: string[] = [];

    if (existsSync(install)) {
      // The lock goes with the tree.
      await rm(install, { recursive: true, force: true });
      removedInstall = true;
      removed.push(install);
    }

    if (await desktopWrote(wrapper)) {
      await rm(wrapper, { force: true });
      removed.push(wrapper);
    }

    if (input.deleteReviews)
      for (const name of REVIEW_STORE) {
        const file = path.join(input.stateDir, name);

        if (existsSync(file)) {
          await rm(file, { force: true });
          removed.push(file);
        }
      }

    const result: RemoteUninstallResult = {
      event: "remote.uninstall",
      ok: true,
      removed,
      keptReviews: !input.deleteReviews,
    };

    if (stoppedServer) result.stoppedServer = stoppedServer;

    return result;
  } finally {
    if (!removedInstall) await rm(lock, { recursive: true, force: true });
  }
}

/** The holder of a live install lock, or undefined when none is held. */
async function installRunning(lock: string) {
  const started = await readFile(path.join(lock, "started"), "utf8").then(
    (text) => Number(text.trim()) * 1000,
    () => undefined,
  );

  const since =
    started && Number.isFinite(started)
      ? started
      : (await stat(lock).catch(() => undefined))?.mtimeMs;

  if (since === undefined || Date.now() - since >= LOCK_STALE_MS)
    return undefined;

  return readFile(path.join(lock, "owner"), "utf8").then(
    (text) => text.trim(),
    () => "",
  );
}

/**
 * Takes the installer's lock as an install does, a stale one moved aside
 * first, so no install starts while the tree is removed. False when another
 * took it first.
 */
async function takeLock(install: string, lock: string) {
  const token = randomBytes(8).toString("hex");

  if (existsSync(lock)) {
    const stale = path.join(install, `install.lock.${token}.stale`);

    await rename(lock, stale).catch(() => undefined);
    await rm(stale, { recursive: true, force: true });
  }

  try {
    await mkdir(lock);
  } catch {
    return false;
  }

  await writeFile(path.join(lock, "token"), `${token}\n`);
  await writeFile(path.join(lock, "owner"), "whiteboard-remote-uninstall\n");
  await writeFile(
    path.join(lock, "started"),
    `${Math.floor(Date.now() / 1000)}\n`,
  );

  return true;
}

/**
 * The pids, other than this one, whose command line holds `prefix`: the
 * same scan the installer's cleanup makes. Undefined when none can be read.
 */
async function processesFrom(prefix: string) {
  let lines: [number, string][];

  try {
    const pids = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));

    lines = await Promise.all(
      pids.map(
        async (pid): Promise<[number, string]> => [
          Number(pid),
          await readFile(`/proc/${pid}/cmdline`, "utf8").then(
            (text) => text.replaceAll("\0", " "),
            () => "",
          ),
        ],
      ),
    );
  } catch {
    try {
      const { stdout } = await promisify(execFile)(
        "ps",
        ["-eo", "pid=,args="],
        { maxBuffer: 16 << 20 },
      );

      lines = stdout.split("\n").map((line): [number, string] => {
        const [, pid = "", args = ""] = /^\s*(\d+)\s(.*)$/.exec(line) ?? [];

        return [Number(pid), args];
      });
    } catch {
      return undefined;
    }
  }

  return lines
    .filter(
      ([pid, args]) => pid && pid !== process.pid && args.includes(prefix),
    )
    .map(([pid]) => pid);
}

async function stop(pid: number) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    // It exited between the health check and the signal.
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
      throw error;
  }

  // Shutdown force-closes open streams after 5 s.
  for (let waited = 0; processIsAlive(pid); waited += 100) {
    if (waited >= 10_000) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return true;
}

/** A regular file holding the installer's mark line; a symlink is never Desktop's. */
async function desktopWrote(file: string) {
  const entry = await lstat(file).catch(() => undefined);

  if (!entry?.isFile()) return false;

  return (await readFile(file, "utf8"))
    .split("\n")
    .includes(REMOTE_WRAPPER_MARK);
}
