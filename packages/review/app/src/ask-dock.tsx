import { useEffect, useEffectEvent, useRef } from "react";

import { useAskHistory } from "./ask-history";
import { useOptionalReviewSession } from "./host/review-session";
import { useReviewPanel, useReviewPanelStore } from "./review-panel";

/** Opens Desktop's Threads tab, where there is one. */
export function useShowThreads(): (() => void) | undefined {
  const bridge = useOptionalReviewSession()?.bridge;

  return bridge?.showThreads ? () => bridge.showThreads?.() : undefined;
}

/** Tells Desktop which thread Ask shows; opens threads the Threads tab
 * asks for. */
export function AskDesktopSync(): null {
  const session = useOptionalReviewSession();
  const store = useReviewPanelStore();
  const history = useAskHistory();

  const threadId = useReviewPanel(
    (state) =>
      state.asks.find((ask) => ask.key === state.askDocked)?.threadId ??
      undefined,
  );

  const bridge = session?.bridge;

  useEffect(() => {
    bridge?.reportAsk?.({ ...(threadId && { threadId }) });
  }, [bridge, threadId]);

  // A thread requested before the history listed it.
  const pending = useRef<string | null>(null);
  const entries = history?.entries;

  const open = useEffectEvent((id: string) => {
    const entry = entries?.find((entry) => entry.id === id);

    // Not listed yet: refresh once, and open it when the list has it.
    if (!entry) {
      if (pending.current === id) pending.current = null;
      else {
        pending.current = id;
        history?.refresh();
      }

      return;
    }

    pending.current = null;
    history?.reveal(entry);
    store.getState().openAskView({
      type: "saved",
      threadId: entry.id,
      selection: entry.selection,
      agent: entry.agent,
    });
  });

  useEffect(() => {
    if (pending.current) open(pending.current);
  }, [entries]);

  useEffect(
    () =>
      session?.surface.subscribe((event) => {
        if (event.event === "openAskThread") open(event.threadId);
      }),
    [session],
  );

  return null;
}
