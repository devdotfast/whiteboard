import {
  type ReviewCommitSummary,
  type ReviewView,
  reviewViewSchema,
} from "@dev.fast/review-protocol";
import type { AgentSelection } from "@review/agent-selection";
import type { AskAgentId } from "@review/ask/thread-state";
import { createStore } from "zustand/vanilla";

import type {
  AskAnchor,
  AskPanel,
  AskPlace,
  AskShown,
  AskSize,
  AskView,
  PeekPanel,
  ReviewPanelMotion,
} from "./review-panel-model";
import { shouldCloseSidePeekForReviewView } from "./review-view-route";
import type { AgentTraceStorage } from "./use-agent-trace";

export interface ReviewPanelState {
  /** The peek in the side panel. */
  active: PeekPanel | null;
  /** The open conversation, wherever it shows. */
  ask: AskPanel | null;
  askPlace: AskPlace;
  askMinimized: boolean;
  /** Where the window and the pill were dragged to; until then, the bottom
   * right. */
  askAnchor: AskAnchor | null;
  /** How big the window was made; until then, as wide as the docked panel. */
  askSize: AskSize | null;
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
  /** `file` came from a reload; a saved diff position wins over it. */
  restoreFile?: boolean;
}

export interface MapFocus {
  requestId: number;
  elementPath: string;
  /** Cleared once the map has selected the element, so remounts don't replay it. */
  pending: boolean;
}

export type OverlayTourKind = "sequence" | "database" | "flow";

/** A fullscreen diagram tour. `kind` is absent on one restored from an
 * older build's in-panel record. */
export interface OverlayTour {
  tourId: string;
  kind?: OverlayTourKind;
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
  /** null reads the configured default. */
  traceStorage: AgentTraceStorage | null;
  lens: ReviewLensSelection | null;
  mapFocus: MapFocus | null;
  overlayTour: OverlayTour | null;
}

export interface ReviewPanelActions {
  suppressMotion: () => void;
  openPeek: (panel: PeekPanel) => void;
  openAsk: (selection: AgentSelection, agent?: AskAgentId) => void;
  openAskView: (view: AskView) => void;
  /** Closes the peek; a docked Ask it covered comes back. */
  close: () => void;
  closeAsk: () => void;
  popOutAsk: () => void;
  /** Puts Ask back in the side panel, in place of any peek. */
  dockAsk: () => void;
  minimizeAsk: () => void;
  /** The pill opens Ask in its window. */
  restoreAsk: () => void;
  /** Moves the window and the pill together, resizing the window too. */
  placeAsk: (anchor: AskAnchor, size?: AskSize) => void;
}

export interface ReviewNavigationActions {
  showView: (view: ReviewView) => void;
  openCommitDiff: (scope: ReviewDiffScope) => void;
  /** A lens opens its diff alongside any open peek. */
  selectLens: (lens: ReviewLensSelection) => void;
  clearLens: () => void;
  openTrace: (selection: TraceSelection) => void;
  selectTrace: (selection: TraceSelection) => void;
  selectTraceStorage: (storage: AgentTraceStorage | null) => void;
  setAvailableViews: (views: readonly ReviewView[]) => void;
  focusMapElement: (elementPath: string) => void;
  consumeMapFocus: (requestId: number) => void;
  openOverlayTour: (
    tour: { tourId: string; kind: OverlayTourKind },
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
    | "traceStorage"
    | "lens"
    | "overlayTour"
  >
>;

export function createReviewPanelStore({
  view = "review",
  availableViews = reviewViewSchema.options,
  diffScope = null,
  traceSelection,
  traceStorage = null,
  lens = null,
  overlayTour = null,
}: ReviewNavigationRestore = {}) {
  const initialView = availableViews.includes(view) ? view : "review";

  // Asking shows Ask where it was; docked, it takes the peek's place.
  const showAsk = (
    state: ReviewPanelState,
    view: AskView,
  ): Partial<ReviewPanelState> => ({
    ask: { kind: "ask", key: state.ask ? state.ask.key + 1 : 0, view },
    askMinimized: false,
    active: state.askPlace === "docked" ? null : state.active,
  });

  return createStore<ReviewPanelStoreState>()((set) => ({
    active: null,
    ask: null,
    askPlace: "docked",
    askMinimized: false,
    askAnchor: null,
    askSize: null,
    motion: "live",
    view: initialView,
    availableViews,
    diffScope: initialView === "diff" ? diffScope : null,
    traceSelection,
    traceStorage,
    lens,
    mapFocus: null,
    overlayTour: initialView === "review" ? overlayTour : null,
    suppressMotion: () => set({ motion: "restored" }),
    openPeek: (panel) => set({ active: panel, motion: "live" }),
    openAsk: (selection, agent) =>
      set((state) => ({
        ...showAsk(state, { type: "new", selection, agent }),
        motion: "live",
      })),
    openAskView: (view) =>
      set((state) => ({
        ...showAsk(state, view),
        // Switching views inside an open panel is not a new panel.
        motion: askShown(state) === "panel" ? "restored" : "live",
      })),
    close: () => set({ active: null, motion: "live" }),
    closeAsk: () => set({ ask: null, askMinimized: false }),
    popOutAsk: () => set({ askPlace: "window", askMinimized: false }),
    dockAsk: () =>
      set({
        askPlace: "docked",
        askMinimized: false,
        active: null,
        motion: "live",
      }),
    minimizeAsk: () => set({ askMinimized: true }),
    restoreAsk: () => set({ askPlace: "window", askMinimized: false }),
    placeAsk: (askAnchor, askSize) =>
      set(askSize ? { askAnchor, askSize } : { askAnchor }),
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
    selectTraceStorage: (traceStorage) => set({ traceStorage }),
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

export function askShown(
  state: ReviewPanelState & Pick<ReviewNavigationState, "overlayTour">,
): AskShown | null {
  if (!state.ask) return null;

  if (state.askMinimized) return "pill";

  if (state.askPlace === "window") return "window";

  return state.active || state.overlayTour ? "pill" : "panel";
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
