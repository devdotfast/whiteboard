import { readFileSync } from "node:fs";
import path from "node:path";

import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { errorMessage, writePrivateJsonAtomic } from "@dev.fast/trace-core";
import { z } from "zod";

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const listEntrySchema = z.looseObject({
  reviewId: z.string().regex(UUID),
  version: z.number(),
  title: z.string(),
  createdAt: z.string(),
  repositoryName: z.string(),
  viewedAt: z.string().nullable(),
  trashedAt: z.string().nullable(),
  project: z.object({ id: z.string(), name: z.string() }).optional(),
});

export const listEntriesSchema = z.array(z.unknown()).transform(
  (entries) =>
    // SAFETY: the schema checks the fields the gateway and Home rely on.
    entries.filter(
      (entry) => listEntrySchema.safeParse(entry).success,
    ) as ReviewApiSummary[],
);

const lastListSchema = z.object({ structural: listEntriesSchema.optional() });

const memorySchema = z.record(
  z.string(),
  z.object({ alias: z.string(), lastList: lastListSchema.optional() }),
);

interface Server {
  alias: string;
  lastList: { structural?: ReviewApiSummary[] };
}

export function gatewayMemoryPath(home: string) {
  return path.join(home, "remotes.json");
}

export function openGatewayMemory(
  home: string,
  log: (message: string) => void = () => {},
) {
  const file = gatewayMemoryPath(home);
  const servers = new Map<string, Server>();

  try {
    const saved = memorySchema.parse(JSON.parse(readFileSync(file, "utf8")));

    for (const [serverId, { alias, lastList }] of Object.entries(saved))
      servers.set(serverId, { alias, lastList: lastList ?? {} });
  } catch (error) {
    // SAFETY: fs rejects with a Node ErrnoException carrying `code`.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      log(`Ignoring unreadable remote review memory ${file}: ${String(error)}`);
  }

  let writing = Promise.resolve();
  let queued = false;

  const save = () => {
    if (queued) return;
    queued = true;

    writing = writing
      .then(() => {
        queued = false;

        return writePrivateJsonAtomic(file, Object.fromEntries(servers));
      })
      .catch((cause: unknown) =>
        log(`Could not save remote review memory: ${errorMessage(cause)}`),
      );
  };

  return {
    serverIdOf(alias: string) {
      for (const [serverId, server] of servers)
        if (server.alias === alias) return serverId;

      return undefined;
    },
    list: (serverId: string) => servers.get(serverId)?.lastList.structural,
    setList(serverId: string, alias: string, reviews: ReviewApiSummary[]) {
      let server = servers.get(serverId);

      if (!server) {
        server = { alias, lastList: {} };
        servers.set(serverId, server);
      } else if (
        server.alias === alias &&
        JSON.stringify(server.lastList.structural) === JSON.stringify(reviews)
      )
        return;

      server.alias = alias;
      server.lastList.structural = reviews;
      save();
    },
    rename(serverId: string, alias: string) {
      const server = servers.get(serverId);

      if (!server || server.alias === alias) return;
      server.alias = alias;
      save();
    },
    flush: () => writing,
  };
}

export type GatewayMemory = ReturnType<typeof openGatewayMemory>;
