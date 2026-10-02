import type { AskUpdate } from "@review/ask/thread-state.js";

/** What a watch stream needs from a thread. */
export interface AskWatchable {
  snapshot(): AskUpdate;
  subscribe(listener: (update: AskUpdate) => void): () => void;
  onClose(closed: () => void): () => void;
}

/** Changes a slow reader may fall behind by before its backlog is replaced
 * with one snapshot, which bounds the memory a stalled panel holds. */
export const ASK_WATCH_BACKLOG = 256;

/**
 * NDJSON of a thread: a snapshot, then each change in `seq` order. Answer
 * tokens arrive as appends, so a reply costs about what the agent sent.
 */
export function watchAskThread(
  thread: AskWatchable,
  backlog = ASK_WATCH_BACKLOG,
): Response {
  const encoder = new TextEncoder();
  let pending: AskUpdate[] = [thread.snapshot()];
  let stop = () => {};

  /** The thread closed; the stream ends once `pending` is sent. */
  let ended = false;
  /** The stream ended, so nothing more may be enqueued. */
  let finished = false;

  const flush = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    while (pending.length && (controller.desiredSize ?? 0) > 0)
      controller.enqueue(
        encoder.encode(`${JSON.stringify(pending.shift())}\n`),
      );

    // A closed thread sends nothing more; its watchers hear it end.
    if (ended && !pending.length && !finished) {
      finished = true;
      controller.close();
    }
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const unsubscribe = thread.subscribe((update) => {
        pending.push(update);

        // The snapshot already holds every change it would replay.
        if (pending.length > backlog) pending = [thread.snapshot()];
        flush(controller);
      });

      const unclose = thread.onClose(() => {
        ended = true;
        unsubscribe();
        flush(controller);
      });

      stop = () => {
        unsubscribe();
        unclose();
      };

      flush(controller);
    },
    pull: flush,
    cancel() {
      stop();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}
