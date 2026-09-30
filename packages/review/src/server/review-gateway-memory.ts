import { readFileSync } from "node:fs";
import path from "node:path";

import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { errorMessage, writePrivateJsonAtomic } from "@dev.fast/trace-core";
import { z } from "zod";

export type ListMode = "structural" | "textual";

/** What the gateway reads of a remote's list entry; the rest passes through. */
const listEntrySchema = z.looseObject({
  reviewId: z.string(),
  version: z.number(),
  title: z.string(),
  createdAt: z.string(),
  repositoryName: z.string(),
  viewedAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
  repositoryGroup: z.object({ key: z.string(), label: z.string() }).optional(),
});

/** A list, keeping the entries that have the shape of a list entry. */
export const listEntriesSchema = z.array(z.unknown()).transform(
  (entries) =>
    // SAFETY: the schema checks the fields the gateway and Home rely on.
    entries.filter(
      (entry) => listEntrySchema.safeParse(entry).success,
    ) as ReviewApiSummary[],
);

const lastListSchema = z.object({
  structural: listEntriesSchema.optional(),
  textual: listEntriesSchema.optional(),
});

const memorySchema = z.record(
  z.string(),
  z.object({
    alias: z.string(),
    reviewIds: z.array(z.string()),
    lastList: lastListSchema.optional(),
  }),
);

interface Server {
  alias: string;
  reviewIds: Set<string>;
  /** The last list the server sent, per mode, as it sent it. */
  lastList: Partial<Record<ListMode, ReviewApiSummary[]>>;
}

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
  const servers = new Map<string, Server>();
  const owners = new Map<string, string>();
  /** The server ids whose last lists hold each review id. */
  const listed = new Map<string, Set<string>>();

  const index = () => {
    listed.clear();

    for (const [serverId, server] of servers)
      for (const list of Object.values(server.lastList))
        for (const entry of list) {
          let serverIds = listed.get(entry.reviewId);

          if (!serverIds) listed.set(entry.reviewId, (serverIds = new Set()));
          serverIds.add(serverId);
        }
  };

  try {
    const saved = memorySchema.parse(JSON.parse(readFileSync(file, "utf8")));

    for (const [serverId, { alias, reviewIds, lastList }] of Object.entries(
      saved,
    )) {
      servers.set(serverId, {
        alias,
        reviewIds: new Set(reviewIds),
        lastList: lastList ?? {},
      });

      for (const id of reviewIds) owners.set(id, serverId);
    }

    index();
  } catch (error) {
    // SAFETY: fs rejects with a Node ErrnoException carrying `code`.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      log(`Ignoring unreadable remote review memory ${file}: ${String(error)}`);
  }

  let writing = Promise.resolve();
  let queued = false;

  // One write for any number of changes made before it starts.
  const save = () => {
    if (queued) return;
    queued = true;

    writing = writing
      .then(() => {
        queued = false;

        return writePrivateJsonAtomic(
          file,
          Object.fromEntries(
            [...servers].map(([serverId, { alias, reviewIds, lastList }]) => [
              serverId,
              {
                alias,
                reviewIds: [...reviewIds],
                ...(Object.keys(lastList).length > 0 && { lastList }),
              },
            ]),
          ),
        );
      })
      .catch((cause: unknown) =>
        log(`Could not save remote review memory: ${errorMessage(cause)}`),
      );
  };

  return {
    /**
     * The server that holds a review, from routing or else from the last
     * lists; of several lists, the first server in `order` (the setting's).
     */
    owner(reviewId: string, order: readonly string[] = []) {
      const candidates = listed.get(reviewId);

      const serverId =
        owners.get(reviewId) ??
        (candidates &&
          (order.find((candidate) => candidates.has(candidate)) ??
            [...candidates][0]));

      const server = serverId && servers.get(serverId);

      return server ? { serverId, alias: server.alias } : undefined;
    },
    /** The server id last recorded under `alias`. */
    serverIdOf(alias: string) {
      for (const [serverId, server] of servers)
        if (server.alias === alias) return serverId;

      return undefined;
    },
    list: (serverId: string, mode: ListMode) =>
      servers.get(serverId)?.lastList[mode],
    /** Keeps only the last list a server sent. */
    setList(
      serverId: string,
      alias: string,
      mode: ListMode,
      reviews: ReviewApiSummary[],
    ) {
      let server = servers.get(serverId);

      if (!server) {
        server = { alias, reviewIds: new Set(), lastList: {} };
        servers.set(serverId, server);
      } else if (
        server.alias === alias &&
        JSON.stringify(server.lastList[mode]) === JSON.stringify(reviews)
      )
        return;

      server.alias = alias;
      server.lastList[mode] = reviews;
      index();
      save();
    },
    /** The alias last used for `serverId`. */
    alias: (serverId: string) => servers.get(serverId)?.alias,
    /** Records the alias that now speaks for a server this file knows. */
    rename(serverId: string, alias: string) {
      const server = servers.get(serverId);

      if (!server || server.alias === alias) return;
      server.alias = alias;
      save();
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
      } else
        servers.set(serverId, {
          alias,
          reviewIds: new Set([reviewId]),
          lastList: {},
        });

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
