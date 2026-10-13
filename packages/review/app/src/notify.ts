import type { ReviewNotification } from "@dev.fast/review-protocol";
import { useCallback, useContext } from "react";

import { CanvasUiContext } from "./host/canvas-ui";
import { useOptionalReviewSession } from "./host/review-session";

/** Shows a host notification and returns a function that closes it. */
export function useNotify() {
  const session = useOptionalReviewSession();
  const ui = useContext(CanvasUiContext);
  const notify = session ? session.bridge.notify : ui?.notify;

  return useCallback(
    (notification: ReviewNotification) => {
      const handle = notify?.(notification);

      return () => handle?.dispose();
    },
    [notify],
  );
}
