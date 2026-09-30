import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { processStartIdentity, withFileLock } from "@dev.fast/trace-core";
import { z } from "zod";

import { findReviewPackageRoot } from "./package-paths";
import { ensureRemoteExtensions, remoteServerPaths } from "./remote-extensions";

const START_TIMEOUT_MS = 15_000;

const VERSION_TIMEOUT_MS = 3_000;

/** Development only: exit as soon as the last extension host leaves, for idle checks. */
export const SHUTDOWN_WITHOUT_DELAY_ENV =
  "DEV_FAST_REVIEW_REMOTE_SHUTDOWN_WITHOUT_DELAY";

// Upstream's lifetime service exits 5 minutes after the last extension host
// leaves (SHUTDOWN_TIMEOUT, not configurable), and 5 minutes after start when
// none ever connects. A dropped client may reconnect for 10 minutes.
const IDLE_ARGS = [
  "--enable-remote-auto-shutdown",
  "--reconnection-grace-time",
  "600",
];

const LISTENING = /Extension host agent listening on (\d+)/;

const runningSchema = z.object({
  pid: z.number(),
  started: z.string().nullable(),
  port: z.number(),
});

type Running = z.infer<typeof runningSchema>;

export interface RemoteLanguageServer {
  port: number;
  connectionToken: string;
  commit: string;
}

interface EnsureExtensions {
  (input: {
    env: NodeJS.ProcessEnv;
    groups?: string[];
    signal?: AbortSignal;
  }): Promise<{ failed: { id: string; error: string }[] }>;
}

export interface EnsureRemoteLanguageServerInput {
  env: NodeJS.ProcessEnv;
  packageRoot?: string;
  /** Optional extension groups the Desktop has enabled. */
  groups?: string[];
  /** Ends extension downloads still running. */
  signal?: AbortSignal;
  /** `ensureRemoteExtensions` by default. */
  ensure?: EnsureExtensions;
  timeoutMs?: number;
}

/** Where the VS Code server keeps its token, pid, log and start lock. */
export function remoteLanguageServerFiles(env: NodeJS.ProcessEnv) {
  const { serverDataDir } = remoteServerPaths(env);

  return {
    serverDataDir,
    tokenFile: path.join(serverDataDir, "connection-token"),
    runningFile: path.join(serverDataDir, "server.json"),
    logFile: path.join(serverDataDir, "server.log"),
    lock: path.join(serverDataDir, "start.lock"),
  };
}

/**
 * The curated extensions, then the package's VS Code server on the remote's
 * loopback, started in the background unless one of this commit answers.
 * Never fails: without it, a review has no language features and the reason
 * is in `languageServerDetail`.
 */
export async function ensureRemoteLanguageServer(
  input: EnsureRemoteLanguageServerInput,
): Promise<{
  languageServer: RemoteLanguageServer | null;
  languageServerDetail?: string;
}> {
  const root = path.join(
    input.packageRoot ?? findReviewPackageRoot(import.meta.url),
    "vscode-server",
  );

  try {
    const commit = await readCommit(root);
    const ensure = input.ensure ?? ensureRemoteExtensions;

    // First: it clears the scanner's cache when the list changes.
    const { failed } = await ensure({
      env: input.env,
      groups: input.groups,
      signal: input.signal,
    });

    if (failed.length > 0)
      throw new Error(
        `Could not install the language extensions: ${failed.map(({ id, error }) => `${id}: ${error}`).join("; ")}`,
      );

    const files = remoteLanguageServerFiles(input.env);
    await mkdir(files.serverDataDir, { recursive: true, mode: 0o700 });

    const outcome = await withFileLock(
      files.lock,
      {
        retryMs: 100,
        staleMs: 60_000,
        timeoutMs: (input.timeoutMs ?? START_TIMEOUT_MS) * 2,
        unownedGraceMs: 5_000,
        identifyOwner: true,
      },
      async () => {
        const running = await healthy(files.runningFile, commit);

        const port =
          running?.port ??
          (await startServer(root, files, input.env, input.timeoutMs));

        return {
          port,
          connectionToken: (await readFile(files.tokenFile, "utf8")).trim(),
          commit,
        };
      },
    );

    if (!outcome.acquired)
      throw new Error("Another start of the VS Code server did not finish.");

    return { languageServer: outcome.result };
  } catch (error) {
    return {
      languageServer: null,
      languageServerDetail:
        error instanceof Error ? error.message : String(error),
    };
  }
}

