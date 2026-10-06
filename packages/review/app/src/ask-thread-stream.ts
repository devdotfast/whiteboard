import {
  type AskThreadState,
  applyAskChange,
  askWatchLineSchema,
} from "@review/ask/thread-state";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import type { ReviewSession } from "./host/review-session";

/** How a panel hears about the thread it follows. */
interface ThreadFollower {
  onState(state: AskThreadState): void;
  /** The thread is gone from the server, or can't be followed. */
  onEnd(): void;
}

/** Gaps in one thread's changes that start the stream over before the
 * thread is given up on rather than followed forever. */
const MAX_RESYNCS = 3;

/**
 * Follows the threads of every open Ask in a review over one stream. A
 * browser opens only a few connections to a host, and each stream holds one
 * for as long as it runs: a stream per Ask would leave nothing for the
 * review's other requests once a few were open.
 *
 * The stream starts over, from a snapshot of each thread, whenever the
 * threads followed change, and when one thread misses a change.
 */
export class AskThreadsWatch {
  private readonly followers = new Map<string, Set<ThreadFollower>>();
  private readonly resyncs = new Map<string, number>();
  private abort: AbortController | null = null;
  private scheduled = false;

  constructor(private readonly session: () => ReviewSession) {}

  /** Follows a thread until the returned function is called. */
  follow(threadId: string, follower: ThreadFollower): () => void {
    const followers = this.followers.get(threadId) ?? new Set();

    followers.add(follower);
    this.followers.set(threadId, followers);
    this.restart();

    return () => {
      if (!followers.delete(follower) || followers.size) return;

      if (this.followers.get(threadId) === followers)
        this.followers.delete(threadId);
      this.resyncs.delete(threadId);
      this.restart();
    };
  }

  /** Starts the stream over for the threads followed now; panels that open
   * or close together start it over once. */
  private restart() {
    if (this.scheduled) return;
    this.scheduled = true;

    queueMicrotask(() => {
      this.scheduled = false;
      this.abort?.abort();
      this.abort = null;

      const threadIds = [...this.followers.keys()].sort();

      if (!threadIds.length) return;
      const abort = new AbortController();

      this.abort = abort;
      void this.read(threadIds, abort.signal);
    });
  }

  private async read(threadIds: string[], signal: AbortSignal) {
    const states = new Map<string, AskThreadState>();
    const seqs = new Map<string, number>();

    try {
      const response = await this.session().fetch(
        `/ask/watch?threads=${threadIds.map(encodeURIComponent).join(",")}`,
        { signal },
      );

      if (!response.ok || !response.body) throw new Error("Unavailable");

      const lines = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();

      let buffer = "";

      try {
        for (;;) {
          const { done, value } = await lines.read();

          if (done) break;
          buffer += value;
          const complete = buffer.split("\n");
          buffer = complete.pop() ?? "";
          // One render per read for each thread, however many changes it
          // carried.
          const changed = new Set<string>();

          for (const line of complete) {
            if (!line.trim()) continue;
            const parsed = askWatchLineSchema.parse(JSON.parse(line));
            const { threadId } = parsed;

            if ("ended" in parsed) {
              changed.delete(threadId);
              this.end(threadId);
              continue;
            }

            const { update } = parsed;
            const state = states.get(threadId);

            if ("snapshot" in update) states.set(threadId, update.snapshot);
            else if (state && update.seq === (seqs.get(threadId) ?? 0) + 1)
              states.set(threadId, applyAskChange(state, update.change));
            else {
              // A missed change: a new stream resyncs the thread from a
              // snapshot, unless that keeps happening.
              this.resynced(threadId);

              return;
            }

            seqs.set(threadId, update.seq);
            changed.add(threadId);
          }

          for (const threadId of changed) {
            const state = states.get(threadId);

            if (!state) continue;

            for (const follower of this.followers.get(threadId) ?? [])
              follower.onState(state);
          }
        }
      } finally {
        void lines.cancel().catch(() => {});
      }
    } catch {
      /* An unreachable stream ends its threads below. */
    }

    // A stream that ends on its own has ended every thread it followed.
    if (signal.aborted) return;

    for (const threadId of threadIds) this.end(threadId);
  }

  private resynced(threadId: string) {
    const resyncs = (this.resyncs.get(threadId) ?? 0) + 1;

    if (resyncs > MAX_RESYNCS) this.end(threadId);
    else this.resyncs.set(threadId, resyncs);

    this.restart();
  }

  private end(threadId: string) {
    const followers = [...(this.followers.get(threadId) ?? [])];

    // Emptied, so letting go of an ended thread starts nothing over.
    this.followers.get(threadId)?.clear();
    this.followers.delete(threadId);
    this.resyncs.delete(threadId);

    for (const follower of followers) follower.onEnd();
  }
}

/** The one watch of a review's open Asks. A panel outside it follows its
 * thread on a stream of its own. */
export const AskThreadsWatchContext = createContext<AskThreadsWatch | null>(
  null,
);

/** The watch the Asks of a review share, for `AskThreadsWatchContext`. */
export function useAskThreadsWatch(session: ReviewSession) {
  const current = useLatest(session);
  const [watch] = useState(() => new AskThreadsWatch(() => current.current));

  return watch;
}

/** Follows one thread until the panel lets go of it. */
export function useThread(session: ReviewSession, threadId: string | null) {
  const [thread, setThread] = useState<AskThreadState | null>(null);
  const [lost, setLost] = useState(false);
  // Each new version of the review is a new session object; the agent
  // belongs to the panel, so only the panel closing ends it.
  const current = useLatest(session);
  const own = useAskThreadsWatch(session);
  const watch = useContext(AskThreadsWatchContext) ?? own;

  useEffect(() => {
    if (!threadId) return;

    setLost(false);

    // Set once the thread is gone from the server, which then has nothing
    // to close; a late close could end the same thread reopened.
    let gone = false;

    const stop = watch.follow(threadId, {
      onState: setThread,
      onEnd() {
        gone = true;
        setLost(true);
      },
    });

    return () => {
      stop();

      if (gone) return;
      // The agent process belongs to this panel; closing the panel ends it.
      // The conversation stays saved, to reopen from the history.
      void current.current
        .fetch(`/ask/${threadId}/close`, { method: "POST", keepalive: true })
        .catch(() => {});
    };
  }, [current, threadId, watch]);

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
