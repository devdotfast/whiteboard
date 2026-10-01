import {
  type AskThreadState,
  applyAskChange,
  askUpdateSchema,
} from "@review/ask/thread-state";
import { useEffect, useRef, useState } from "react";

import type { ReviewSession } from "./host/review-session";

/**
 * Reads one watch stream: a snapshot, then changes in `seq` order. Returns
 * "ended" when the server closes it, or "gap" when a change is missing and a
 * new stream has to start over from a snapshot.
 */
async function followThread(
  session: ReviewSession,
  threadId: string,
  signal: AbortSignal,
  onState: (state: AskThreadState) => void,
): Promise<"ended" | "gap"> {
  const response = await session.fetch(`/ask/${threadId}/watch`, { signal });

  if (!response.ok || !response.body) throw new Error("Unavailable");

  const lines = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let state: AskThreadState | null = null;
  let seq = 0;

  try {
    for (;;) {
      const { done, value } = await lines.read();

      if (done) return "ended";
      buffer += value;
      const complete = buffer.split("\n");
      buffer = complete.pop() ?? "";
      const before: AskThreadState | null = state;

      for (const line of complete) {
        if (!line.trim()) continue;
        const update = askUpdateSchema.parse(JSON.parse(line));

        if ("snapshot" in update) state = update.snapshot;
        else if (state && update.seq === seq + 1)
          state = applyAskChange(state, update.change);
        else return "gap";
        seq = update.seq;
      }

      // One render per read, however many changes it carried.
      if (state && state !== before) onState(state);
    }
  } finally {
    void lines.cancel().catch(() => {});
  }
}

/** Follows one thread until the panel lets go of it. */
export function useThread(session: ReviewSession, threadId: string | null) {
  const [thread, setThread] = useState<AskThreadState | null>(null);
  const [lost, setLost] = useState(false);
  // Each new version of the review is a new session object; the agent
  // belongs to the panel, so only the panel closing ends it.
  const current = useLatest(session);

  useEffect(() => {
    if (!threadId) return;
    const session = current.current;
    const abort = new AbortController();

    setLost(false);

    // Set once the thread is gone from the server, which then has nothing
    // to close; a late close could end the same thread reopened.
    let gone = false;

    void (async () => {
      try {
        // A gap means this panel missed a change; a new stream resyncs it.
        // Give up if that keeps happening rather than reconnect forever.
        for (let resyncs = 0; resyncs <= 3; resyncs++) {
          const outcome = await followThread(
            session,
            threadId,
            abort.signal,
            setThread,
          );

          if (outcome === "ended") break;
        }
      } catch {
        /* An unreachable thread reads as a lost conversation below. */
      }

      if (abort.signal.aborted) return;
      gone = true;
      setLost(true);
    })();

    return () => {
      abort.abort();

      if (gone) return;
      // The agent process belongs to this panel; closing the panel ends it.
      // The conversation stays saved, to reopen from the history.
      void current.current
        .fetch(`/ask/${threadId}/close`, { method: "POST", keepalive: true })
        .catch(() => {});
    };
  }, [current, threadId]);

  // A thread the panel lost is not running any more, whatever it last said.
  return {
    thread: lost && thread ? { ...thread, status: "failed" as const } : thread,
    lost,
  };
}

/** The latest value, for effects that must not restart when it changes. */
export function useLatest<Value>(value: Value) {
  const ref = useRef(value);

  ref.current = value;

  return ref;
}
