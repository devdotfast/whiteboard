import type { ReviewTooltipOptions } from "@dev.fast/review-protocol";
import { useCallback, useContext } from "react";

import { CanvasUiContext } from "./host/canvas-ui";
import { useOptionalReviewSession } from "./host/review-session";

/**
 * Attach the host's tooltip to an element, or a native `title` without a
 * Desktop host. `instant` asks for the Whiteboard tooltip with no delay, for
 * small targets; `quick` for half the delay; `detail` is its fainter second
 * line.
 */
export function useTooltip<T extends HTMLElement = HTMLButtonElement>(
  text: string,
  { instant, quick, detail }: ReviewTooltipOptions = {},
) {
  const session = useOptionalReviewSession();
  const ui = useContext(CanvasUiContext);
  const setupTooltip = session ? session.bridge.setupTooltip : ui?.setupTooltip;

  return useCallback(
    (target: T | null) => {
      if (!target) return;

      if (setupTooltip) {
        const tooltip = setupTooltip(target, text, { instant, quick, detail });

        return () => tooltip.dispose();
      }

      target.title = detail ? `${text}\n${detail}` : text;

      return () => target.removeAttribute("title");
    },
    [setupTooltip, text, instant, quick, detail],
  );
}
