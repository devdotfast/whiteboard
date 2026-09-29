import {
  type ReviewCommitSummary,
  type ReviewView,
  reviewViewSchema,
} from "@dev.fast/review-protocol";
import { createStore } from "zustand/vanilla";

import type {
  GuidedTour,
  PeekPanel,
  ReviewPanel,
  ReviewPanelMotion,
} from "./review-panel-model";
import { shouldCloseSidePeekForReviewView } from "./review-view-route";

export interface ReviewPanelState {
  active: ReviewPanel | null;
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
}

export interface MapFocus {
  requestId: number;
  elementPath: string;
  /** Cleared once the map has selected the element, so remounts don't replay it. */
  pending: boolean;
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
}

export interface ReviewPanelActions {
  suppressMotion: () => void;
  openPeek: (panel: PeekPanel) => void;
  openTour: (tour: GuidedTour, activeAnchor: string) => void;
  restoreTour: (tour: GuidedTour, activeAnchor: string) => void;
  activateTourAnchor: (anchorId: string, options: { reveal: boolean }) => void;
  close: () => void;
}

export interface ReviewNavigationActions {
  showView: (view: ReviewView) => void;
  openCommitDiff: (scope: ReviewDiffScope) => void;
  /** A lens opens its diff alongside any open peek. */
  selectLens: (lens: ReviewLensSelection) => void;
  clearLens: () => void;
  openTrace: (selection: TraceSelection) => void;
  setAvailableViews: (views: readonly ReviewView[]) => void;
  focusMapElement: (elementPath: string) => void;
  consumeMapFocus: (requestId: number) => void;
}

export type ReviewPanelStoreState = ReviewPanelState &
  ReviewPanelActions &
  ReviewNavigationState &
  ReviewNavigationActions;

export type ReviewPanelStore = ReturnType<typeof createReviewPanelStore>;

export type ReviewNavigationRestore = Partial<
  Pick<ReviewNavigationState, "view" | "availableViews" | "lens">
>;

export function createReviewPanelStore({
  view = "review",
  availableViews = reviewViewSchema.options,
  lens = null,
}: ReviewNavigationRestore = {}) {
  return createStore<ReviewPanelStoreState>()((set) => ({
    active: null,
    motion: "live",
    view: availableViews.includes(view) ? view : "review",
    availableViews,
    diffScope: null,
    traceSelection: undefined,
    lens,
    mapFocus: null,
    suppressMotion: () => set({ motion: "restored" }),
    openPeek: (panel) => set({ active: panel, motion: "live" }),
    openTour: (tour, activeAnchor) => {
      set((state) => ({
        active: {
          kind: "tour",
          tour,
          activeAnchor,
          revealRequest:
            state.active?.kind === "tour" ? state.active.revealRequest + 1 : 1,
        },
        motion: "live",
      }));
    },
    restoreTour: (tour, activeAnchor) => {
      set({
        active: {
          kind: "tour",
          tour,
          activeAnchor,
          revealRequest: 0,
        },
        motion: "restored",
      });
    },
    activateTourAnchor: (anchorId, options) => {
      set((state) => {
        if (state.active?.kind !== "tour") return state;

        return {
          active: {
            ...state.active,
            activeAnchor: anchorId,
            revealRequest: options.reveal
              ? state.active.revealRequest + 1
              : state.active.revealRequest,
          },
          motion: options.reveal ? "live" : state.motion,
        };
      });
    },
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
    ...(shouldCloseSidePeekForReviewView(view) &&
      state.active && { active: null, motion: "live" }),
  };
}
