import { useCallback, useEffect, useRef } from "react";

import { useReviewPanel, useReviewPanelStore } from "./review-panel";
import type { GuidedTour } from "./review-panel-model";
import { useWhiteboardSettings } from "./whiteboard-settings";

export function useDiagramSelection(tour: GuidedTour, fullscreen: boolean) {
  const panelStore = useReviewPanelStore();
  const figureRef = useRef<HTMLElement | null>(null);

  const expandOnClick =
    useWhiteboardSettings().diagramFullscreenOnClick === true;

  const anchor = useReviewPanel((state) => {
    const id = state.active?.anchor?.id;

    return !state.columnHidden &&
      tour.stops.some((stop) => stop.anchor.id === id)
      ? (id ?? null)
      : null;
  });

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
      if (fullscreen || expandOnClick) return false;
      const stop = tour.stops.find((item) => item.anchor.id === id);

      if (!stop) return false;
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
    [expandOnClick, fullscreen, panelStore, tour],
  );

  return { anchor, selectInline, figureRef };
}
