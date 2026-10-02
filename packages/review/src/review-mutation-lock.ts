import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

import { withFileLock } from "@dev.fast/trace-core";

const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>();

export class ReviewBusyError extends Error {
  override readonly name = "ReviewBusyError";
  readonly code = "REVIEW_BUSY";
  readonly retryable = true;
  readonly reviewUuid: string;

  constructor(reviewDir: string) {
    const reviewUuid = path.basename(reviewDir);
    super(
      `Review ${reviewUuid} is busy. Retry after its current operation completes.`,
    );
    this.reviewUuid = reviewUuid;
  }
}

/** Shared by the desktop and migration CLI; stored outside the sealed tree. */
export async function withReviewMutationLock<T>(
  reviewDir: string,
  operation: () => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const canonicalDir = path.resolve(reviewDir);
  const inherited = heldLocks.getStore();

  if (inherited?.has(canonicalDir)) return operation();

  const outcome = await withFileLock(
    `${reviewDir}.mutation-lock`,
    {
      retryMs: 20,
      timeoutMs: options.timeoutMs ?? 10_000,
      staleMs: 120_000,
      heartbeatMs: 5_000,
      unownedGraceMs: 1_000,
    },
    () =>
      heldLocks.run(new Set([...(inherited ?? []), canonicalDir]), operation),
  );

  if (!outcome.acquired) throw new ReviewBusyError(reviewDir);

  return outcome.result;
}
