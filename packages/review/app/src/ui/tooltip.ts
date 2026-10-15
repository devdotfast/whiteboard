import { CanvasUiContext } from "@canvas/host/canvas-ui";
import { useOptionalReviewSession } from "@canvas/host/review-session";
import type {
  ReviewDisposable,
  ReviewTooltipOptions,
} from "@dev.fast/review-protocol";
import { createContext, useCallback, useContext } from "react";

type SetupTooltip = (
  target: HTMLElement,
  text: string,
  options?: ReviewTooltipOptions,
) => ReviewDisposable;

/** The host's tooltips where there is no board session, as in Desktop's
 * sidebar sections. */
export const TooltipHostContext = createContext<SetupTooltip | undefined>(
  undefined,
);

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
  const host = useContext(TooltipHostContext);

  const setupTooltip = session
    ? (session.bridge.setupTooltip ?? host)
    : (ui?.setupTooltip ?? host);

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
