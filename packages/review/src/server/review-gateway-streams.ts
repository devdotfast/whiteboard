import type http from "node:http";

import {
  type JsonObject,
  type ReviewApiSummary,
  type ReviewGatewayHostState,
  isJsonObject,
  parseJsonText,
} from "@dev.fast/review-protocol";
import { coverageModeSchema } from "@review/review-api/review-progress.js";
import { z } from "zod";

import {
  type GatewayHosts,
  type GatewayRemote,
  UUID,
} from "./review-gateway-hosts.js";
import { mergeLists } from "./review-gateway-list.js";
import {
  type GatewayMemory,
  type ListMode,
  listEntriesSchema,
} from "./review-gateway-memory.js";
import {
  chunks,
  keepOpen,
  readLines,
  reconnect,
} from "./review-gateway-transport.js";
import { serverJson } from "./review-server-core.js";

const LIST_MODES: readonly ListMode[] = ["structural", "textual"];

const subscriptionsSchema = z.array(
  z.strictObject({
    reviewId: z.string().min(1).nullable(),
    mode: coverageModeSchema,
  }),
);

const lineSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("list"),
    mode: z.enum(LIST_MODES),
    reviews: z.array(z.unknown()),
  }),
  z.object({
    kind: z.literal("review"),
    reviewId: z.string(),
    value: z.unknown().optional(),
  }),
]);

export type Located =
  | "laptop"
  | { remote: GatewayRemote }
  | { down: ReviewGatewayHostState }
  | undefined;

export const downDetail = (down: ReviewGatewayHostState) =>
  down.detail ?? `${down.alias} is ${down.state}.`;

export const isSnapshotOf = (
  value: unknown,
  reviewId: string,
): value is JsonObject =>
  UUID.test(reviewId) && isJsonObject(value) && value.reviewId === reviewId;

export function withoutTutorial(value: JsonObject): JsonObject | undefined {
  if (!isJsonObject(value.origin) || !("tutorial" in value.origin))
    return undefined;
  const { tutorial: _, ...origin } = value.origin;

  return { ...value, origin };
}

const watchPath = (subscriptions: object[]) =>
  `/reviews-api/watch?subscriptions=${encodeURIComponent(JSON.stringify(subscriptions))}`;

function parseLine(text: string) {
  try {
    return lineSchema.safeParse(parseJsonText(text)).data;
  } catch {
    return undefined;
  }
}

