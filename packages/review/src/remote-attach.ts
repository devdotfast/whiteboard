import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Writable } from "node:stream";
import { promisify } from "node:util";

import { findReviewPackageRoot } from "./package-paths";
import { readReviewServerHealth, serverNotReady } from "./server-discovery";
import {
  type EnsureBackgroundServerInput,
  ensureBackgroundServer,
} from "./server/background-server";
import { diffrExecutable } from "./server/structural-diff";

export const REMOTE_ATTACH_BEGIN = "WHITEBOARD-REMOTE-BEGIN";

export const REMOTE_ATTACH_END = "WHITEBOARD-REMOTE-END";

/** Desktop waits on the attach; a download that stalls longer is dropped. */
const DIFFR_FETCH_TIMEOUT_MS = 15_000;

interface RemoteAttachInput {
  stateDir: string;
  env: NodeJS.ProcessEnv;
  stderr: Writable;
  packageRoot?: string;
  cli?: EnsureBackgroundServerInput["cli"];
}

/** The review server Desktop reaches over SSH, started if none is healthy. */
export async function remoteAttach(input: RemoteAttachInput) {
  const [{ discovery, started }, diffr] = await Promise.all([
    ensureBackgroundServer({
      stateDir: input.stateDir,
      env: input.env,
      startedBy: "desktop",
      cli: input.cli,
    }),
    ensureDiffr(input),
  ]);

  const health = await readReviewServerHealth(discovery);

  if (!health) throw serverNotReady(input.stateDir);

  return {
    event: "remote.attach" as const,
    version: health.version ?? null,
    commit: health.commit ?? null,
    serverId: health.serverId ?? null,
    url: discovery.url,
    token: discovery.token,
    startedServer: started,
    diffr,
  };
}

/**
 * Fetches this machine's diffr into the package, as `ensure:diffr` does.
 * Never fails: without diffr the server runs and structural diff is off.
 */
export async function ensureDiffr(input: {
  env: NodeJS.ProcessEnv;
  stderr: Writable;
  packageRoot?: string;
}) {
  const packageRoot =
    input.packageRoot ?? findReviewPackageRoot(import.meta.url);

  const into = path.join(packageRoot, "bin");

  // A root-owned global install cannot take it; do not download for nothing.
  const writable = await access(
    existsSync(into) ? into : packageRoot,
    constants.W_OK,
  ).then(
    () => true,
    () => false,
  );

  if (writable)
    try {
      const fetcher = path.join(
        path.dirname(
          createRequire(import.meta.url).resolve(
            "@dev.fast/diffr/package.json",
          ),
        ),
        "bin",
        "fetch.mjs",
      );

      const { stderr } = await promisify(execFile)(
        process.execPath,
        [fetcher, "--into", into],
        {
          env: input.env,
          timeout: DIFFR_FETCH_TIMEOUT_MS,
          killSignal: "SIGKILL",
        },
      );

      input.stderr.write(stderr);
    } catch (error) {
      input.stderr.write(
        `Could not fetch diffr: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }

  return diffrPresent(diffrExecutable(packageRoot, input.env), input.env);
}

async function diffrPresent(executable: string, env: NodeJS.ProcessEnv) {
  const candidates = executable.includes(path.sep)
    ? [executable]
    : (env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, executable));

  for (const candidate of candidates)
    if (
      await access(candidate, constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return true;

  return false;
}
