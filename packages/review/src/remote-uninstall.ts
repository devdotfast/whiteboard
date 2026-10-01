import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, readFile, rm, stat } from "node:fs/promises";
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
 * stopped first; one the user started from the install is a refusal.
 */
export async function remoteUninstall(input: {
  home: string;
  /** The review home the server uses. */
  stateDir: string;
  deleteReviews: boolean;
}): Promise<RemoteUninstallResult> {
  const install = path.join(input.home, ".dev", "whiteboard-remote");
  const wrapper = path.join(input.home, ".local", "bin", "whiteboard");

  const refuse = (reason: string): RemoteUninstallResult => ({
    event: "remote.uninstall",
    ok: false,
    reason,
  });

  const holder = await installRunning(path.join(install, "install.lock"));

  if (holder !== undefined)
    return refuse(
      `Desktop on ${holder || "another computer"} is installing Whiteboard here. Try again when it is done.`,
    );

  const discovery = await readReviewServerDiscovery(input.stateDir).catch(
    () => null,
  );

  const health = discovery && (await readReviewServerHealth(discovery));
  let stoppedServer: { pid: number; version: string | null } | undefined;

  // Only the recorded instance's own answer proves the pid is still its.
  if (discovery && health?.serverPid === discovery.serverPid) {
    const pid = discovery.serverPid;

    if (discovery.startedBy === "user") {
      const command = await commandLine(pid);

      if (command === undefined || command.includes(`${install}/`))
        return refuse(
          `A Whiteboard server you started (process ${pid}) runs from ${install}. Stop it, then run whiteboard remote uninstall again.`,
        );

      if (input.deleteReviews)
        return refuse(
          `A Whiteboard server you started (process ${pid}) uses the reviews in ${input.stateDir}. Stop it, then run whiteboard remote uninstall again.`,
        );
    } else {
      if (!(await stop(pid)))
        return refuse(
          `The Whiteboard server (process ${pid}) did not stop within 10 s.`,
        );
      stoppedServer = { pid, version: health.version ?? null };
    }
  }

  const removed: string[] = [];

  if (existsSync(install)) {
    await rm(install, { recursive: true, force: true });
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

async function commandLine(pid: number) {
  try {
    return (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll(
      "\0",
      " ",
    );
  } catch {
    return promisify(execFile)("ps", ["-o", "args=", "-p", String(pid)]).then(
      ({ stdout }) => stdout.trim() || undefined,
      () => undefined,
    );
  }
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
