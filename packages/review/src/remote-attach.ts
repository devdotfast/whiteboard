import { gt as greaterVersion, valid as validVersion } from "semver";

import { readReviewPackageVersion } from "./package-paths";
import {
  type EnsureRemoteLanguageServerInput,
  ensureRemoteLanguageServer,
} from "./remote-language-server";
import { missingToolchains } from "./remote-toolchains";
import { readReviewServerHealth, serverNotReady } from "./server-discovery";
import {
  type EnsureBackgroundServerInput,
  ensureBackgroundServer,
  recordedBackgroundServer,
  stopBackgroundServer,
} from "./server/background-server";

export async function remoteAttach(input: {
  stateDir: string;
  env: NodeJS.ProcessEnv;
  packageRoot?: string;
  cli?: EnsureBackgroundServerInput["cli"];
  groups?: string[];
  ensureExtensions?: EnsureRemoteLanguageServerInput["ensure"];
  installTimeoutMs?: number;
  replace?: boolean;
  version?: string;
}) {
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
    extensions.abort();
    await Promise.all([language, toolchains]);
    throw error;
  }

  const { discovery, started } = server;

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
  const recorded = await recordedBackgroundServer(stateDir);

  if (!recorded) return undefined;
  const { discovery, health } = recorded;
  const running = health.version ?? "unknown";

  return running === version
    ? undefined
    : {
        version: running,
        pid: discovery.serverPid,
        startedBy: discovery.startedBy,
      };
}
