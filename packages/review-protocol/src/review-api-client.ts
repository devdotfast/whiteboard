import type { JsonObject } from "@dev.fast/json";

import type { ReviewGatewayHostState } from "./contracts.js";

/** List metadata for the authenticated local catalog; document contents stay in snapshots. */
export interface ReviewApiSummary {
  reviewId: string;
  version: number;
  title: string;
  /** Absent for a review. The one scratchpad has no pins or lifecycle. */
  kind?: "scratchpad";
  /** What is on the scratchpad, for its Home card; absent for a review. */
  contents?: { blocks: number; diagrams: number };
  /** Absent for a document whose references all carry their own pins. */
  pins?: {
    repositoryId: string;
    base: string;
    head: string;
    worktreeRevision?: string;
  };
  target?:
    | { kind: "worktree"; repositoryId: string; base?: string }
    | { kind: "commits"; repositoryId: string; head: string; base?: string };
  createdAt: string;
  /** Timestamp of the earliest retained review version, when known. */
  firstCreatedAt?: string;
  /** Present on reviews imported from the legacy MDX store. */
  origin?: {
    branch?: string;
    baseRef?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
    revision?: string;
  };
  /** Shared imports have separate local checkouts but retain their remote identity. */
  shared?: { cloneUrl?: string };
  /** Display grouping only; source pins remain bound to their own checkout. */
  repositoryGroup?: { key: string; label: string };
  repositoryName: string;
  repositoryPath?: string;
  diffStats?: {
    fileCount: number;
    additions: number;
    deletions: number;
  } | null;
  viewedAt: string | null;
  dismissedAt: string | null;
  /** An agent holds a live lease; absent on shared reviews. */
  working?: boolean;
  /** The SSH alias of the machine that holds the review; absent on the laptop. */
  host?: string;
  /** Set with `host`; a review server never writes these three. A
   * duplicate alias lists nothing, so its state never appears here. */
  hostState?: Exclude<ReviewGatewayHostState["state"], "duplicate">;
  /** Absent on the laptop, where everything is available. */
  available?: { sourceWindows: boolean; languageFeatures: boolean };
}

/**
 * A review's snapshot, with its authoring activity and coverage revision.
 * `Snapshot` is the server's document type; clients read it as JSON.
 */
export type ReviewStreamSnapshot<Snapshot extends object = JsonObject> =
  Snapshot & {
    activity: { workingCount: number; expiresAt: number | null };
    coverageRevision: number;
  };

/** One line of `GET /reviews-api/watch`: the new state of one list or review. */
export type ReviewStreamLine<Snapshot extends object = JsonObject> =
  | {
      kind: "list";
      mode: "structural" | "textual";
      reviews: ReviewApiSummary[];
    }
  | { kind: "review"; reviewId: string; value: ReviewStreamSnapshot<Snapshot> }
  | { kind: "review"; reviewId: string; error: string };

export interface ReviewSourceEntry {
  path: string;
  kind: "file" | "directory";
}

type Subscription = {
  mode?: "structural" | "textual";
  reviewId: string | null;
};

type Request = (url: string, init?: RequestInit) => Promise<Response>;

const defaultRequest: Request = (url, init) => fetch(url, init);

/** A non-2xx reply; the status tells a caller whether retrying can help. */
export class ReviewApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ReviewApiError";
  }
}

// One live connection per transport/server, shared by mounted canvases.
const liveConnections = new WeakMap<Request, Map<string, LiveConnection>>();

/** Shared by the canvas and thin agent clients; no filesystem or SQL access. */
export class ReviewApiClient {
  constructor(
    readonly connection: { serverUrl: string; token: string },
    private readonly request: Request = defaultRequest,
  ) {}
  async response(route: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set("x-review-token", this.connection.token);

    if (init?.body) headers.set("content-type", "application/json");

    const response = await this.request(
      `${this.connection.serverUrl}/reviews-api${route}`,
      { ...init, headers },
    );

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ReviewApiError(
        body?.error ?? `Review request failed (${response.status}).`,
        response.status,
      );
    }

