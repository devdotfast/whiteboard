import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Writable } from "node:stream";
import { promisify } from "node:util";

import { jsonObject, jsonString, parseJsonText } from "@dev.fast/json";
import { gt as greaterVersion, valid as validVersion } from "semver";

import {
  findReviewPackageRoot,
  readReviewPackageVersion,
} from "./package-paths";
import {
  type EnsureRemoteLanguageServerInput,
  ensureRemoteLanguageServer,
} from "./remote-language-server";
import { missingToolchains } from "./remote-toolchains";
import {
  readReviewServerDiscovery,
  readReviewServerHealth,
  serverNotReady,
} from "./server-discovery";
import {
  type EnsureBackgroundServerInput,
  ensureBackgroundServer,
  stopBackgroundServer,
} from "./server/background-server";
import { diffrExecutable, fetchedDiffrPath } from "./server/structural-diff";

const DIFFR_FETCH_TIMEOUT_MS = 15_000;

interface EnsureDiffrInput {
  stateDir: string;
  env: NodeJS.ProcessEnv;
  stderr: Writable;
  packageRoot?: string;
  fetcher?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function remoteAttach(
  input: EnsureDiffrInput & {
    cli?: EnsureBackgroundServerInput["cli"];
    groups?: string[];
    ensureExtensions?: EnsureRemoteLanguageServerInput["ensure"];
    installTimeoutMs?: number;
    replace?: boolean;
    version?: string;
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

  const toolchains = missingToolchains(input.groups ?? [], input.env);

  let server: Awaited<ReturnType<typeof ensureBackgroundServer>>;
  let previousVersion: string | undefined;

  let incompatibleRunning:
    | { version: string; pid: number; startedBy: "user" | "cli" | "desktop" }
    | undefined;

  try {
    const version = input.version ?? readReviewPackageVersion(import.meta.url);

    const other = input.replace
      ? await otherVersionRunning(input.stateDir, version)
      : undefined;

    if (other && (other.startedBy === "user" || newer(other.version, version)))
      incompatibleRunning = other;
    else if (other) {
      await stopBackgroundServer({ serverPid: other.pid });
      previousVersion = other.version;
    }

    server = await ensureBackgroundServer({
      stateDir: input.stateDir,
      env: input.env,
      startedBy: "desktop",
      cli: input.cli,
    });
  } catch (error) {
    abort.abort();
    extensions.abort();
    await Promise.all([fetching, language, toolchains]);
    throw error;
  }

  const { discovery, started } = server;
  const diffr = await fetching;

  const {
    languageServer,
    languageServerDetail,
    languageServerPending,
    languageGroups,
  } = await language;

  const missing = await toolchains;

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
    languageGroups: languageGroups.map(({ group, installed, detail }) => {
      const details = [detail, missing.get(group)].filter(Boolean).join("; ");

      return { group, installed, ...(details && { detail: details }) };
    }),
    ...(previousVersion !== undefined && { replaced: true, previousVersion }),
    ...(incompatibleRunning && { incompatibleRunning }),
  };
}

const newer = (running: string, own: string) =>
  validVersion(running) !== null &&
  validVersion(own) !== null &&
  greaterVersion(running, own);

async function otherVersionRunning(stateDir: string, version: string) {
  const discovery = await readReviewServerDiscovery(stateDir).catch(() => null);
  const health = discovery && (await readReviewServerHealth(discovery));

  if (!health || health.serverPid !== discovery.serverPid) return undefined;
  const running = health.version ?? "unknown";

  return running === version
    ? undefined
    : {
        version: running,
        pid: discovery.serverPid,
        startedBy: discovery.startedBy,
      };
}

export async function ensureDiffr(input: EnsureDiffrInput) {
  const packageRoot =
    input.packageRoot ?? findReviewPackageRoot(import.meta.url);

  const fetched = fetchedDiffrPath(input.stateDir);
  const executable = diffrExecutable(packageRoot, input.env, fetched);

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
