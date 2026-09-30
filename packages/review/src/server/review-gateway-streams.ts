import type http from "node:http";

import {
  type ReviewApiSummary,
  type ReviewGatewayHostState,
  parseJsonText,
} from "@dev.fast/review-protocol";
import { coverageModeSchema } from "@review/review-api/review-progress.js";
import { z } from "zod";

import {
  FIRST_BYTE_TIMEOUT_MS,
  FIRST_RETRY_MS,
  type GatewayHosts,
  type GatewayRemote,
  MAX_RETRY_MS,
  NO_ANSWER,
  UUID,
  jitter,
  remoteHeaders,
  send,
} from "./review-gateway-hosts.js";
import {
  type GatewayMemory,
  type ListMode,
  listEntriesSchema,
} from "./review-gateway-memory.js";
import { serverJson } from "./review-server-core.js";

/** A stream that stayed up this long starts its backoff again. */
const STEADY_MS = 10_000;

const MAX_LINE_CHARS = 64 * 1024 * 1024;

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
  z.object({ kind: z.literal("review"), reviewId: z.string() }),
]);

/** Where a review is read now. `undefined`: not known yet. */
export type Located =
  | "laptop"
  | { remote: GatewayRemote }
  | { down: ReviewGatewayHostState }
  | undefined;

/** The error a request or a stream gives for a host that cannot answer. */
export const downDetail = (down: ReviewGatewayHostState) =>
  down.detail ?? `${down.alias} is ${down.state}.`;

const watchPath = (subscriptions: object[]) =>
  `/reviews-api/watch?subscriptions=${encodeURIComponent(JSON.stringify(subscriptions))}`;

function parseLine(text: string) {
  try {
    return lineSchema.safeParse(parseJsonText(text)).data;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };

    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

/** Calls `line` with each newline-terminated line of a body. */
export async function readLines(
  body: AsyncIterable<Uint8Array>,
  line: (text: string) => void,
) {
  const decoder = new TextDecoder();
  let pending = "";

  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    let end: number;

    while ((end = pending.indexOf("\n")) !== -1) {
      line(pending.slice(0, end));
      pending = pending.slice(end + 1);
    }

    if (pending.length > MAX_LINE_CHARS) throw new Error("A line is too long.");
  }
}

/** A web stream's chunks, cancelled when `signal` aborts. */
function chunks(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);

  return {
    async *[Symbol.asyncIterator]() {
      signal.addEventListener("abort", cancel, { once: true });

      if (signal.aborted) cancel();

      try {
        for (;;) {
          const { value, done } = await reader.read();

          if (done) return;
          yield value;
        }
      } finally {
        signal.removeEventListener("abort", cancel);
        cancel();
      }
    },
  };
}

/**
 * Keeps one GET stream to a host open until `signal` aborts. When it ends,
 * /health is checked at once, so a host that is gone goes offline, and the
 * stream reopens with backoff. A host that does not answer in time is marked
 * offline.
 */
export function keepOpen(input: {
  hosts: GatewayHosts;
  remote: GatewayRemote;
  path: string;
  signal: AbortSignal;
  read(body: http.IncomingMessage): Promise<void>;
}) {
  const { remote, signal } = input;

  void (async () => {
    let delay = FIRST_RETRY_MS;

    while (!signal.aborted) {
      const started = Date.now();
      const abort = new AbortController();
      const leave = () => abort.abort();
      signal.addEventListener("abort", leave, { once: true });
      let timedOut = false;

      const firstByte = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, FIRST_BYTE_TIMEOUT_MS);

      try {
        const response = await send(remote, {
          method: "GET",
          path: input.path,
          headers: remoteHeaders(remote),
          signal: abort.signal,
        });

        clearTimeout(firstByte);

        if (response.statusCode === 200) await input.read(response);
      } catch {
        // Ended: /health decides below.
      } finally {
        clearTimeout(firstByte);
        signal.removeEventListener("abort", leave);
        abort.abort();
      }

      if (signal.aborted) return;

      if (timedOut) input.hosts.failed(remote, NO_ANSWER);
      else input.hosts.recheck(remote);

      if (Date.now() - started >= STEADY_MS) delay = FIRST_RETRY_MS;
      await sleep(jitter(delay), signal);
      delay = Math.min(delay * 2, MAX_RETRY_MS);
    }
  })();
}

/**
 * The merged list and the live updates: one list subscription to each online
 * machine, whose last lists the memory file keeps, and for each client
 * stream one stream to each machine that owns a review it follows.
 */
