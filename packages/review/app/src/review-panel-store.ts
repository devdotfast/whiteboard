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
  AskPresence,
  AskReport,
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
  /** The open Asks, oldest first, wherever each shows. */
  asks: AskPanel[];
  /** The Ask in the side panel, if any. */
  askDocked: number | null;
  /** The Ask in the window over the canvas, if any. */
  askWindow: number | null;
  /** Where the next Ask opens: where the last one was shown. */
  askPlace: AskPlace;
  /** Where the window was dragged to; until then, the bottom right. */
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

/** A lens applies only to the version it was chosen on. */
export interface ReviewLensSelection {
  id: string;
  version: number;
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
  /** Cleared by any navigation. */
  diffReveal: { path: string; request: number } | null;
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
  openAsk: (
    selection: AgentSelection,
    agent?: AskAgentId,
    options?: AskOpenOptions,
  ) => void;
  /** Shows a view where Asks open, or the Ask `from` is in. One already
   * open comes forward instead. A view takes the place of the Ask there,
   * unless that one's agent is working: then it opens beside it. */
  openAskView: (view: AskView, options?: AskOpenOptions) => void;
  /** An open Ask says what its conversation is doing. */
  reportAsk: (key: number, report: AskReport) => void;
  /** Closes the peek. */
  close: () => void;
  closeAsk: (key: number) => void;
  popOutAsk: (key: number) => void;
  /** Puts an Ask in the side panel, in place of any peek. */
  dockAsk: (key: number) => void;
  /** Takes an Ask off the screen. It stays open, and its agent runs on;
   * the Threads tab brings it back. */
  hideAsk: (key: number) => void;
  /** Moves the window, resizing it too. */
  placeAsk: (anchor: AskAnchor, size?: AskSize) => void;
}

export interface AskOpenOptions {
  /** The Ask asking, whose place the view opens in. */
  from?: number;
  /** Takes that Ask's place even while its agent works, as when its
   * conversation was deleted. */
  replace?: boolean;
}

