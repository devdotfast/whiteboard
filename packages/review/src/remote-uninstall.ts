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

import {
  REVIEW_REMOTE_INSTALL_LOCK,
  REVIEW_REMOTE_LOCK_STALE_SECONDS,
  REVIEW_REMOTE_WRAPPER_MARK,
} from "@dev.fast/review-protocol";

import { whiteboardRemoteHome } from "./remote-extensions";
import {
  remoteLanguageServerGroups,
  stopProcessGroup,
} from "./remote-language-server";
import { DEV_REVIEW_HOME_ENV } from "./review-home-paths";
import {
  recordedBackgroundServer,
  stopBackgroundServer,
} from "./server/background-server";

const LOCK_STALE_MS = REVIEW_REMOTE_LOCK_STALE_SECONDS * 1000;

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

export async function remoteUninstall(input: {
  home: string;
  env: NodeJS.ProcessEnv;
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

  const override = input.env[DEV_REVIEW_HOME_ENV]?.trim();

  if (
    override &&
    (/[\x00-\x1f\x7f-\x9f]/.test(override) ||
      override.includes("//") ||
      path.resolve(override) !== (override.replace(/\/$/, "") || "/"))
  )
    return refuse(
      `DEV_REVIEW_HOME is ${JSON.stringify(override)}; Whiteboard removes nothing under a review home that is not an absolute, normalised path.`,
    );

  const install = whiteboardRemoteHome(input.env);
  const wrapper = path.join(input.home, ".local", "bin", "whiteboard");
  const lock = path.join(install, REVIEW_REMOTE_INSTALL_LOCK);

  const taken = existsSync(install)
    ? await takeInstallLock(install)
    : undefined;

  if (taken && "holder" in taken)
    return refuse(
      `Desktop on ${taken.holder || "another computer"} is installing Whiteboard here. Try again when it is done.`,
    );

  const held = taken?.token;
  let removedInstall = false;

  try {
    const server = await recordedBackgroundServer(input.stateDir);

    const recorded = server && {
      ...server.discovery,
      version: server.health.version ?? null,
    };

    const stoppable =
      recorded && recorded.startedBy !== "user"
        ? recorded.serverPid
        : undefined;

    const groups = await remoteLanguageServerGroups(input.env);
    const running = await processesFrom(`${install}/`);

    if (running === undefined)
      return refuse(
        `Cannot list this host's processes to check that none runs from ${install}.`,
      );

    const others = running
      .filter(({ pid, pgid }) => pid !== stoppable && !groups.includes(pgid))
      .map(({ pid }) => pid);

    if (others.length)
      return refuse(
        `${others.map((pid) => (pid === recorded?.serverPid ? `A Whiteboard server you started (process ${pid})` : `Process ${pid}`)).join(", ")} ${others.length > 1 ? "run" : "runs"} from ${install}. Stop ${others.length > 1 ? "them" : "it"}, then run whiteboard remote uninstall again.`,
      );

    if (recorded?.startedBy === "user" && input.deleteReviews)
      return refuse(
        `A Whiteboard server you started (process ${recorded.serverPid}) uses the reviews in ${input.stateDir}. Stop it, then run whiteboard remote uninstall again.`,
      );

    await Promise.all(groups.map(stopProcessGroup));
    let stoppedServer: { pid: number; version: string | null } | undefined;

    if (recorded && stoppable !== undefined) {
      try {
        await stopBackgroundServer({ serverPid: stoppable });
      } catch (error) {
        return refuse(error instanceof Error ? error.message : String(error));
      }

      stoppedServer = { pid: stoppable, version: recorded.version };
    }

    const left = await processesFrom(`${install}/`);

    if (left?.length !== 0)
      return refuse(
        `${left ? `Process ${left.map(({ pid }) => pid).join(", ")}` : "A process"} still runs from ${install}. Stop it, then run whiteboard remote uninstall again.`,
      );

    const removed: string[] = [];

    if (held) {
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
    if (held && !removedInstall) await releaseLock(lock, held);
  }
}

export async function takeInstallLock(
  install: string,
  hooks: {
    beforeMove?(): Promise<void>;
    afterMkdir?(): Promise<void>;
  } = {},
): Promise<{ token: string } | { holder: string }> {
  const lock = path.join(install, REVIEW_REMOTE_INSTALL_LOCK);
  const token = randomBytes(8).toString("hex");

  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 200));

    if (
      await mkdir(lock).then(
        () => true,
        () => false,
      )
    ) {
      try {
        await hooks.afterMkdir?.();
        await writeFile(path.join(lock, "token"), `${token}\n`);
        await writeFile(
          path.join(lock, "owner"),
          "whiteboard-remote-uninstall\n",
        );
        await stamp(lock, token);
      } catch (error) {
        await rm(lock, { recursive: true, force: true });
        throw error;
      }

      return { token };
    }

    const judged = await readText(path.join(lock, "token"));

    if (!(await stale(lock)))
      return { holder: await readText(path.join(lock, "owner")) };

    await hooks.beforeMove?.();

    const aside = path.join(
      install,
      `${REVIEW_REMOTE_INSTALL_LOCK}.${token}.stale`,
    );

    if (
      !(await rename(lock, aside).then(
        () => true,
        () => false,
      ))
    )
      continue;

    if (
      (await readText(path.join(aside, "token"))) === judged &&
      (await stale(aside))
    )
      await rm(aside, { recursive: true, force: true });
    else await rename(aside, lock).catch(() => undefined);
  }

  return { holder: await readText(path.join(lock, "owner")) };
}

