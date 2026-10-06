import type { AskUpdate, AskWatchLine } from "@review/ask/thread-state.js";

/** What a watch stream needs from a thread. */
export interface AskWatchable {
  snapshot(): AskUpdate;
  subscribe(listener: (update: AskUpdate) => void): () => void;
  onClose(closed: () => void): () => void;
}

/** Changes a slow reader may fall behind by on one thread before that
 * thread's backlog is replaced with one snapshot, which bounds the memory a
 * stalled panel holds. */
export const ASK_WATCH_BACKLOG = 256;

/**
 * NDJSON of several threads over one connection: for each, a snapshot, then
 * each change in `seq` order, then `ended` once it closes. A thread that
 * isn't running is `ended` at once. Answer tokens arrive as appends, so a
 * reply costs about what the agent sent.
 *
 * One stream for every open Ask of a review: a browser opens only a few
 * connections to a host, and each stream holds one for as long as it runs.
 */
export function watchAskThreads(
  threads: ReadonlyMap<string, AskWatchable | undefined>,
  backlog = ASK_WATCH_BACKLOG,
): Response {
  const encoder = new TextEncoder();
  const queues = new Map<string, AskWatchLine[]>();
  /** Threads still running, which may send more. */
  const live = new Set<string>();
  const stops: (() => void)[] = [];
  /** The stream ended, so nothing more may be enqueued. */
  let finished = false;

  // A line from each thread in turn, so one busy thread can't hold back
  // the others.
  const flush = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    let sent = true;

    while (sent && (controller.desiredSize ?? 0) > 0) {
      sent = false;

      for (const queue of queues.values()) {
        const line = queue.shift();

        if (!line) continue;
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        sent = true;
      }
    }

    // Every thread has closed and said so; the stream ends.
    if (
      !live.size &&
      [...queues.values()].every((queue) => !queue.length) &&
      !finished
    ) {
      finished = true;
      controller.close();
    }
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [threadId, thread] of threads) {
        const queue: AskWatchLine[] = [];

        queues.set(threadId, queue);

        if (!thread) {
          queue.push({ threadId, ended: true });
          continue;
        }

        live.add(threadId);
        queue.push({ threadId, update: thread.snapshot() });

        const unsubscribe = thread.subscribe((update) => {
          queue.push({ threadId, update });

          // The snapshot already holds every change it would replay.
          if (queue.length > backlog)
            queue.splice(0, queue.length, {
              threadId,
              update: thread.snapshot(),
            });
          flush(controller);
        });

        const unclose = thread.onClose(() => {
          live.delete(threadId);
          unsubscribe();
          queue.push({ threadId, ended: true });
          flush(controller);
        });

        stops.push(unsubscribe, unclose);
      }

      flush(controller);
    },
    pull: flush,
    cancel() {
      for (const stop of stops) stop();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}
