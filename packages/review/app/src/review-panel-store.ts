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
import type { TraceSelection } from "./ReviewTraceView";

export interface ReviewPanelState {
  active: ReviewPanel | null;
  motion: ReviewPanelMotion;
}

export interface ReviewDiffScope {
  commit: ReviewCommitSummary;
  file?: string;
}

/** Which canvas view is showing and what it is scoped to. */
export interface ReviewNavigationState {
  view: ReviewView;
  /** Views the canvas offers; navigation to any other lands on "review". */
  availableViews: readonly ReviewView[];
  diffScope: ReviewDiffScope | null;
  traceSelection: TraceSelection | undefined;
}

export interface ReviewPanelActions {
  suppressMotion: () => void;
  openPeek: (panel: PeekPanel) => void;
  openTour: (tour: GuidedTour, activeAnchor: string) => void;
  restoreTour: (tour: GuidedTour, activeAnchor: string) => void;
  activateTourAnchor: (anchorId: string, options: { reveal: boolean }) => void;
  close: () => void;
  closeForDocumentChange: () => void;
}

export interface ReviewNavigationActions {
  showView: (view: ReviewView) => void;
  openCommitDiff: (scope: ReviewDiffScope) => void;
  /** A lens opens the full diff alongside any open peek. */
  openLensDiff: () => void;
  openTrace: (selection: TraceSelection) => void;
  setAvailableViews: (views: readonly ReviewView[]) => void;
}

export type ReviewPanelStoreState = ReviewPanelState &
  ReviewPanelActions &
  ReviewNavigationState &
  ReviewNavigationActions;

export type ReviewPanelStore = ReturnType<typeof createReviewPanelStore>;

export function createReviewPanelStore({
  view = "review",
}: { view?: ReviewView } = {}) {
  return createStore<ReviewPanelStoreState>()((set) => ({
    active: null,
    motion: "live",
    view,
    availableViews: reviewViewSchema.options,
    diffScope: null,
    traceSelection: undefined,
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
    closeForDocumentChange: () =>
      set((state) => (state.active ? { active: null, motion: "live" } : state)),
    showView: (next) => set((state) => viewTransition(state, next)),
    openCommitDiff: (scope) =>
      set((state) => {
        const transition = viewTransition(state, "diff");

        return transition.view === "diff"
          ? { ...transition, diffScope: scope }
          : transition;
      }),
    openLensDiff: () =>
      set((state) => ({
        view: state.availableViews.includes("diff") ? "diff" : "review",
        diffScope: null,
      })),
    openTrace: (selection) =>
      set((state) => ({
        ...viewTransition(state, "trace"),
        traceSelection: selection,
      })),
    setAvailableViews: (views) =>
      set((state) => {
        if (sameViews(state.availableViews, views)) return state;

        return views.includes(state.view)
          ? { availableViews: views }
          : {
              ...viewTransition({ ...state, availableViews: views }, "review"),
              availableViews: views,
            };
      }),
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
    ...(shouldCloseSidePeekForReviewView(view) &&
      state.active && { active: null, motion: "live" }),
  };
}

function sameViews(
  left: readonly ReviewView[],
  right: readonly ReviewView[],
): boolean {
  return (
    left.length === right.length &&
    left.every((view, index) => view === right[index])
  );
}
