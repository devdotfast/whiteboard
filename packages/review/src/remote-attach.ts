import { readReviewServerHealth, serverNotReady } from "./server-discovery";
import {
  type EnsureBackgroundServerInput,
  ensureBackgroundServer,
} from "./server/background-server";

export async function remoteAttach(input: {
  stateDir: string;
  env: NodeJS.ProcessEnv;
  cli?: EnsureBackgroundServerInput["cli"];
}) {
  const { discovery, started } = await ensureBackgroundServer({
    stateDir: input.stateDir,
    env: input.env,
    startedBy: "desktop",
    cli: input.cli,
  });

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
  };
}
