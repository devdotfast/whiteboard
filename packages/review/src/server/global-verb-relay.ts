import crypto from "node:crypto";

import {
  type JsonValue,
  type ReviewVerbRequest,
  type ReviewVerbResponse,
  parseReviewDesktopVerbResult,
  parseReviewVerbRequest,
} from "@dev.fast/review-protocol";

const DEFAULT_VERB_TIMEOUT_MS = 45_000;

const NOT_ATTACHED = "No Whiteboard Desktop is attached.";

interface PendingVerb {
  resolve(response: ReviewVerbResponse): void;
  timer: ReturnType<typeof setTimeout>;
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

export class GlobalReviewDesktopVerbRelay implements ReviewDesktopVerbRelay {
  private controlWriter: GlobalReviewDesktopVerbWriter | null = null;
  private controlAbortListener: (() => void) | null = null;
  private readonly pending = new Map<string, PendingVerb>();

  constructor(private readonly timeoutMs = DEFAULT_VERB_TIMEOUT_MS) {}

  get attached(): boolean {
    return this.controlWriter !== null;
  }

  attach(writer: GlobalReviewDesktopVerbWriter): boolean {
    if (this.controlWriter || writer.signal.aborted) return false;
    this.controlWriter = writer;
    const detach = () => this.detach(writer, NOT_ATTACHED);
    this.controlAbortListener = detach;
    writer.signal.addEventListener("abort", detach, { once: true });

    return true;
  }

  dispatch(value: JsonValue): Promise<ReviewVerbResponse> {
    const request: ReviewVerbRequest = parseReviewVerbRequest(value);
    const control = this.controlWriter;

    if (!control) {
      return Promise.resolve({ ok: false, error: NOT_ATTACHED });
    }

    const id = crypto.randomUUID();

    return new Promise<ReviewVerbResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: "Whiteboard Desktop verb timed out." });
      }, this.timeoutMs);

      timer.unref?.();
      this.pending.set(id, { resolve, timer });
      const frame = `data: ${JSON.stringify({ event: "desktop-verb", id, request })}\n\n`;

      try {
        void Promise.resolve(control.write(frame)).catch(() => {
          this.detach(control, NOT_ATTACHED);
        });
      } catch {
        this.detach(control, NOT_ATTACHED);
      }
    });
  }

  acceptResult(value: JsonValue): boolean {
    const result = parseReviewDesktopVerbResult(value);
    const pending = this.pending.get(result.id);

    if (!pending) return false;
    this.pending.delete(result.id);
    clearTimeout(pending.timer);
    pending.resolve(result.response);

    return true;
  }

  close(): void {
    const control = this.controlWriter;

    if (!control) {
      this.rejectPending("Whiteboard Desktop relay closed.");

      return;
    }

    this.detach(control, "Whiteboard Desktop relay closed.");
    void Promise.resolve(control.close()).catch(() => undefined);
  }

  private detach(writer: GlobalReviewDesktopVerbWriter, error: string): void {
    if (this.controlWriter !== writer) return;

    if (this.controlAbortListener) {
      writer.signal.removeEventListener("abort", this.controlAbortListener);
    }

    this.controlAbortListener = null;
    this.controlWriter = null;
    this.rejectPending(error);
  }

  private rejectPending(error: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error });
      this.pending.delete(id);
    }
  }
}
