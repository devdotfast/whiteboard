import { useEffect, useState } from "react";

import { useReviewSession } from "./host/review-session";

/**
 * Whether Desktop's sidebar shows this board. If so, the Diff view moves
 * its lenses and file trees there.
 */
export function useSidebarShowsBoard(): boolean {
  const { bridge } = useReviewSession();
  const [shows, setShows] = useState(() => !!bridge.sidebarShowsBoard?.());

  useEffect(() => {
    setShows(!!bridge.sidebarShowsBoard?.());

    const subscription = bridge.onDidChangeSidebarShowsBoard?.(() =>
      setShows(!!bridge.sidebarShowsBoard?.()),
    );

    return () => subscription?.dispose();
  }, [bridge]);

  return shows;
}
