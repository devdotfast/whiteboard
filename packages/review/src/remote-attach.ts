import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Writable } from "node:stream";
import { promisify } from "node:util";

import { jsonObject, jsonString, parseJsonText } from "@dev.fast/json";

import { findReviewPackageRoot } from "./package-paths";
import {
  type EnsureRemoteLanguageServerInput,
  ensureRemoteLanguageServer,
} from "./remote-language-server";
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

/**
 * The review server Desktop reaches over SSH, started if none is healthy,
 * and the VS Code server for language features, which may be missing.
 */
export async function remoteAttach(
  input: EnsureDiffrInput & {
    cli?: EnsureBackgroundServerInput["cli"];
    groups?: string[];
    ensureExtensions?: EnsureRemoteLanguageServerInput["ensure"];
    installTimeoutMs?: number;
  },
) {
  const abort = new AbortController();
  const fetching = ensureDiffr({ ...input, signal: abort.signal });
  const extensions = new AbortController();

  const language = ensureRemoteLanguageServer({
    env: input.env,
    packageRoot: input.packageRoot,
    groups: input.groups,
    signal: extensions.signal,
    ensure: input.ensureExtensions,
    installTimeoutMs: input.installTimeoutMs,
    cli: input.cli,
  });

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
    extensions.abort();
    await Promise.all([fetching, language]);
    throw error;
  }

  const { discovery, started } = server;
  const diffr = await fetching;

  const { languageServer, languageServerDetail, languageServerPending } =
    await language;

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
    languageServer,
    ...(languageServerDetail !== undefined && { languageServerDetail }),
    ...(languageServerPending && { languageServerPending }),
  };
}

/**
 * Keeps the diffr that remote attach fetched into the state directory at the
 * pinned version, using the package's own fetcher, which does nothing while
 * its stamp matches. A copy we did not fetch is never touched. Never fails:
 * without a current diffr, structural diff is off.
 */
export async function ensureDiffr(input: EnsureDiffrInput) {
  const packageRoot =
    input.packageRoot ?? findReviewPackageRoot(import.meta.url);

  const fetched = fetchedDiffrPath(input.stateDir);
  const executable = diffrExecutable(packageRoot, input.env, fetched);

  // An override, the package's own copy (a Desktop's signed runtime) or PATH.
  if (executable !== fetched && (await diffrPresent(executable, input.env)))
    return true;

  const diffrPackage = createRequire(import.meta.url).resolve(
    "@dev.fast/diffr/package.json",
  );

  const into = path.dirname(fetched);

  try {
    await mkdir(into, { recursive: true });

    const { stderr } = await promisify(execFile)(
      process.execPath,
      [
        input.fetcher ??
          path.join(path.dirname(diffrPackage), "bin", "fetch.mjs"),
        "--into",
        into,
      ],
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

  // A refresh that failed leaves an older copy, which is not the pinned diffr.
  const pinned = await stampVersion(diffrPackage);
  const stamp = await stampVersion(path.join(into, "diffr.stamp.json"));

  return (
    stamp !== undefined &&
    stamp === pinned &&
    (await diffrPresent(fetched, input.env))
  );
}

async function stampVersion(file: string) {
  return readFile(file, "utf8").then(
    (text) => jsonString(jsonObject(parseJsonText(text))?.version),
    () => undefined,
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
