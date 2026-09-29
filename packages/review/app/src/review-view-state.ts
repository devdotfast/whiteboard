import {
  type JsonObject,
  type JsonValue,
  isJsonObject,
  jsonNumber,
  jsonObject,
  jsonProperty,
  jsonString,
  parseJsonText,
} from "@dev.fast/review-protocol";
import type { RefObject } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import type { ReviewClientConfig } from "./host/review-client";
import { useReviewSession } from "./host/review-session";
import type {
  OverlayTour,
  ReviewLensSelection,
  ReviewNavigationRestore,
  ReviewPanelStore,
} from "./review-panel-store";
import {
  readReviewUiState,
  removeReviewUiState,
  reviewUiStateKey,
  writeReviewUiState,
} from "./review-ui-state";
import { type ReviewView, offeredReviewViews } from "./review-view-route";

const REVIEW_VIEW_STATE_NAMESPACE = "view-state";

const SCROLL_RESTORE_DEADLINE_MS = 30_000;

export interface PersistedReviewViewState {
  scrollTop?: number;
  activeView?: ReviewView;
  /** The lens applied to the diff; restored only on its own version. */
  lens?: ReviewLensSelection;
  /** Written by older builds for an in-panel tour; read only as a fallback. */
  panel?: PersistedTourPanel;
  /** A fullscreen diagram tour (sequence or database lens) that was open. */
  overlayTour?: PersistedOverlayTour;
}

export interface PersistedOverlayTour {
  tourId: string;
  activeAnchor: string;
  kind?: OverlayTour["kind"];
}

export interface PersistedTourPanel {
  kind: "tour";
  tourId: string;
  activeAnchor: string;
}

export function useReviewViewStateSync({
  scrollRegionRef,
  panelStore,
}: {
  scrollRegionRef: RefObject<HTMLElement | null>;
  panelStore: ReviewPanelStore;
}): void {
  const session = useReviewSession();
  const key = reviewViewStateKey(session.config);

  const initialState = useMemo(
    () => readPersistedReviewViewState(session.config),
    [session.config],
  );

  const persistedRef = useRef(initialState);

  const persist = useCallback(
    (next: PersistedReviewViewState) => {
      // Normalise exactly as a stored value reads back.
      const normalized = parsePersistedReviewViewState(
        parseJsonText(JSON.stringify(next)),
      );

      if (JSON.stringify(normalized) === JSON.stringify(persistedRef.current)) {
        return;
      }

      persistedRef.current = normalized;
      writeReviewUiState("session", key, normalized);
    },
    [key],
  );

  // Layout, so navigation from a host event right after mount still persists.
  useLayoutEffect(
    () =>
      panelStore.subscribe((state, previous) => {
        if (
          state.view === previous.view &&
          state.lens === previous.lens &&
          state.overlayTour === previous.overlayTour
        ) {
          return;
        }

        // The store holds the tour a legacy panel record restored, so the
        // record is rewritten as an overlay tour, never as a panel.
        persist({
          ...persistedRef.current,
          panel: undefined,
          ...(state.view !== previous.view && { activeView: state.view }),
          ...(state.lens !== previous.lens && {
            lens: state.lens ?? undefined,
          }),
          overlayTour: state.overlayTour
            ? {
                tourId: state.overlayTour.tourId,
                activeAnchor: state.overlayTour.anchor,
                kind: state.overlayTour.kind,
              }
            : undefined,
        });
      }),
    [panelStore, persist],
  );

  const scrollRestorationPending = useScrollRestoration(
    scrollRegionRef,
    initialState.scrollTop,
  );

  useScrollCapture(
    scrollRegionRef,
    persist,
    persistedRef,
    scrollRestorationPending,
  );
}

/** The navigation a canvas resumes: its stored view where the canvas still
 * offers it, its stored lens when that lens belongs to this version, and the
 * fullscreen tour that was open. */
