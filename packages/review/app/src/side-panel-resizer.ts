import type {
  HTMLAttributes,
  KeyboardEvent,
  PointerEvent,
  RefObject,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useReviewUiState } from "./review-ui-state";

type RightPanelResizeOptions = {
  side?: "left" | "right";
  /** Names the panel whose width is remembered across remounts. */
  stateKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  minMainWidth: number;
  separatorWidth?: number;
  /** Dragging past `minWidth` folds the panel to this width. */
  collapsedWidth?: number;
  label: string;
  containerRef?: RefObject<HTMLElement | null>;
};

type SeparatorProps = HTMLAttributes<HTMLDivElement> & {
  role: "separator";
  "aria-label": string;
  "aria-orientation": "vertical";
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  tabIndex: 0;
};

type BottomSheetResizeOptions = {
  /** Names the sheet whose height fraction is remembered across remounts. */
  stateKey: string;
  defaultFraction?: number;
  minFraction?: number;
  maxFraction?: number;
  label: string;
  containerRef?: RefObject<HTMLElement | null>;
};

type SheetSeparatorProps = HTMLAttributes<HTMLDivElement> & {
  role: "separator";
  "aria-label": string;
  "aria-orientation": "horizontal";
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  tabIndex: 0;
};

/**
 * Drag state for the narrow-layout bottom sheet: the panel's height as a
 * fraction of its container, remembered across remounts. The grabber only
 * renders in narrow layouts, so the hook is inert on wide screens.
 */
export function useBottomSheetResize({
  stateKey,
  defaultFraction = 0.5,
  minFraction = 0.3,
  maxFraction = 0.85,
  label,
  containerRef,
}: BottomSheetResizeOptions) {
  const [requestedFraction, setRequestedFraction] = useReviewUiState(
    stateKey,
    defaultFraction,
  );

  const [isResizing, setIsResizing] = useState(false);

  const clampFraction = useCallback(
    (fraction: number) =>
      Math.min(Math.max(fraction, minFraction), maxFraction),
    [maxFraction, minFraction],
  );

  const fraction = clampFraction(requestedFraction);

  const containerMetrics = useCallback(() => {
    const rect = containerRef?.current?.getBoundingClientRect();

    const viewportHeight =
      typeof window === "undefined"
        ? Number.POSITIVE_INFINITY
        : window.innerHeight;

    return {
      bottom: rect?.bottom ?? viewportHeight,
      height: rect?.height ?? viewportHeight,
    };
  }, [containerRef]);

  const resizeFromClientY = useCallback(
    (clientY: number) => {
      const { bottom, height } = containerMetrics();

      if (!Number.isFinite(height) || height <= 0) return;
      setRequestedFraction((bottom - clientY) / height);
    },
    [containerMetrics, setRequestedFraction],
  );

  const startResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsResizing(true);
      resizeFromClientY(event.clientY);
    },
    [resizeFromClientY],
  );

  const resize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isResizing) return;
      resizeFromClientY(event.clientY);
    },
    [isResizing, resizeFromClientY],
  );

  const stopResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setIsResizing(false);
  }, []);

  const resizeWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setRequestedFraction((current) => clampFraction(current) + 0.05);
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setRequestedFraction((current) => clampFraction(current) - 0.05);
      }
    },
    [clampFraction, setRequestedFraction],
  );

  const separatorProps = useMemo<SheetSeparatorProps>(
    () => ({
      role: "separator",
      "aria-label": label,
      "aria-orientation": "horizontal",
      "aria-valuemin": Math.round(minFraction * 100),
      "aria-valuemax": Math.round(maxFraction * 100),
      "aria-valuenow": Math.round(fraction * 100),
      tabIndex: 0,
      onPointerDown: startResize,
      onPointerMove: resize,
      onPointerUp: stopResize,
      onPointerCancel: stopResize,
      onLostPointerCapture: () => setIsResizing(false),
      onKeyDown: resizeWithKeyboard,
    }),
    [
      fraction,
      label,
      maxFraction,
      minFraction,
      resize,
      resizeWithKeyboard,
      startResize,
      stopResize,
    ],
  );

  return {
    fraction,
    isResizing,
    separatorProps,
  };
}

