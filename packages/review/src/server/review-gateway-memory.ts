import { readFileSync } from "node:fs";
import path from "node:path";

import { writePrivateJsonAtomic } from "@dev.fast/trace-core";
import { z } from "zod";

const memorySchema = z.record(
  z.string(),
  z.object({ alias: z.string(), reviewIds: z.array(z.string()) }),
);

export function gatewayMemoryPath(home: string) {
  return path.join(home, "remote-reviews.json");
}

/**
 * Which remote owns which review, keyed by the remote's stable id so an
 * alias can be renamed. Kept so a review on a host that is down, or refused,
 * still names its host after a restart.
 */
export function openGatewayMemory(
  home: string,
  log: (message: string) => void = () => {},
) {
  const file = gatewayMemoryPath(home);
  const servers = new Map<string, { alias: string; reviewIds: Set<string> }>();
  const owners = new Map<string, string>();

  try {
    const saved = memorySchema.parse(JSON.parse(readFileSync(file, "utf8")));

    for (const [serverId, { alias, reviewIds }] of Object.entries(saved)) {
      servers.set(serverId, { alias, reviewIds: new Set(reviewIds) });

      for (const id of reviewIds) owners.set(id, serverId);
    }
  } catch (error) {
    // SAFETY: fs rejects with a Node ErrnoException carrying `code`.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      log(`Ignoring unreadable remote review memory ${file}: ${String(error)}`);
  }

  let writing = Promise.resolve();

  const save = () => {
    const value = Object.fromEntries(
      [...servers].map(([serverId, { alias, reviewIds }]) => [
        serverId,
        { alias, reviewIds: [...reviewIds] },
      ]),
    );

    writing = writing
      .then(() => writePrivateJsonAtomic(file, value))
      .catch((error: unknown) =>
        log(`Could not save remote review memory: ${String(error)}`),
      );
  };

  return {
    owner(reviewId: string) {
      const serverId = owners.get(reviewId);
      const server = serverId && servers.get(serverId);

      return server ? { serverId, alias: server.alias } : undefined;
    },
    /** Also records `alias` as the server's latest name. */
    remember(serverId: string, alias: string, reviewId: string) {
      const server = servers.get(serverId);

      if (server?.alias === alias && owners.get(reviewId) === serverId) return;

      const previous = owners.get(reviewId);

      if (previous !== undefined && previous !== serverId)
        servers.get(previous)?.reviewIds.delete(reviewId);

      if (server) {
        server.alias = alias;
        server.reviewIds.add(reviewId);
      } else servers.set(serverId, { alias, reviewIds: new Set([reviewId]) });

      owners.set(reviewId, serverId);
      save();
    },
    forget(reviewId: string) {
      const serverId = owners.get(reviewId);

      if (serverId === undefined) return;
      owners.delete(reviewId);
      servers.get(serverId)?.reviewIds.delete(reviewId);
      save();
    },
    flush: () => writing,
  };
}

export type GatewayMemory = ReturnType<typeof openGatewayMemory>;