export function readReviewNavigationRestore(
  config: ReviewClientConfig,
  canvas: {
    softwareMapEnabled: boolean;
    hasChangeRange: boolean;
    version: number;
    lensMode: ReviewLensSelection["mode"];
  },
): ReviewNavigationRestore {
  const stored = readPersistedReviewViewState(config);

  const tour: PersistedOverlayTour | undefined =
    stored.overlayTour ??
    (stored.panel && {
      tourId: stored.panel.tourId,
      activeAnchor: stored.panel.activeAnchor,
    });

  return {
    view: stored.activeView ?? "review",
    // Traces are listed after mount; the canvas narrows this once they are.
    availableViews: offeredReviewViews({
      hasChangeRange: canvas.hasChangeRange,
      softwareMapEnabled: canvas.softwareMapEnabled,
      hasTraceSessions: true,
    }),
    lens:
      stored.lens?.version === canvas.version &&
      stored.lens.mode === canvas.lensMode
        ? stored.lens
        : null,
    overlayTour: tour
      ? {
          tourId: tour.tourId,
          kind: tour.kind,
          anchor: tour.activeAnchor,
          revealRequest: 0,
        }
      : null,
  };
}

export function reviewViewStateKey(config: ReviewClientConfig): string {
  return reviewUiStateKey(config, "session", REVIEW_VIEW_STATE_NAMESPACE);
}

export function readPersistedReviewViewState(
  config: ReviewClientConfig,
): PersistedReviewViewState {
  const value = readReviewUiState<JsonValue>(
    "session",
    reviewViewStateKey(config),
  );

  return parsePersistedReviewViewState(value);
}

export function clearPersistedReviewViewState(
  config: ReviewClientConfig,
): void {
  removeReviewUiState("session", reviewViewStateKey(config));
}

function useScrollRestoration(
  scrollRegionRef: RefObject<HTMLElement | null>,
  scrollTop: number | undefined,
): RefObject<boolean> {
  const pendingRef = useRef(false);
  useLayoutEffect(() => {
    const scrollRegion = scrollRegionRef.current;
    pendingRef.current = scrollRegion !== null && scrollTop !== undefined;

    if (!scrollRegion || scrollTop === undefined) return;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let aborted = false;

    const removeUserListeners = () => {
      scrollRegion.removeEventListener("wheel", abortForUserInput);
      scrollRegion.removeEventListener("pointerdown", abortForUserInput);
      scrollRegion.removeEventListener("touchstart", abortForUserInput);
      scrollRegion.removeEventListener("keydown", abortForNavigationKey);
    };

    const finish = () => {
      if (aborted) return;
      aborted = true;
      pendingRef.current = false;

      if (deadline !== null) clearTimeout(deadline);
      deadline = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      removeUserListeners();
    };

    const restore = () => {
      if (aborted) return;

      const maxScrollTop = Math.max(
        0,
        scrollRegion.scrollHeight - scrollRegion.clientHeight,
      );

      scrollRegion.scrollTop = Math.min(scrollTop, maxScrollTop);

      if (scrollTop <= maxScrollTop) {
        finish();
      }
    };

    const abortForUserInput = () => finish();

    const abortForNavigationKey = (event: Event) => {
      if (
        event instanceof KeyboardEvent &&
        [
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "End",
          "Home",
          "PageDown",
          "PageUp",
        ].includes(event.key)
      ) {
        finish();
      }
    };

    scrollRegion.addEventListener("wheel", abortForUserInput, {
      passive: true,
    });
    scrollRegion.addEventListener("pointerdown", abortForUserInput, {
      passive: true,
    });
    scrollRegion.addEventListener("touchstart", abortForUserInput, {
      passive: true,
    });
    scrollRegion.addEventListener("keydown", abortForNavigationKey);
    resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(restore);

    if (resizeObserver) {
      resizeObserver.observe(scrollRegion);

      for (const child of layoutChildren(scrollRegion)) {
        resizeObserver.observe(child);
      }
    }

    deadline = setTimeout(finish, SCROLL_RESTORE_DEADLINE_MS);
    restore();

    return () => {
      if (deadline !== null) clearTimeout(deadline);
      resizeObserver?.disconnect();
      removeUserListeners();
      pendingRef.current = false;
    };
  }, [scrollRegionRef, scrollTop]);

  return pendingRef;
}

