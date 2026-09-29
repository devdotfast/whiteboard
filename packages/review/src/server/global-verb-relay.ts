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
  /** The clients the verb was sent to. */
  sentTo: GlobalReviewDesktopVerbWriter[];
  failures: number;
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
}

/**
 * Sends each verb to every attached client and resolves with the first
 * success. Results carry only the verb's id, so the relay cannot tell which
 * client answered: a verb fails once its failures reach the number of
 * clients it was sent to that are still attached.
 */
export class GlobalReviewDesktopVerbRelay implements ReviewDesktopVerbRelay {
  private readonly clients = new Map<
    GlobalReviewDesktopVerbWriter,
    () => void
  >();
  private readonly pending = new Map<string, PendingVerb>();
  private readonly timeoutMs: number;
  private readonly maxClients: number;

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

    return true;
  }

  dispatch(value: JsonValue): Promise<ReviewVerbResponse> {
    const request: ReviewVerbRequest = parseReviewVerbRequest(value);
    const sentTo = [...this.clients.keys()];

    if (sentTo.length === 0) {
      return Promise.resolve({ ok: false, error: NOT_ATTACHED });
    }

    const id = crypto.randomUUID();

    return new Promise<ReviewVerbResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: "Whiteboard Desktop verb timed out." });
      }, this.timeoutMs);

      timer.unref?.();
      this.pending.set(id, { resolve, timer, sentTo, failures: 0 });
      const frame = `data: ${JSON.stringify({ event: "desktop-verb", id, request })}\n\n`;

      for (const client of sentTo) {
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
    const pending = this.pending.get(result.id);

    if (!pending) return false;

    if (result.response.ok) {
      this.settle(result.id, result.response);
    } else {
      pending.failures += 1;
      pending.lastFailure = result.response;
      this.settleIfUnanswerable(result.id, pending);
    }

    return true;
  }

  close(): void {
    for (const id of this.pending.keys()) {
      this.settle(id, { ok: false, error: "Whiteboard Desktop relay closed." });
    }

    for (const client of [...this.clients.keys()]) {
      this.detach(client);
      void Promise.resolve(client.close()).catch(() => undefined);
    }
  }

  private detach(writer: GlobalReviewDesktopVerbWriter): void {
    const listener = this.clients.get(writer);

    if (!listener) return;
    writer.signal.removeEventListener("abort", listener);
    this.clients.delete(writer);

    for (const [id, pending] of this.pending) {
      if (pending.sentTo.includes(writer))
        this.settleIfUnanswerable(id, pending);
    }
  }

  /** Fails the verb once no client it was sent to is left to answer. */
  private settleIfUnanswerable(id: string, pending: PendingVerb): void {
    const remaining = pending.sentTo.filter((client) =>
      this.clients.has(client),
    ).length;

    if (pending.failures < remaining) return;

    this.settle(id, pending.lastFailure ?? { ok: false, error: NOT_ATTACHED });
  }

  private settle(id: string, response: ReviewVerbResponse): void {
    const pending = this.pending.get(id);

    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(response);
  }
}
