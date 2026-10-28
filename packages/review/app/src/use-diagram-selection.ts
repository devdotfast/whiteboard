import { useCallback, useEffect, useRef } from "react";

import { useReviewPanel, useReviewPanelStore } from "./review-panel";
import type { GuidedTour } from "./review-panel-model";
import { useWhiteboardSettings } from "./whiteboard-settings";

export function useDiagramSelection(
  tour: GuidedTour | null,
  fullscreen: boolean,
) {
  const panelStore = useReviewPanelStore();
  const figureRef = useRef<HTMLElement | null>(null);
  const { diagramFullscreenOnClick } = useWhiteboardSettings();

  const anchor = useReviewPanel((state) =>
    !state.columnHidden && tour && state.active?.tour?.definition.id === tour.id
      ? (state.active.anchor?.id ?? null)
      : null,
  );

  useEffect(() => {
    const figure = figureRef.current;

    if (!anchor || fullscreen || !figure) return;
    let scroller = figure.parentElement;

    while (
      scroller &&
      !/auto|scroll/.test(getComputedStyle(scroller).overflowY)
    )
      scroller = scroller.parentElement;

    if (!scroller) return;
    const viewport = scroller.getBoundingClientRect();
    const rect = figure.getBoundingClientRect();

    if (rect.bottom > viewport.top && rect.top < viewport.bottom) return;
    figure.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [anchor, fullscreen]);

  const selectInline = useCallback(
    (id: string) => {
      if (fullscreen || diagramFullscreenOnClick) return false;
      const stop = tour?.stops.find((item) => item.anchor.id === id);

      if (!tour || !stop) return false;
      panelStore.getState().openPeek({
        kind: "peek",
        anchor: stop.anchor,
        content: stop.content,
        tour: {
          definition: tour,
          revealRequest:
            (panelStore.getState().active?.tour?.revealRequest ?? 0) + 1,
        },
      });

      return true;
    },
    [diagramFullscreenOnClick, fullscreen, panelStore, tour],
  );

  return { anchor, selectInline, figureRef };
}
