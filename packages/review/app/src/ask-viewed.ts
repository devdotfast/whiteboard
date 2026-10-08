import { useEffect } from "react";

import { useOptionalReviewSession } from "./host/review-session";

/**
 * Marks a thread viewed while it shows, in the column or the window, and
 * the app has focus: when it comes on screen, when its agent finishes, and
 * when the window is focused again. A turn finished since it was last
 * viewed marks it unread in the Threads tab.
 */
export function useMarkThreadViewed(
  threadId: string | null,
  shown: boolean,
  busy: boolean | undefined,
): void {
  const session = useOptionalReviewSession();

  useEffect(() => {
    if (!session || !threadId || !shown) return;

    const mark = () => {
      if (!document.hasFocus()) return;
      void session
        .fetch(`/ask/${threadId}/viewed`, { method: "POST" })
        .catch(() => {});
    };

    mark();
    window.addEventListener("focus", mark);

    return () => window.removeEventListener("focus", mark);
  }, [session, threadId, shown, busy]);
}