export function createGatewayStreams(input: {
  hosts: GatewayHosts;
  memory: GatewayMemory;
  /** The laptop's review routes, in process. */
  local(request: Request): Response | Promise<Response>;
  /** Where a review is read now, without asking anyone. */
  locate(reviewId: string): Located;
  /** Finds a review's owner, asking the machines when it is not known. */
  lookup(reviewId: string): Promise<Located>;
  log(message: string): void;
}) {
  const { hosts, memory } = input;
  const feeds = new Map<GatewayRemote, AbortController>();
  const clients = new Set<Client>();
  const conflicts = new Set<string>();
  let onlineKey = "";

  function decorate(
    entry: ReviewApiSummary,
    alias: string,
    hostState: NonNullable<ReviewApiSummary["hostState"]>,
  ): ReviewApiSummary {
    return {
      ...entry,
      // Two machines' repositories at one path stay two groups.
      ...(entry.repositoryGroup && {
        repositoryGroup: {
          key: `${alias}:${entry.repositoryGroup.key}`,
          label: entry.repositoryGroup.label,
        },
      }),
      host: alias,
      hostState,
      available: { sourceWindows: false, languageFeatures: false },
    };
  }

  /** Each machine's last list, in the setting's order, under its first alias. */
  function remoteEntries(mode: ListMode) {
    const entries: ReviewApiSummary[] = [];
    const seen = new Set<string>();

    for (const state of hosts.states()) {
      // A copy's reviews are its machine's; a host still connecting has
      // not been confirmed as any machine.
      if (state.state === "duplicate" || state.state === "connecting") continue;
      const serverId = state.serverId ?? memory.serverIdOf(state.alias);

      if (serverId === undefined || seen.has(serverId)) continue;
      seen.add(serverId);

      const hostState = hosts.serving(serverId)
        ? "online"
        : state.state === "incompatible"
          ? "incompatible"
          : "offline";

      for (const entry of memory.list(serverId, mode) ?? [])
        entries.push(decorate(entry, state.alias, hostState));
    }

    return entries;
  }

  /** The laptop's entries, then each machine's; the first owner keeps an id. */
  function merge(mode: ListMode, laptop: ReviewApiSummary[]) {
    const ids = new Set(laptop.map((entry) => entry.reviewId));
    const merged = [...laptop];

    for (const entry of remoteEntries(mode)) {
      if (ids.has(entry.reviewId)) {
        if (!conflicts.has(entry.reviewId)) {
          conflicts.add(entry.reviewId);
          input.log(
            `Review ${entry.reviewId} is also listed by ${entry.host}; the machine listed first keeps it.`,
          );
        }

        continue;
      }

      ids.add(entry.reviewId);
      merged.push(entry);
    }

    return merged;
  }

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
    /** The latest unsent line per item: a slow reader gets no backlog. */
    const pending = new Map<string, string>();
    const sent = new Map<string, string>();
    const laptopLists = new Map<ListMode, ReviewApiSummary[]>();
    /** Reviews whose host is down, already told so. */
    const reportedDown = new Set<string>();
    const resolving = new Set<string>();
    /** Reviews no machine claimed; the laptop answers for them. */
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

    // Lines that arrive together go out together.
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

      void (async () => {
        let delay = FIRST_RETRY_MS;

        while (!abort.aborted) {
          try {
            const response = await input.local(
              new Request(`http://gateway${path}`),
            );

            if (response.body)
              await readLines(chunks(response.body, abort), (text) => {
                const line = parseLine(text);

                if (line?.kind === "list" && modes.has(line.mode)) {
                  // SAFETY: the laptop's own server writes ReviewApiSummary entries.
                  laptopLists.set(
                    line.mode,
                    line.reviews as ReviewApiSummary[],
                  );
                  emitList(line.mode);
                } else if (line?.kind === "review" && ids.has(line.reviewId))
                  emitReview(line.reviewId, text);
              });
          } catch {
            // Reopened below.
          }

          if (abort.aborted) return;
          await sleep(jitter(delay), abort);
          delay = Math.min(delay * 2, MAX_RETRY_MS);
        }
      })();
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

            // Forwarded as the remote sent it.
            if (line?.kind === "review" && ids.has(line.reviewId))
              emitReview(line.reviewId, text);
          }),
      });

    const where = (reviewId: string): Located =>
      unclaimed.has(reviewId) ? "laptop" : input.locate(reviewId);

    const resolve = (reviewId: string) => {
      if (resolving.has(reviewId)) return;
      resolving.add(reviewId);

      void input
        .lookup(reviewId)
        .catch(() => undefined)
        .then(() => {
          resolving.delete(reviewId);

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
          else down(reviewId, located.down);
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
        } catch {
          // Already cancelled by the reader.
        }
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

  return {
    /** `GET /reviews-api/watch` for every machine. */
    watch(request: Request): Response | Promise<Response> {
      let subscriptions: z.infer<typeof subscriptionsSchema>;

      try {
        subscriptions = subscriptionsSchema.parse(
          JSON.parse(
            new URL(request.url).searchParams.get("subscriptions") ?? "",
          ),
        );
      } catch {
        // The laptop answers a malformed request.
        return input.local(request);
      }

      return openClient(subscriptions, request.signal);
    },
    /** `GET /reviews-api`: the laptop's list, then each machine's. */
    async list(request: Request): Promise<Response> {
      const response = await input.local(request);

      if (!response.ok) return response;

      const mode =
        coverageModeSchema.safeParse(
          new URL(request.url).searchParams.get("mode") ?? undefined,
        ).data ?? "structural";

      const laptop: unknown = await response.json();

      // SAFETY: the laptop's own server answers ReviewApiSummary[].
      return serverJson(200, merge(mode, laptop as ReviewApiSummary[]));
    },
    /** Host states changed. */
    changed() {
      syncFeeds();

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

      for (const client of clients) client.stop();
    },
  };
}

export type GatewayStreams = ReturnType<typeof createGatewayStreams>;