export interface ReviewNavigationActions {
  showView: (view: ReviewView) => void;
  openCommitDiff: (scope: ReviewDiffScope) => void;
  revealDiffFile: (path: string) => void;
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

/** The open Asks to start with, as a review's canvas last left them. */
export interface AskRestore extends Pick<
  ReviewPanelState,
  "askDocked" | "askWindow" | "askPlace" | "askAnchor" | "askSize"
> {
  asks: { key: number; view: AskView }[];
}

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

export type ReviewPanelRestore = ReviewNavigationRestore & {
  asks?: AskRestore;
};

export function createReviewPanelStore({
  view = "review",
  availableViews = reviewViewSchema.options,
  diffScope = null,
  traceSelection,
  traceStorage = null,
  lens = null,
  overlayTour = null,
  asks: restored,
}: ReviewPanelRestore = {}) {
  const initialView = availableViews.includes(view) ? view : "review";
  const asks = restored?.asks.map(({ key, view }) => newAsk(key, view)) ?? [];

  // A place shows a restored Ask only if it is among them.
  const open = (key: number | null | undefined) =>
    asks.find((ask) => ask.key === key)?.key ?? null;

  let nextDiffReveal = 0;

  let nextAskKey = Math.max(-1, ...asks.map((ask) => ask.key)) + 1;

  // A view opens where Asks open, or where the Ask that asked is; docked, it
  // takes the peek's place. One already open comes forward instead.
  const showAsk = (
    state: ReviewPanelStoreState,
    view: AskView,
    { from, replace = false }: AskOpenOptions,
  ): Partial<ReviewPanelState> => {
    // The Ask asking for its own view wants it afresh, as to reconnect.
    const open = state.asks.find(
      (ask) => ask.key !== from && showsView(ask, view),
    );

    if (open)
      return {
        ...showAt(state, open.key, placeOf(state, open.key) ?? state.askPlace),
        motion: "live",
      };

    // Under a fullscreen tour, a docked Ask shows only as a pill.
    const place =
      (from !== undefined && placeOf(state, from)) ||
      (state.overlayTour ? "window" : state.askPlace);

    const there = place === "docked" ? state.askDocked : state.askWindow;
    const occupant = state.asks.find((ask) => ask.key === there);
    const ask = newAsk(nextAskKey++, view);

    return {
      // An Ask whose agent works leaves the screen, never replaced.
      asks:
        occupant && (!occupant.busy || (replace && occupant.key === from))
          ? state.asks.map((each) => (each === occupant ? ask : each))
          : [...state.asks, ask],
      ...(place === "docked"
        ? { askDocked: ask.key, active: null }
        : { askWindow: ask.key }),
      askPlace: state.overlayTour ? state.askPlace : place,
      // Switching views inside an open panel is not a new panel.
      motion:
        place === "docked" &&
        there !== null &&
        askShown(state, there) === "panel"
          ? "restored"
          : "live",
    };
  };

  return createStore<ReviewPanelStoreState>()((set) => ({
    active: null,
    asks,
    askDocked: open(restored?.askDocked),
    askWindow: open(restored?.askWindow),
    askPlace: restored?.askPlace ?? "docked",
    askAnchor: restored?.askAnchor ?? null,
    askSize: restored?.askSize ?? null,
    motion: "live",
    view: initialView,
    availableViews,
    diffScope: initialView === "diff" ? diffScope : null,
    diffReveal: null,
    traceSelection,
    traceStorage,
    lens,
    mapFocus: null,
    overlayTour: initialView === "review" ? overlayTour : null,
    suppressMotion: () => set({ motion: "restored" }),
    // A peek replaces a docked Ask, which leaves the screen.
    openPeek: (panel) =>
      set({ active: panel, motion: "live", askDocked: null }),
    openAsk: (selection, agent, options = {}) =>
      set((state) => ({
        ...showAsk(state, { type: "new", selection, agent }, options),
        motion: "live",
      })),
    openAskView: (view, options = {}) =>
      set((state) => showAsk(state, view, options)),
    reportAsk: (key, report) =>
      set((state) => {
        const reporting = state.asks.find((ask) => ask.key === key);

        return reporting && !sameReport(reporting, report)
          ? {
              asks: state.asks.map((ask) =>
                ask === reporting ? { ...ask, ...report } : ask,
              ),
            }
          : state;
      }),
    close: () => set({ active: null, motion: "live" }),
    closeAsk: (key) =>
      set((state) => ({
        asks: state.asks.filter((ask) => ask.key !== key),
        ...unplaced(state, key),
      })),
    popOutAsk: (key) =>
      set((state) => ({ ...showAt(state, key, "window"), motion: "live" })),
    dockAsk: (key) =>
      set((state) => ({ ...showAt(state, key, "docked"), motion: "live" })),
    hideAsk: (key) => set((state) => unplaced(state, key)),
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
    revealDiffFile: (path) =>
      set((state) => {
        const transition = viewTransition(state, "diff");

        return transition.view === "diff"
          ? { ...transition, diffReveal: { path, request: nextDiffReveal++ } }
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
    clearLens: () => set({ lens: null, diffReveal: null }),
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

type AskShownState = ReviewPanelState &
  Pick<ReviewNavigationState, "overlayTour">;

/** How the Ask with this key shows now, if it shows: a fullscreen
 * diagram covers the docked Ask until it closes. */
export function askShown(state: AskShownState, key: number): AskShown | null {
  if (key === state.askWindow) return "window";

  return key === state.askDocked && !state.overlayTour ? "panel" : null;
}

/** Whether an Ask fills the side panel. */
export function askDockedShown(state: AskShownState): boolean {
  return (
    state.askDocked !== null && askShown(state, state.askDocked) === "panel"
  );
}

const historyPresence: AskPresence = { agentName: "Ask" };

function newAsk(key: number, view: AskView): AskPanel {
  return {
    kind: "ask",
    key,
    view,
    threadId: view.type === "saved" ? view.threadId : null,
    busy: false,
    presence:
      view.type === "history"
        ? historyPresence
        : { agent: view.agent, agentName: "Ask" },
  };
}

/** Whether an open Ask already shows this view: the same conversation, or
 * the same list of them. */
function showsView(ask: AskPanel, view: AskView): boolean {
  if (view.type === "saved") return ask.threadId === view.threadId;

  if (view.type !== "history" || ask.view.type !== "history") return false;

  return (
    JSON.stringify(ask.view.passage ?? null) ===
    JSON.stringify(view.passage ?? null)
  );
}

function placeOf(state: ReviewPanelState, key: number): AskPlace | null {
  if (key === state.askDocked) return "docked";

  if (key === state.askWindow) return "window";

  return null;
}

/** Shows an open Ask in a place; the one there leaves the screen. Docked,
 * it takes the peek's place. */
function showAt(
  state: ReviewPanelState,
  key: number,
  place: AskPlace,
): Partial<ReviewPanelState> {
  if (!state.asks.some((ask) => ask.key === key)) return {};

  return place === "docked"
    ? {
        askDocked: key,
        askWindow: state.askWindow === key ? null : state.askWindow,
        askPlace: place,
        active: null,
      }
    : {
        askWindow: key,
        askDocked: state.askDocked === key ? null : state.askDocked,
        askPlace: place,
      };
}

/** Takes an Ask out of the side panel or the window. */
function unplaced(
  state: ReviewPanelState,
  key: number,
): Partial<ReviewPanelState> {
  return {
    askDocked: state.askDocked === key ? null : state.askDocked,
    askWindow: state.askWindow === key ? null : state.askWindow,
  };
}

function sameReport(ask: AskPanel, report: AskReport) {
  return (
    ask.threadId === report.threadId &&
    ask.busy === report.busy &&
    ask.presence.agent === report.presence.agent &&
    ask.presence.agentName === report.presence.agentName
  );
}

function viewTransition(
  state: ReviewPanelState & ReviewNavigationState,
  requested: ReviewView,
): Partial<ReviewPanelState & ReviewNavigationState> {
  const view = state.availableViews.includes(requested) ? requested : "review";

  return {
    view,
    diffReveal: null,
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
