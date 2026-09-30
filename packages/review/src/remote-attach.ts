import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
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
import { diffrExecutable, fetchedDiffrPath } from "./server/structural-diff";

export const REMOTE_ATTACH_BEGIN = "WHITEBOARD-REMOTE-BEGIN";

export const REMOTE_ATTACH_END = "WHITEBOARD-REMOTE-END";

/** Desktop waits on the attach; a download that stalls longer is dropped. */
const DIFFR_FETCH_TIMEOUT_MS = 15_000;

interface EnsureDiffrInput {
  stateDir: string;
  env: NodeJS.ProcessEnv;
  stderr: Writable;
  packageRoot?: string;
  /** The package's fetcher by default. */
  fetcher?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** The review server Desktop reaches over SSH, started if none is healthy. */
export async function remoteAttach(
  input: EnsureDiffrInput & { cli?: EnsureBackgroundServerInput["cli"] },
) {
  const abort = new AbortController();
  const fetching = ensureDiffr({ ...input, signal: abort.signal });
  let server: Awaited<ReturnType<typeof ensureBackgroundServer>>;

  try {
    server = await ensureBackgroundServer({
      stateDir: input.stateDir,
      env: input.env,
      startedBy: "desktop",
      cli: input.cli,
    });
  } catch (error) {
    // A pending download must not hold the failed command open.
    abort.abort();
    await fetching;
    throw error;
  }

  const { discovery, started } = server;
  const diffr = await fetching;
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
 * Fetches this machine's diffr with the package's own fetcher, into the
 * package as `ensure:diffr` does, or into the state directory when the
 * package is not writable. Never fails: without diffr, structural diff is off.
 */
export async function ensureDiffr(input: EnsureDiffrInput) {
  const packageRoot =
    input.packageRoot ?? findReviewPackageRoot(import.meta.url);

  const fetched = fetchedDiffrPath(input.stateDir);

  const found = () =>
    diffrPresent(diffrExecutable(packageRoot, input.env, fetched), input.env);

  // An override, a bundled copy (a Desktop's signed runtime) or PATH wins.
  if (await found()) return true;

  const into = (await writable(path.join(packageRoot, "bin")))
    ? path.join(packageRoot, "bin")
    : path.dirname(fetched);

  try {
    await mkdir(into, { recursive: true });

    const fetcher =
      input.fetcher ??
      path.join(
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
        timeout: input.timeoutMs ?? DIFFR_FETCH_TIMEOUT_MS,
        killSignal: "SIGKILL",
        signal: input.signal,
      },
    );

    input.stderr.write(stderr);
  } catch (error) {
    input.stderr.write(
      `Could not fetch diffr: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  return found();
}

/** The directory, or its parent while it does not exist, takes new files. */
async function writable(directory: string): Promise<boolean> {
  const target = existsSync(directory) ? directory : path.dirname(directory);

  return access(target, constants.W_OK).then(
    () => true,
    () => false,
  );
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