async function stale(lock: string) {
  const started = await readText(path.join(lock, "started"));

  if (started !== "")
    return (
      /^\d+$/.test(started) &&
      Date.now() - Number(started) * 1000 >= LOCK_STALE_MS
    );

  if (existsSync(path.join(lock, "started"))) return false;

  const since = (await stat(lock).catch(() => undefined))?.mtimeMs;

  return since !== undefined && Date.now() - since >= LOCK_STALE_MS;
}

async function stamp(lock: string, token: string) {
  const next = path.join(lock, `started.${token}`);

  await writeFile(next, `${Math.floor(Date.now() / 1000)}\n`);
  await rename(next, path.join(lock, "started"));
}

async function releaseLock(lock: string, token: string) {
  if ((await readText(path.join(lock, "token"))) !== token) return;
  const done = `${lock}.${token}.done`;

  if (
    await rename(lock, done).then(
      () => true,
      () => false,
    )
  )
    await rm(done, { recursive: true, force: true });
}

const readText = (file: string) =>
  readFile(file, "utf8").then(
    (text) => text.trim(),
    () => "",
  );

async function processesFrom(prefix: string) {
  let lines: { pid: number; pgid: number; args: string }[];

  try {
    const pids = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));

    lines = await Promise.all(
      pids.map(async (pid) => {
        const [args = "", stat = ""] = await Promise.all(
          [`/proc/${pid}/cmdline`, `/proc/${pid}/stat`].map((file) =>
            readFile(file, "utf8").catch(() => ""),
          ),
        );

        // The group follows the state and the parent, after the command's parentheses.
        const pgid = Number(
          stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2],
        );

        return { pid: Number(pid), pgid, args: args.replaceAll("\0", " ") };
      }),
    );
  } catch {
    try {
      const { stdout } = await promisify(execFile)(
        "ps",
        ["-eo", "pid=,pgid=,args="],
        { maxBuffer: 16 << 20 },
      );

      lines = stdout.split("\n").map((line) => {
        const [, pid = "", pgid = "", args = ""] =
          /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(line) ?? [];

        return { pid: Number(pid), pgid: Number(pgid), args };
      });
    } catch {
      return undefined;
    }
  }

  return lines.filter(
    ({ pid, args }) => pid && pid !== process.pid && args.includes(prefix),
  );
}

async function desktopWrote(file: string) {
  const entry = await lstat(file).catch(() => undefined);

  if (!entry?.isFile()) return false;

  return (await readFile(file, "utf8"))
    .split("\n")
    .includes(REVIEW_REMOTE_WRAPPER_MARK);
}
