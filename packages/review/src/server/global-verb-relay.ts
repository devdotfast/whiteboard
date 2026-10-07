import crypto from "node:crypto";

import {
  type JsonValue,
  type ReviewVerbRequest,
  type ReviewVerbResponse,
  parseReviewDesktopVerbResult,
  parseReviewVerbRequest,
} from "@dev.fast/review-protocol";

const DEFAULT_VERB_TIMEOUT_MS = 45_000;

const DEFAULT_MAX_CLIENTS = 16;

const NOT_ATTACHED = "No Whiteboard Desktop is attached.";

interface PendingVerb {
  resolve(response: ReviewVerbResponse): void;
  timer: ReturnType<typeof setTimeout>;
  /** The clients yet to answer, by the frame id each was sent. */
  waiting: Map<string, GlobalReviewDesktopVerbWriter>;
  lastFailure?: ReviewVerbResponse;
}

export interface GlobalReviewDesktopVerbWriter {
  readonly signal: AbortSignal;
  write(frame: string): void | Promise<void>;
  close(): void | Promise<void>;
}

/** The server's view of the desktop relay, so tests can supply their own. */
export interface ReviewDesktopVerbRelay {
  readonly attached: boolean;
  attach(writer: GlobalReviewDesktopVerbWriter): boolean;
  dispatch(value: JsonValue): Promise<ReviewVerbResponse>;
  acceptResult(value: JsonValue): boolean;
  close(): void;
  onAttachedChange?(listener: (attached: boolean) => void): () => void;
}

/**
 * Sends each verb to every attached client, each with its own frame id, and
 * resolves with the first success, or with the last failure once no client
 * is left to answer.
 */
export class GlobalReviewDesktopVerbRelay implements ReviewDesktopVerbRelay {
  private readonly clients = new Map<
    GlobalReviewDesktopVerbWriter,
    () => void
  >();
  /** Each verb in flight, under every frame id it was sent with. */
  private readonly pending = new Map<string, PendingVerb>();
  private readonly timeoutMs: number;
  private readonly maxClients: number;
  private readonly attachedListeners = new Set<(attached: boolean) => void>();

  constructor(options: { timeoutMs?: number; maxClients?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_VERB_TIMEOUT_MS;
    this.maxClients = options.maxClients ?? DEFAULT_MAX_CLIENTS;
  }

  get attached(): boolean {
    return this.clients.size > 0;
  }

  attach(writer: GlobalReviewDesktopVerbWriter): boolean {
    if (
      this.clients.size >= this.maxClients ||
      this.clients.has(writer) ||
      writer.signal.aborted
    )
      return false;

    const detach = () => this.detach(writer);
    this.clients.set(writer, detach);
    writer.signal.addEventListener("abort", detach, { once: true });

    if (this.clients.size === 1) this.notifyAttached(true);

    return true;
  }

  onAttachedChange(listener: (attached: boolean) => void): () => void {
    this.attachedListeners.add(listener);

    return () => this.attachedListeners.delete(listener);
  }

  private notifyAttached(attached: boolean): void {
    for (const listener of [...this.attachedListeners]) listener(attached);
  }

  dispatch(value: JsonValue): Promise<ReviewVerbResponse> {
    const request: ReviewVerbRequest = parseReviewVerbRequest(value);

    if (this.clients.size === 0) {
      return Promise.resolve({ ok: false, error: NOT_ATTACHED });
    }

    return new Promise<ReviewVerbResponse>((resolve) => {
      const verb: PendingVerb = {
        resolve,
        waiting: new Map(
          [...this.clients.keys()].map((client) => [
            crypto.randomUUID(),
            client,
          ]),
        ),
        timer: setTimeout(
          () =>
            this.settle(
              verb,
              verb.lastFailure ?? {
                ok: false,
                error: "Whiteboard Desktop verb timed out.",
              },
            ),
          this.timeoutMs,
        ),
      };

      verb.timer.unref?.();

      // Every id is registered before the first write, which may detach its
      // client at once.
      for (const id of verb.waiting.keys()) this.pending.set(id, verb);

      for (const [id, client] of [...verb.waiting]) {
        const frame = `data: ${JSON.stringify({ event: "desktop-verb", id, request })}\n\n`;

        try {
          void Promise.resolve(client.write(frame)).catch(() => {
            this.detach(client);
          });
        } catch {
          this.detach(client);
        }
      }
    });
  }

  acceptResult(value: JsonValue): boolean {
    const result = parseReviewDesktopVerbResult(value);
    const verb = this.pending.get(result.id);

    if (!verb) return false;

    if (result.response.ok) {
      this.settle(verb, result.response);
    } else {
      verb.lastFailure = result.response;
      this.stopWaiting(verb, result.id);
    }

    return true;
  }

  close(): void {
    for (const verb of new Set(this.pending.values())) {
      this.settle(verb, {
        ok: false,
        error: "Whiteboard Desktop relay closed.",
      });
    }

    for (const client of [...this.clients.keys()]) {
      this.detach(client);

      try {
        void Promise.resolve(client.close()).catch(() => undefined);
      } catch {
        // Already closed.
      }
    }
  }

  private detach(writer: GlobalReviewDesktopVerbWriter): void {
    const listener = this.clients.get(writer);

    if (!listener) return;
    writer.signal.removeEventListener("abort", listener);
    this.clients.delete(writer);

    for (const [id, verb] of [...this.pending]) {
      if (verb.waiting.get(id) === writer) this.stopWaiting(verb, id);
    }

    if (this.clients.size === 0) this.notifyAttached(false);
  }

  /** Drops one client's id; with nobody left to answer, the verb fails. */
  private stopWaiting(verb: PendingVerb, id: string): void {
    verb.waiting.delete(id);
    this.pending.delete(id);

    if (verb.waiting.size === 0)
      this.settle(verb, verb.lastFailure ?? { ok: false, error: NOT_ATTACHED });
  }

  private settle(verb: PendingVerb, response: ReviewVerbResponse): void {
    for (const id of verb.waiting.keys()) this.pending.delete(id);
    verb.waiting.clear();
    clearTimeout(verb.timer);
    verb.resolve(response);
  }
}
