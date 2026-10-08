import {
  type EnsureRemoteLanguageServerInput,
  ensureRemoteLanguageServer,
} from "./remote-language-server";
import { missingToolchains } from "./remote-toolchains";
import { readReviewServerHealth, serverNotReady } from "./server-discovery";
import {
  type EnsureBackgroundServerInput,
  ensureBackgroundServer,
} from "./server/background-server";

export async function remoteAttach(input: {
  stateDir: string;
  env: NodeJS.ProcessEnv;
  packageRoot?: string;
  cli?: EnsureBackgroundServerInput["cli"];
  groups?: string[];
  ensureExtensions?: EnsureRemoteLanguageServerInput["ensure"];
  installTimeoutMs?: number;
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

  try {
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
  };
}