/** Stops the VS Code server this home started, if it still runs. */
export async function stopRemoteLanguageServer(env: NodeJS.ProcessEnv) {
  const files = remoteLanguageServerFiles(env);
  const running = await readRunning(files.runningFile);

  if (running) await stop(running);
  await rm(files.runningFile, { force: true });
}

async function readCommit(root: string) {
  const file = path.join(root, "product.json");

  const text = await readFile(file, "utf8").catch(() => {
    throw new Error(
      `This Whiteboard install has no VS Code server (${file} is missing).`,
    );
  });

  const { commit } = z
    .object({ commit: z.string().regex(/^[0-9a-f]{40}$/) })
    .parse(JSON.parse(text));

  return commit;
}

async function readRunning(file: string) {
  return readFile(file, "utf8")
    .then((text) => runningSchema.safeParse(JSON.parse(text)).data)
    .catch(() => undefined);
}

const ours = (running: Running) =>
  running.started !== null &&
  processStartIdentity(running.pid) === running.started;

/** The running server, when it is ours and answers with this commit. */
async function healthy(file: string, commit: string) {
  const running = await readRunning(file);

  if (!running) return undefined;

  if (ours(running) && (await version(running.port)) === commit) return running;

  // A server of another install, or one that stopped answering.
  await stop(running);

  return undefined;
}

async function version(port: number) {
  return fetch(`http://127.0.0.1:${port}/version`, {
    signal: AbortSignal.timeout(VERSION_TIMEOUT_MS),
  })
    .then((response) => (response.ok ? response.text() : undefined))
    .catch(() => undefined);
}

async function stop(running: Running) {
  if (!ours(running)) return;

  try {
    process.kill(running.pid, "SIGTERM");
  } catch {
    return;
  }

  for (let i = 0; i < 50 && processStartIdentity(running.pid) !== null; i++)
    await delay(100);
}

async function startServer(
  root: string,
  files: ReturnType<typeof remoteLanguageServerFiles>,
  env: NodeJS.ProcessEnv,
  timeoutMs = START_TIMEOUT_MS,
) {
  const { extensionsDir, serverDataDir } = remoteServerPaths(env);

  // A new token for every server; only this user can read it, and it is never
  // an argument, in the environment or in the log.
  const temporary = `${files.tokenFile}.${process.pid}.tmp`;
  await writeFile(temporary, randomBytes(32).toString("hex"), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, files.tokenFile);

  const log = await open(files.logFile, "a", 0o600);
  const logStart = (await stat(files.logFile)).size;

  const child = spawn(
    process.execPath,
    [
      path.join(root, "out", "server-main.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--connection-token-file",
      files.tokenFile,
      "--server-data-dir",
      serverDataDir,
      "--extensions-dir",
      extensionsDir,
      "--accept-server-license-terms",
      ...IDLE_ARGS,
      ...(env[SHUTDOWN_WITHOUT_DELAY_ENV] === "1"
        ? ["--remote-auto-shutdown-without-delay"]
        : []),
    ],
    {
      cwd: serverDataDir,
      detached: true,
      env,
      stdio: ["ignore", log.fd, log.fd],
    },
  );

  let exited = false;
  let failure: Error | undefined;
  child.once("exit", () => (exited = true));
  child.once("error", (error) => {
    exited = true;
    failure = error;
  });
  child.unref();
  await log.close();

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline && !exited) {
    const output = (await readFile(files.logFile))
      .subarray(logStart)
      .toString("utf8");

    const port = Number(LISTENING.exec(output)?.[1]);

    if (port && child.pid !== undefined) {
      const running: Running = {
        pid: child.pid,
        started: processStartIdentity(child.pid),
        port,
      };

      await writeFile(files.runningFile, `${JSON.stringify(running)}\n`, {
        mode: 0o600,
      });

      return port;
    }

    await delay(100);
  }

  if (!exited && child.pid !== undefined) process.kill(child.pid, "SIGTERM");

  const tail = existsSync(files.logFile)
    ? (await readFile(files.logFile))
        .subarray(logStart)
        .toString("utf8")
        .trimEnd()
        .split("\n")
        .slice(-10)
        .join("\n")
    : "";

  throw new Error(
    `The VS Code server did not start${failure ? `: ${failure.message}` : exited ? "" : ` within ${timeoutMs / 1_000} s`}. The end of ${files.logFile}:\n${tail}`,
  );
}