export function useRightPanelResize({
  side = "right",
  stateKey,
  defaultWidth,
  minWidth,
  maxWidth,
  minMainWidth,
  separatorWidth = 0,
  collapsedWidth,
  label,
  containerRef,
}: RightPanelResizeOptions) {
  // Persist the width the reader asked for and clamp only for rendering. A
  // panel can mount before its container has been laid out — the map frame does
  // exactly that — and storing the clamped value there would shrink the
  // remembered width to the minimum without anyone dragging anything.
  const [requestedWidth, setRequestedWidth] = useReviewUiState(
    stateKey,
    defaultWidth,
  );

  const [storedCollapsed, setCollapsed] = useReviewUiState(
    `${stateKey}-collapsed`,
    false,
  );

  const collapsible = collapsedWidth !== undefined;
  const foldedWidth = storedCollapsed ? collapsedWidth : undefined;
  const collapsed = foldedWidth !== undefined;
  // Unfolding restores the width from before the drag.
  const dragStartWidth = useRef(requestedWidth);

  const [isResizing, setIsResizing] = useState(false);
  const [, setLayoutRevision] = useState(0);

  const containerMetrics = useCallback(() => {
    const rect = containerRef?.current?.getBoundingClientRect();

    // The width is clamped during render, which also happens during SSR where
    // there is no viewport to measure. An unbounded viewport there leaves the
    // requested width alone until the browser reports real geometry.
    const viewportWidth =
      typeof window === "undefined"
        ? Number.POSITIVE_INFINITY
        : window.innerWidth;

    return {
      left: rect?.left ?? 0,
      right: rect?.right ?? viewportWidth,
      width: rect?.width ?? viewportWidth,
    };
  }, [containerRef]);

  const constrainWidth = useCallback(
    (nextWidth: number) => {
      const { width: containerWidth } = containerMetrics();

      const availableMax = Math.min(
        maxWidth,
        containerWidth - minMainWidth - separatorWidth,
      );

      return Math.min(
        Math.max(nextWidth, minWidth),
        Math.max(minWidth, availableMax),
      );
    },
    [containerMetrics, maxWidth, minMainWidth, minWidth, separatorWidth],
  );

  const width = constrainWidth(requestedWidth);

  const setWidth = useCallback(
    (nextWidth: number | ((width: number) => number)) => {
      setRequestedWidth((currentWidth) =>
        nextWidth instanceof Function
          ? nextWidth(constrainWidth(currentWidth))
          : nextWidth,
      );
    },
    [constrainWidth, setRequestedWidth],
  );

  // The Review canvas can shrink without the browser window changing when a
  // native Code OSS editor opens beside it. Observe the actual owning
  // container as well as the window so the document keeps its minimum width
  // in both layouts. The rendered width is derived, so a re-render is all this
  // needs; the requested width stays untouched and the panel returns to it once
  // there is room again.
  useEffect(() => {
    const reclampWidth = () => setLayoutRevision((revision) => revision + 1);
    window.addEventListener("resize", reclampWidth);
    const container = containerRef?.current;

    const resizeObserver =
      container && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(reclampWidth)
        : null;

    if (container && resizeObserver) resizeObserver.observe(container);

    return () => {
      window.removeEventListener("resize", reclampWidth);
      resizeObserver?.disconnect();
    };
  }, [containerRef]);

  const resizeFromClientX = useCallback(
    (clientX: number) => {
      const { left, right } = containerMetrics();
      const nextWidth = side === "left" ? clientX - left : right - clientX;

      if (collapsible && nextWidth < minWidth) {
        setCollapsed(true);
        setRequestedWidth(dragStartWidth.current);

        return;
      }

      if (collapsible) setCollapsed(false);
      setWidth(nextWidth);
    },
    [
      collapsible,
      containerMetrics,
      minWidth,
      setCollapsed,
      setRequestedWidth,
      setWidth,
      side,
    ],
  );

  // Resize on move, not press, so a press at the minimum can't fold.
  const startResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStartWidth.current = requestedWidth;
      setIsResizing(true);
    },
    [requestedWidth],
  );

  const resize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isResizing) return;
      resizeFromClientX(event.clientX);
    },
    [isResizing, resizeFromClientX],
  );

  const stopResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setIsResizing(false);
  }, []);

  const resizeWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();

      const delta =
        (event.key === "ArrowLeft") === (side === "left") ? -32 : 32;

      if (collapsed) {
        if (delta > 0) setCollapsed(false);
      } else if (collapsible && delta < 0 && width <= minWidth) {
        setCollapsed(true);
      } else {
        setWidth((currentWidth) => currentWidth + delta);
      }
    },
    [collapsed, collapsible, minWidth, setCollapsed, setWidth, side, width],
  );

  const expand = useCallback(() => setCollapsed(false), [setCollapsed]);
  const renderedWidth = foldedWidth ?? width;

  const separatorProps = useMemo<SeparatorProps>(
    () => ({
      role: "separator",
      "aria-label": label,
      "aria-orientation": "vertical",
      "aria-valuemin": collapsedWidth ?? minWidth,
      "aria-valuemax": maxWidth,
      "aria-valuenow": Math.round(renderedWidth),
      tabIndex: 0,
      onPointerDown: startResize,
      onPointerMove: resize,
      onPointerUp: stopResize,
      onPointerCancel: stopResize,
      onLostPointerCapture: () => setIsResizing(false),
      onKeyDown: resizeWithKeyboard,
    }),
    [
      collapsedWidth,
      label,
      maxWidth,
      minWidth,
      renderedWidth,
      resize,
      resizeWithKeyboard,
      startResize,
      stopResize,
    ],
  );

  return {
    width: renderedWidth,
    setWidth,
    collapsed,
    expand,
    isResizing,
    separatorProps,
  };
}
