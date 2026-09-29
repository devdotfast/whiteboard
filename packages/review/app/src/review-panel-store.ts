import {
  type ReviewCommitSummary,
  type ReviewView,
  reviewViewSchema,
} from "@dev.fast/review-protocol";
import { createStore } from "zustand/vanilla";

import type { PeekPanel, ReviewPanelMotion } from "./review-panel-model";
import { shouldCloseSidePeekForReviewView } from "./review-view-route";

export interface ReviewPanelState {
  active: PeekPanel | null;
  motion: ReviewPanelMotion;
}

export interface TraceSelection {
  sessionId: string;
  trace?: string;
  eventIndex?: number;
}

/** A lens applies only to the version and diff mode it was chosen on. */
export interface ReviewLensSelection {
  id: string;
  version: number;
  mode: "structural" | "textual";
}

export interface ReviewDiffScope {
  commit: ReviewCommitSummary;
  file?: string;
  restoreFile?: boolean;
}

export interface MapFocus {
  requestId: number;
  elementPath: string;
  /** Cleared once the map has selected the element, so remounts don't replay it. */
  pending: boolean;
}

/** A fullscreen diagram tour. `kind` is absent on one restored from an
 * older build's in-panel record. */
export interface OverlayTour {
  tourId: string;
  kind?: "sequence" | "database";
  anchor: string;
  revealRequest: number;
}

/** Which canvas view is showing and what it is scoped to. */
export interface ReviewNavigationState {
  view: ReviewView;
  /** Views the canvas offers; navigation to any other lands on "review". */
  availableViews: readonly ReviewView[];
  diffScope: ReviewDiffScope | null;
  traceSelection: TraceSelection | undefined;
  lens: ReviewLensSelection | null;
  mapFocus: MapFocus | null;
  overlayTour: OverlayTour | null;
}

export interface ReviewPanelActions {
  suppressMotion: () => void;
  openPeek: (panel: PeekPanel) => void;
  close: () => void;
}

export interface ReviewNavigationActions {
  showView: (view: ReviewView) => void;
  openCommitDiff: (scope: ReviewDiffScope) => void;
  /** A lens opens its diff alongside any open peek. */
  selectLens: (lens: ReviewLensSelection) => void;
  clearLens: () => void;
  openTrace: (selection: TraceSelection) => void;
  selectTrace: (selection: TraceSelection) => void;
  setAvailableViews: (views: readonly ReviewView[]) => void;
  focusMapElement: (elementPath: string) => void;
  consumeMapFocus: (requestId: number) => void;
  openOverlayTour: (
    tour: { tourId: string; kind: "sequence" | "database" },
    anchor: string,
  ) => void;
  moveOverlayTour: (anchor: string, options: { reveal: boolean }) => void;
  closeOverlayTour: () => void;
}

export type ReviewPanelStoreState = ReviewPanelState &
  ReviewPanelActions &
  ReviewNavigationState &
  ReviewNavigationActions;

export type ReviewPanelStore = ReturnType<typeof createReviewPanelStore>;

export type ReviewNavigationRestore = Partial<
  Pick<
    ReviewNavigationState,
    | "view"
    | "availableViews"
    | "diffScope"
    | "traceSelection"
    | "lens"
    | "overlayTour"
  >
>;

export function createReviewPanelStore({
  view = "review",
  availableViews = reviewViewSchema.options,
  diffScope = null,
  traceSelection,
  lens = null,
  overlayTour = null,
}: ReviewNavigationRestore = {}) {
  const initialView = availableViews.includes(view) ? view : "review";

  return createStore<ReviewPanelStoreState>()((set) => ({
    active: null,
    motion: "live",
    view: initialView,
    availableViews,
    diffScope: initialView === "diff" ? diffScope : null,
    traceSelection,
    lens,
    mapFocus: null,
    overlayTour: initialView === "review" ? overlayTour : null,
    suppressMotion: () => set({ motion: "restored" }),
    openPeek: (panel) => set({ active: panel, motion: "live" }),
    close: () => set({ active: null, motion: "live" }),
    showView: (next) => set((state) => viewTransition(state, next)),
    openCommitDiff: (scope) =>
      set((state) => {
        const transition = viewTransition(state, "diff");

        return transition.view === "diff"
          ? { ...transition, diffScope: scope }
          : transition;
      }),
    selectLens: (lens) =>
      set((state) => ({
        ...viewTransition(state, "diff"),
        active: state.active,
        motion: state.motion,
        lens,
        diffScope: null,
      })),
    clearLens: () => set({ lens: null }),
    openTrace: (selection) =>
      set((state) => ({
        ...viewTransition(state, "trace"),
        traceSelection: selection,
      })),
    selectTrace: (selection) => set({ traceSelection: selection }),
    focusMapElement: (elementPath) =>
      set((state) =>
        state.availableViews.includes("map")
          ? {
              ...viewTransition(state, "map"),
              mapFocus: {
                requestId: (state.mapFocus?.requestId ?? 0) + 1,
                elementPath,
                pending: true,
              },
            }
          : state,
      ),
    consumeMapFocus: (requestId) =>
      set((state) =>
        state.mapFocus?.requestId === requestId && state.mapFocus.pending
          ? { mapFocus: { ...state.mapFocus, pending: false } }
          : state,
      ),
    openOverlayTour: (tour, anchor) =>
      set((state) => ({
        overlayTour: {
          ...tour,
          anchor,
          // Counts on across tours: a use-case switch keeps the panel mounted.
          revealRequest: (state.overlayTour?.revealRequest ?? 0) + 1,
        },
      })),
    moveOverlayTour: (anchor, { reveal }) =>
      set((state) =>
        state.overlayTour
          ? {
              overlayTour: {
                ...state.overlayTour,
                anchor,
                revealRequest: state.overlayTour.revealRequest + Number(reveal),
              },
            }
          : state,
      ),
    closeOverlayTour: () => set({ overlayTour: null }),
    setAvailableViews: (views) =>
      set((state) =>
        views.includes(state.view)
          ? { availableViews: views }
          : {
              ...viewTransition({ ...state, availableViews: views }, "review"),
              availableViews: views,
            },
      ),
  }));
}

function viewTransition(
  state: ReviewPanelState & ReviewNavigationState,
  requested: ReviewView,
): Partial<ReviewPanelState & ReviewNavigationState> {
  const view = state.availableViews.includes(requested) ? requested : "review";

  return {
    view,
    ...(view !== "diff" && { diffScope: null }),
    ...(view !== "map" &&
      state.mapFocus?.pending && {
        mapFocus: { ...state.mapFocus, pending: false },
      }),
    ...(view !== "review" && state.overlayTour && { overlayTour: null }),
    ...(shouldCloseSidePeekForReviewView(view) &&
      state.active && { active: null, motion: "live" }),
  };
}