    return response;
  }
  async read<T>(route: string, signal?: AbortSignal): Promise<T> {
    return (await this.response(route, { signal })).json();
  }
  async post<T>(
    route: string,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON transport boundary; the selected host route parses its input schema.
    input: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    return (
      await this.response(route, {
        method: "POST",
        body: JSON.stringify(input),
        signal,
      })
    ).json();
  }
  async *watch(
    subscriptions: Subscription[],
    signal: AbortSignal,
  ): AsyncGenerator<ReviewStreamLine> {
    const response = await this.response(
      `/watch?subscriptions=${encodeURIComponent(JSON.stringify(subscriptions))}`,
      { signal },
    );

    const reader = response
      .body!.pipeThrough(new TextDecoderStream())
      .getReader();

    const cancel = () => {
      void reader.cancel().catch(() => {});
    };

    signal.addEventListener("abort", cancel, { once: true });

    if (signal.aborted) cancel();
    let pending = "";

    try {
      while (true) {
        const { value, done } = await reader.read();

        if (done) return;
        pending += value;
        let end: number;

        while ((end = pending.indexOf("\n")) !== -1) {
          // SAFETY: the authenticated host writes ReviewStreamLine values.
          yield JSON.parse(pending.slice(0, end)) as ReviewStreamLine;
          pending = pending.slice(end + 1);
        }
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async follow<T>(
    reviewId: string | null,
    signal: AbortSignal,
    accept: (snapshot: T) => void | Promise<void>,
    disconnected: (cause: unknown) => void,
    mode?: "structural" | "textual",
  ) {
    if (signal.aborted) return;
    let connections = liveConnections.get(this.request);

    if (!connections)
      liveConnections.set(this.request, (connections = new Map()));

    const key = JSON.stringify([
      this.connection.serverUrl,
      this.connection.token,
    ]);

    let live = connections.get(key);

    if (!live) {
      live = new LiveConnection(this, () => connections.delete(key));
      connections.set(key, live);
    }

    const subscription: Subscription = { reviewId };

    if (mode) subscription.mode = mode;

    return live.add(
      subscription,
      signal,
      // SAFETY: this listener requests the review whose snapshot type is T.
      (value) => accept(value as T),
      disconnected,
    );
  }
}

type Result =
  | { value: ReviewStreamSnapshot | ReviewApiSummary[] }
  | { error: string };

type Listener = {
  subscription: Subscription;
  signal: AbortSignal;
  accept(
    value: ReviewStreamSnapshot | ReviewApiSummary[],
  ): void | Promise<void>;
  disconnected(cause: unknown): void;
  /** The newest undelivered result; replaced rather than queued while a render runs. */
  queued?: Result;
  draining?: boolean;
};

// Tabs mounting in separate frames share one replacement stream.
const restartDelayMs = 20;

const retryDelayMs = 1000;

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };

    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** A line is about one list mode or one review; the server sends it once. */
function concerns(line: ReviewStreamLine, subscription: Subscription) {
  return line.kind === "list"
    ? subscription.reviewId === null &&
        (subscription.mode ?? "structural") === line.mode
    : subscription.reviewId === line.reviewId;
}

function report(listener: Listener, cause: unknown) {
  if (listener.signal.aborted) return;

  try {
    listener.disconnected(cause);
  } catch {
    // One tab's handler must not take the shared stream down for the others.
  }
}

class LiveConnection {
  private readonly listeners = new Set<Listener>();
  private abort = new AbortController();
  private active = false;
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly client: ReviewApiClient,
    private readonly empty: () => void,
  ) {}

  add(
    subscription: Subscription,
    signal: AbortSignal,
    accept: Listener["accept"],
    disconnected: Listener["disconnected"],
  ) {
    const listener: Listener = { subscription, signal, accept, disconnected };
    this.listeners.add(listener);
    this.restart();

    return new Promise<void>((resolve) => {
      const stop = () => {
        signal.removeEventListener("abort", stop);
        this.listeners.delete(listener);

        if (this.listeners.size) this.restart();
        else {
          clearTimeout(this.scheduled);
          this.scheduled = undefined;
          this.abort.abort();
          this.active = false;
          this.empty();
        }

        resolve();
      };

      signal.addEventListener("abort", stop, { once: true });

      if (signal.aborted) stop();
    });
  }

  /** The first tab connects at once; later tabs share one replacement stream. */
  private restart() {
    if (this.scheduled) return;

    if (!this.active) {
      this.reconnect();

      return;
    }

    this.scheduled = setTimeout(() => {
      this.scheduled = undefined;
      this.reconnect();
    }, restartDelayMs);
  }

  private reconnect() {
    this.abort.abort();
    this.abort = new AbortController();
    const listeners = [...this.listeners];
    this.active = listeners.length > 0;

    if (this.active) void this.run(listeners, this.abort.signal);
  }

  private async run(listeners: Listener[], signal: AbortSignal) {
    const disconnected = (cause: unknown) =>
      listeners.forEach((listener) => report(listener, cause));

    let delay = 1000;

    while (!signal.aborted) {
      try {
        for await (const line of this.client.watch(
          listeners.map((item) => item.subscription),
          signal,
        )) {
          if (signal.aborted) break;
          delay = 1000;
          const result = line.kind === "list" ? { value: line.reviews } : line;

          for (const listener of listeners)
            if (concerns(line, listener.subscription))
              this.deliver(listener, result);
        }

        if (!signal.aborted) disconnected(new Error("Connection closed."));
      } catch (error) {
        if (!signal.aborted) disconnected(error);

        if (
          error instanceof ReviewApiError &&
          [401, 403, 404].includes(error.status)
        )
          return;
      }

      if (!signal.aborted) await sleep(delay, signal);
      delay = Math.min(delay * 2, 30_000);
    }
  }

  /** Renders never block the stream: a slow tab only delays its own newest state. */
  private deliver(listener: Listener, result: Result) {
    listener.queued = result;

    if (listener.draining) return;
    listener.draining = true;

    void (async () => {
      while (listener.queued && !listener.signal.aborted) {
        const next = listener.queued;
        listener.queued = undefined;

        if ("error" in next) {
          report(listener, new Error(next.error));
          continue;
        }

        try {
          await listener.accept(next.value);
        } catch (error) {
          report(listener, error);
          // Retry the same snapshot after the delay unless a newer one arrived.
          await sleep(retryDelayMs, listener.signal);
          listener.queued ??= next;
        }
      }

      listener.draining = false;
    })();
  }
}
