import { useMutation } from "@tanstack/react-query";
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

  const { mutate: mark } = useMutation({
    mutationFn: (id: string) =>
      session!.fetch(`/ask/${id}/viewed`, { method: "POST" }),
  });

  useEffect(() => {
    if (!session || !threadId || !shown) return;

    const viewed = () => {
      if (document.hasFocus()) mark(threadId);
    };

    viewed();
    window.addEventListener("focus", viewed);

    return () => window.removeEventListener("focus", viewed);
  }, [session, threadId, shown, busy, mark]);
}