/**
 * The region's box-generating children: any descendant growing resizes one of
 * them, so observing these sees every change without observing the document.
 * `display: contents` wrappers generate no box, so look through them.
 */
function* layoutChildren(element: Element): Generator<Element> {
  for (const child of element.children) {
    if (getComputedStyle(child).display === "contents") {
      yield* layoutChildren(child);
    } else {
      yield child;
    }
  }
}

function useScrollCapture(
  scrollRegionRef: RefObject<HTMLElement | null>,
  persist: (state: PersistedReviewViewState) => void,
  persistedRef: RefObject<PersistedReviewViewState>,
  restorationPending: RefObject<boolean>,
): void {
  useEffect(() => {
    const scrollRegion = scrollRegionRef.current;

    if (!scrollRegion) return;
    let frame: number | null = null;
    let dirty = false;

    const write = () => {
      frame = null;

      if (!dirty) return;
      dirty = false;

      if (restorationPending.current) return;
      persist({
        ...persistedRef.current,
        scrollTop: scrollRegion.scrollTop,
      });
    };

    const onScroll = () => {
      dirty = true;

      if (frame === null) frame = requestAnimationFrame(write);
    };

    scrollRegion.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      scrollRegion.removeEventListener("scroll", onScroll);

      if (frame !== null) cancelAnimationFrame(frame);

      if (dirty) write();
    };
  }, [persist, persistedRef, restorationPending, scrollRegionRef]);
}

function parsePersistedReviewViewState(
  value: JsonValue | null,
): PersistedReviewViewState {
  if (!isJsonObject(value)) return {};
  const state: PersistedReviewViewState = {};
  const scrollTop = jsonNumber(jsonProperty(value, "scrollTop"));

  if (scrollTop !== undefined && scrollTop >= 0) state.scrollTop = scrollTop;
  const activeView = jsonString(jsonProperty(value, "activeView"));

  if (
    activeView === "review" ||
    activeView === "commits" ||
    activeView === "map" ||
    activeView === "diff"
  ) {
    state.activeView = activeView;
  }

  const lens = parsePersistedLens(jsonObject(jsonProperty(value, "lens")));

  if (lens) state.lens = lens;

  const panel = parsePersistedPanel(jsonObject(jsonProperty(value, "panel")));

  if (panel) state.panel = panel;

  const overlayTour = parsePersistedTourState(
    jsonObject(jsonProperty(value, "overlayTour")),
  );

  if (overlayTour) state.overlayTour = overlayTour;

  return state;
}

function parsePersistedLens(
  lens: JsonObject | undefined,
): ReviewLensSelection | undefined {
  if (!lens) return undefined;
  const id = jsonString(jsonProperty(lens, "id"));
  const version = jsonNumber(jsonProperty(lens, "version"));
  const mode = jsonString(jsonProperty(lens, "mode"));

  return id !== undefined &&
    version !== undefined &&
    (mode === "structural" || mode === "textual")
    ? { id, version, mode }
    : undefined;
}

function parsePersistedPanel(
  panel: JsonObject | undefined,
): PersistedTourPanel | undefined {
  if (!panel) return undefined;
  const kind = jsonString(jsonProperty(panel, "kind"));
  const tour = parsePersistedTourState(panel);

  if (kind === "tour" && tour) {
    return {
      kind: "tour",
      tourId: tour.tourId,
      activeAnchor: tour.activeAnchor,
    };
  }

  return undefined;
}

function parsePersistedTourState(
  tour: JsonObject | undefined,
): PersistedOverlayTour | undefined {
  const tourId = jsonString(tour && jsonProperty(tour, "tourId"));
  const activeAnchor = jsonString(tour && jsonProperty(tour, "activeAnchor"));
  const kind = jsonString(tour && jsonProperty(tour, "kind"));

  if (tourId === undefined || activeAnchor === undefined) return undefined;

  return kind === "sequence" || kind === "database"
    ? { tourId, activeAnchor, kind }
    : { tourId, activeAnchor };
}
