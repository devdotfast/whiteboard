import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { devReviewHome } from "./review-home-paths.js";

const discoverySchema = z.object({
  version: z.literal(1),
  instanceId: z.uuid(),
  url: z.url().refine((value) => {
    const url = new URL(value);

    return url.protocol === "http:" && url.hostname === "127.0.0.1";
  }),
  serverPid: z.number().int().positive(),
  token: z.string().min(1),
});

export type ReviewServerDiscovery = z.infer<typeof discoverySchema>;

export function reviewServerStateDir(env: NodeJS.ProcessEnv = process.env) {
  return env.DEV_REVIEW_SERVER_DIR?.trim()
    ? path.resolve(env.DEV_REVIEW_SERVER_DIR.trim())
    : devReviewHome(env);
}

export function reviewServerDiscoveryPath(stateDir: string) {
  return path.join(stateDir, "review-server", "server.json");
}

export async function readReviewServerDiscovery(
  stateDir: string,
): Promise<ReviewServerDiscovery | null> {
  let source: string;

  try {
    source = await readFile(reviewServerDiscoveryPath(stateDir), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }

  try {
    return discoverySchema.parse(JSON.parse(source));
  } catch {
    throw new Error(
      `Whiteboard server discovery in ${stateDir} is invalid or incompatible. Restart it with this version of whiteboard server start.`,
    );
  }
}

export async function reviewServerIsHealthy(discovery: ReviewServerDiscovery) {
  return (await readReviewServerHealth(discovery)) !== null;
}

/** The recorded server's /health, or null when another or none answers. */
export async function readReviewServerHealth(
  discovery: Pick<ReviewServerDiscovery, "url" | "token" | "instanceId">,
) {
  try {
    const response = await fetch(`${discovery.url}/health`, {
      headers: { "x-review-token": discovery.token },
      signal: AbortSignal.timeout(1_500),
    });

    if (!response.ok) return null;

    const health = z
      .object({
        ok: z.literal(true),
        instanceId: z.string(),
        serverId: z.string().optional(),
        version: z.string().optional(),
      })
      .safeParse(await response.json());

    return health.success && health.data.instanceId === discovery.instanceId
      ? health.data
      : null;
  } catch {
    return null;
  }
}

export function serverNotReady(stateDir: string) {
  return new Error(
    `Whiteboard server is not ready in ${stateDir}. Run whiteboard server start --state-dir ${JSON.stringify(stateDir)}, then retry.`,
  );
}