export function createGatewayStreams(input: {
  hosts: GatewayHosts;
  memory: GatewayMemory;
  local(request: Request): Response | Promise<Response>;
  locate(reviewId: string): Located;
  lookup(reviewId: string): Promise<Located>;
  onLaptop(reviewId: string): void;
  log(message: string): void;
}) {
  const { hosts, memory } = input;
  const feeds = new Map<GatewayRemote, AbortController>();
  const clients = new Set<Client>();
  const passThrough = new Set<() => void>();
  const conflicts = new Set<string>();
  const refused = new Set<string>();
  let onlineKey = "";

  const merge = (mode: ListMode, laptop: ReviewApiSummary[]) =>
    mergeLists(
      mode,
      laptop,
      {
        states: hosts.states(),
        serving: (serverId) => hosts.serving(serverId) !== undefined,
        serverIdOf: (alias) => memory.serverIdOf(alias),
        list: (serverId, listMode) => memory.list(serverId, listMode),
      },
      (entry) => {
        if (laptop.some((local) => local.reviewId === entry.reviewId))
          input.onLaptop(entry.reviewId);

        if (conflicts.has(entry.reviewId)) return;
        conflicts.add(entry.reviewId);
        input.log(
          `Review ${entry.reviewId} is also listed by ${entry.host}; the machine listed first keeps it.`,
        );
      },
    );

  function feedLine(remote: GatewayRemote, text: string) {
    const line = parseLine(text);

    if (line?.kind !== "list" || remote.serverId === undefined) return;

    memory.setList(
      remote.serverId,
      hosts.machineAlias(remote.serverId) ?? remote.alias,
      line.mode,
      listEntriesSchema
        .parse(line.reviews)
        .filter((entry) => UUID.test(entry.reviewId)),
    );

    for (const client of clients) client.lists();
  }

  function syncFeeds() {
    const online = new Set(hosts.online());

    for (const [remote, abort] of feeds)
      if (!online.has(remote)) {
        abort.abort();
        feeds.delete(remote);
      }

    for (const remote of online) {
      if (feeds.has(remote)) continue;
      const abort = new AbortController();
      feeds.set(remote, abort);

      keepOpen({
        hosts,
        remote,
        path: watchPath(LIST_MODES.map((mode) => ({ reviewId: null, mode }))),
        signal: abort.signal,
        read: (body) => readLines(body, (text) => feedLine(remote, text)),
      });
    }
  }

  interface Client {
    lists(): void;
    refresh(): void;
    retryUnclaimed(): void;
    stop(): void;
  }

  function openClient(
    subscriptions: z.infer<typeof subscriptionsSchema>,
    signal: AbortSignal,
  ): Response {
    const modes = new Set<ListMode>();
    const reviews = new Map<string, ListMode>();

    for (const { reviewId, mode } of subscriptions)
      if (reviewId === null) modes.add(mode);
      else if (!reviews.has(reviewId)) reviews.set(reviewId, mode);

    const encoder = new TextEncoder();
    const pending = new Map<string, string>();
    const sent = new Map<string, string>();
    const laptopLists = new Map<ListMode, ReviewApiSummary[]>();
    const reportedDown = new Set<string>();
    const resolving = new Set<string>();
    const looked = new Set<string>();
    const unclaimed = new Set<string>();

    const upstreams = new Map<
      "laptop" | GatewayRemote,
      { key: string; abort: AbortController }
    >();

    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let flushing = false;
    let stopped = false;

    const flush = () => {
      if (!controller || !pending.size) return;

      if (controller.desiredSize === null || controller.desiredSize <= 0)
        return;
      const lines: string[] = [];

      for (const [item, line] of pending)
        if (sent.get(item) !== line) {
          lines.push(line);
          sent.set(item, line);
        }

      pending.clear();

      if (lines.length)
        controller.enqueue(encoder.encode(`${lines.join("\n")}\n`));
    };

    const emit = (item: string, line: string) => {
      if (stopped) return;
      pending.set(item, line);

      if (flushing) return;
      flushing = true;
      queueMicrotask(() => {
        flushing = false;
        flush();
      });
    };

    const emitList = (mode: ListMode) => {
      const laptop = laptopLists.get(mode);

      if (laptop)
        emit(
          `list:${mode}`,
          JSON.stringify({ kind: "list", mode, reviews: merge(mode, laptop) }),
        );
    };

    const emitReview = (reviewId: string, text: string) => {
      reportedDown.delete(reviewId);
      emit(`review:${reviewId}`, text);
    };

    const down = (reviewId: string, state: ReviewGatewayHostState) => {
      if (reportedDown.has(reviewId)) return;
      reportedDown.add(reviewId);
      emit(
        `review:${reviewId}`,
        JSON.stringify({ kind: "review", reviewId, error: downDetail(state) }),
      );
    };

    const openLaptop = (ids: Map<string, ListMode>, abort: AbortSignal) => {
      const path = watchPath([
        ...[...modes].map((mode) => ({ reviewId: null, mode })),
        ...[...ids].map(([reviewId, mode]) => ({ reviewId, mode })),
      ]);

      void reconnect(abort, async () => {
        try {
          const response = await input.local(
            new Request(`http://gateway${path}`),
          );

          if (response.body)
            await readLines(chunks(response.body, abort), (text) => {
              const line = parseLine(text);

              if (line?.kind === "list" && modes.has(line.mode)) {
                // SAFETY: the laptop's own server writes ReviewApiSummary entries.
                laptopLists.set(line.mode, line.reviews as ReviewApiSummary[]);
                emitList(line.mode);
              } else if (line?.kind === "review" && ids.has(line.reviewId))
                emitReview(line.reviewId, text);
            });
        } catch {}
      });
    };

    const openRemote = (
      remote: GatewayRemote,
      ids: Map<string, ListMode>,
      abort: AbortSignal,
    ) =>
      keepOpen({
        hosts,
        remote,
        path: watchPath(
          [...ids].map(([reviewId, mode]) => ({ reviewId, mode })),
        ),
        signal: abort,
        read: (body) =>
          readLines(body, (text) => {
            const line = parseLine(text);

            if (line?.kind !== "review" || !ids.has(line.reviewId)) return;
            const { reviewId, value } = line;

            if (value === undefined) return emitReview(reviewId, text);

            if (isSnapshotOf(value, reviewId)) {
              const stripped = withoutTutorial(value);

              return emitReview(
                reviewId,
                stripped
                  ? JSON.stringify({
                      kind: "review",
                      reviewId,
                      value: stripped,
                    })
                  : text,
              );
            }

            if (!refused.has(`${remote.alias} ${reviewId}`)) {
              refused.add(`${remote.alias} ${reviewId}`);
              input.log(
                `Refused ${remote.alias}'s update for ${reviewId}: it carried another review.`,
              );
            }

            emitReview(
              reviewId,
              JSON.stringify({
                kind: "review",
                reviewId,
                error: `${remote.alias} answered with another review, so the answer was refused.`,
              }),
            );
          }),
      });

    const where = (reviewId: string): Located =>
      unclaimed.has(reviewId)
        ? "laptop"
        : looked.has(reviewId)
          ? input.locate(reviewId)
          : undefined;

    const resolve = (reviewId: string) => {
      if (resolving.has(reviewId)) return;
      resolving.add(reviewId);

      void input
        .lookup(reviewId)
        .catch(() => undefined)
        .then(() => {
          resolving.delete(reviewId);
          looked.add(reviewId);

          if (input.locate(reviewId) === undefined) unclaimed.add(reviewId);
          client.refresh();
        });
    };

    const client: Client = {
      lists() {
        for (const mode of modes) emitList(mode);
      },
      refresh() {
        if (stopped) return;
        client.lists();

        const wanted = new Map<
          "laptop" | GatewayRemote,
          Map<string, ListMode>
        >();

        const want = (key: "laptop" | GatewayRemote, reviewId: string) => {
          let ids = wanted.get(key);

          if (!ids) wanted.set(key, (ids = new Map()));
          ids.set(reviewId, reviews.get(reviewId)!);
        };

        if (modes.size) wanted.set("laptop", new Map());

        for (const reviewId of reviews.keys()) {
          const located = where(reviewId);

          if (located === undefined) resolve(reviewId);
          else if (located === "laptop") want("laptop", reviewId);
          else if ("remote" in located) want(located.remote, reviewId);
          else if (located.down.state !== "connecting")
            down(reviewId, located.down);
        }

        for (const [key, upstream] of upstreams) {
          const ids = wanted.get(key);

          if (ids && JSON.stringify([...ids]) === upstream.key) continue;
          upstream.abort.abort();
          upstreams.delete(key);
        }

        for (const [key, ids] of wanted) {
          if (upstreams.has(key)) continue;
          const abort = new AbortController();
          upstreams.set(key, { key: JSON.stringify([...ids]), abort });

          if (key === "laptop") openLaptop(ids, abort.signal);
          else openRemote(key, ids, abort.signal);
        }
      },
      retryUnclaimed: () => unclaimed.clear(),
      stop() {
        if (stopped) return;
        stopped = true;
        clients.delete(client);

        for (const upstream of upstreams.values()) upstream.abort.abort();
        upstreams.clear();

        try {
          controller?.close();
        } catch {}
      },
    };

    signal.addEventListener("abort", () => client.stop(), { once: true });

    const body = new ReadableStream<Uint8Array>({
      start(started) {
        controller = started;
        clients.add(client);
        client.refresh();
      },
      pull: flush,
      cancel: () => client.stop(),
    });

    return new Response(body, {
      headers: {
        "content-type": "application/x-ndjson",
        "cache-control": "no-store",
      },
    });
  }

  async function passLaptop(request: Request): Promise<Response> {
    const response = await input.local(request);

    if (!response.body) return response;
    let stop = () => {};

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        stop = () => controller.terminate();
      },
    });

    passThrough.add(stop);
    void response.body
      .pipeTo(writable)
      .catch(() => undefined)
      .finally(() => passThrough.delete(stop));

    return new Response(readable, response);
  }

  return {
    watch(request: Request): Response | Promise<Response> {
      if (!hosts.states().length) return passLaptop(request);
      let subscriptions: z.infer<typeof subscriptionsSchema>;

      try {
        subscriptions = subscriptionsSchema.parse(
          JSON.parse(
            new URL(request.url).searchParams.get("subscriptions") ?? "",
          ),
        );
      } catch {
        return input.local(request);
      }

      return openClient(subscriptions, request.signal);
    },
    async list(request: Request): Promise<Response> {
      const response = await input.local(request);

      if (!response.ok || !hosts.states().length) return response;

      const mode =
        coverageModeSchema.safeParse(
          new URL(request.url).searchParams.get("mode") ?? undefined,
        ).data ?? "structural";

      const laptop: unknown = await response.json();

      // SAFETY: the laptop's own server answers ReviewApiSummary[].
      return serverJson(200, merge(mode, laptop as ReviewApiSummary[]));
    },
    changed() {
      syncFeeds();

      if (hosts.states().length) {
        for (const stop of passThrough) stop();
        passThrough.clear();
      }

      const key = JSON.stringify(
        hosts.online().map((remote) => [remote.alias, remote.serverId]),
      );

      for (const client of clients) {
        if (key !== onlineKey) client.retryUnclaimed();
        client.refresh();
      }

      onlineKey = key;
    },
    close() {
      for (const abort of feeds.values()) abort.abort();
      feeds.clear();

      for (const stop of passThrough) stop();

      for (const client of clients) client.stop();
    },
  };
}

export type GatewayStreams = ReturnType<typeof createGatewayStreams>;
