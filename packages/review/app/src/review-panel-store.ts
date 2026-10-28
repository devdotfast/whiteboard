import { type ReviewView, reviewViewSchema } from "@dev.fast/review-protocol";
import type { AgentSelection } from "@review/agent-selection";
import type { AskAgentId } from "@review/ask/thread-state";
import { type StateCreator, createStore } from "zustand/vanilla";

import type {
  AskAnchor,
  AskPanel,
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

/**
 * The column right of the board holds one thing: a peek, in `active`, or
 * the thread in `askColumn`. Whatever opens last replaces it; a thread
 * whose agent is working floats into the window instead, and one that is
 * idle leaves the screen. Off screen, a thread's agent runs on, and the
 * Threads tab and its pin bring it back.
 */
export interface ReviewPanelState {
  /** The peek in the column. */
  active: PeekPanel | null;
  /** The threads on screen: the column's and the window's. */
  asks: AskPanel[];
  /** The thread in the column, if any; never with a peek. */
  askColumn: number | null;
  /** The thread floating in the window over the board, if any. */
  askWindow: number | null;
  /** Where the window was dragged to; until then, the bottom right. */
  askAnchor: AskAnchor | null;
  /** How big the window was made; until then, as wide as the docked panel. */
  askSize: AskSize | null;
  /** The column is put away, whatever it holds: what is there stays
   * mounted, a working thread works on, and it all shows again as it was. */
  columnHidden: boolean;
  motion: ReviewPanelMotion;
  /** Too narrow for the contents rail: "⋯" offers the list. */
  contentsRailHidden: boolean;
  /** Bumped to open the contents list. */
  contentsRequest: number;
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
  /** Facts come from the board's commits. */
  commit: string;
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
  moveInlineTour: (anchor: string, options: { reveal: boolean }) => void;
  openAsk: (
    selection: AgentSelection,
    agent?: AskAgentId,
    options?: AskOpenOptions,
  ) => void;
  /** Shows a view in the column, or in the window when the window's Ask
   * asks for it. One already on screen stays where it is instead. */
  openAskView: (view: AskView, options?: AskOpenOptions) => void;
  /** An open Ask says what its conversation is doing. */
  reportAsk: (key: number, report: AskReport) => void;
  /** Closes the peek. */
  close: () => void;
  /** Takes a thread off the screen; the caller stops its agent if needed. */
  hideAsk: (key: number) => void;
  /** Floats the column's thread in the window. */
  popOutAsk: (key: number) => void;
  /** Puts the window's thread in the column, in place of what is there. */
  dockAsk: (key: number) => void;
  /** Moves the window, resizing it too. */
  placeAsk: (anchor: AskAnchor, size?: AskSize) => void;
  /** Puts the column away, or brings back what it held; if it held
   * nothing, `fallback` opens in it. */
  toggleColumn: (fallback: AskView) => void;
  setContentsRailHidden: (hidden: boolean) => void;
  openContents: () => void;
}

export interface AskOpenOptions {
  /** The Ask asking, whose place the view opens in. */
  from?: number;
  /** That Ask leaves the screen even while its agent works, as when its
   * conversation was deleted. */
  replace?: boolean;
  /** Leaves the caret where it is, as a click on a passage's words in the
   * board's editor does. */
  keepFocus?: boolean;
}

export interface ReviewNavigationActions {
  showView: (view: ReviewView) => void;
  openCommitDiff: (scope: ReviewDiffScope) => void;
  revealDiffFile: (path: string) => void;
  /** Filters the Diff view to a commit, or clears it, in any view. */
  pickCommit: (scope: ReviewDiffScope | null) => void;
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

/** The threads to start with, as the project's boards last left them in
 * this window. */
export interface AskRestore extends Pick<
  ReviewPanelState,
  "askColumn" | "askWindow" | "askAnchor" | "askSize"
> {
  /** Kept for the window rather than the project. */
  columnHidden?: boolean;
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

  // A view opens in the column, or in the window when the window's Ask
  // asks; what it replaces moves aside. One on screen stays put instead.
  const showAsk = (
    state: ReviewPanelStoreState,
    view: AskView,
    { from, replace = false, keepFocus = false }: AskOpenOptions,
  ): Partial<ReviewPanelState> => {
    // The Ask asking for its own view wants it afresh, as to reconnect.
    const showing = state.asks.find(
      (ask) => ask.key !== from && showsView(ask, view),
    );

    // One already in a hidden column shows again.
    if (showing)
      return {
        motion: "live",
        ...(showing.key === state.askColumn && { columnHidden: false }),
      };

    const ask: AskPanel = {
      ...newAsk(nextAskKey++, view),
      ...(keepFocus && { unfocused: true }),
    };

    if (from !== undefined && from === state.askWindow) {
      // A working thread floats on, and what it asked for takes the column;
      // only one thread floats, so the column's leaves the screen.
      if (state.asks.find((candidate) => candidate.key === from)?.busy) {
        const rest =
          state.askColumn === null ? state : offScreen(state, state.askColumn);

        return {
          ...rest,
          active: null,
          asks: [...rest.asks, ask],
          askColumn: ask.key,
          columnHidden: false,
          motion: "live",
        };
      }

      const rest = offScreen(state, from);

      return { ...rest, asks: [...rest.asks, ask], askWindow: ask.key };
    }

    const occupied =
      !state.columnHidden &&
      (state.active !== null || state.askColumn !== null);

    const rest =
      replace && from !== undefined && from === state.askColumn
        ? offScreen(state, from)
        : vacateColumn(state);

    return {
      ...rest,
      asks: [...rest.asks, ask],
      askColumn: ask.key,
      columnHidden: false,
      // Switching what an open column shows is not a new panel.
      motion: occupied ? "restored" : "live",
    };
  };

  return createColumnStore((set) => ({
    active: null,
    asks,
    askColumn: open(restored?.askColumn),
    askWindow: open(restored?.askWindow),
    askAnchor: restored?.askAnchor ?? null,
    askSize: restored?.askSize ?? null,
    columnHidden: restored?.columnHidden ?? false,
    motion: "live",
    contentsRailHidden: false,
    contentsRequest: 0,
    view: initialView,
    availableViews,
    diffScope,
    diffReveal: null,
    traceSelection,
    traceStorage,
    lens,
    mapFocus: null,
    overlayTour: initialView === "review" ? overlayTour : null,
    suppressMotion: () => set({ motion: "restored" }),
    openPeek: (panel) =>
      set((state) => ({
        ...vacateColumn(state),
        active: panel,
        columnHidden: false,
        motion: "live",
      })),
    moveInlineTour: (anchor, { reveal }) =>
      set((state) => {
        const panel = state.active;
        const tour = panel?.tour;

        const stop = tour?.definition.stops.find(
          (item) => item.anchor.id === anchor,
        );

        if (!panel || !tour || !stop) return state;

        return {
          active: {
            ...panel,
            anchor: stop.anchor,
            content: stop.content,
            tour: {
              ...tour,
              revealRequest: tour.revealRequest + Number(reveal),
            },
          },
        };
      }),
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
    hideAsk: (key) => set((state) => offScreen(state, key)),
    popOutAsk: (key) =>
      set((state) =>
        key === state.askColumn
          ? { ...float(state, key), motion: "live" }
          : state,
      ),
    dockAsk: (key) =>
      set((state) => {
        if (key !== state.askWindow) return state;

        const rest = vacateColumn({ ...state, askWindow: null });

        return {
          ...rest,
          askWindow: rest.askWindow ?? null,
          askColumn: key,
          columnHidden: false,
          motion: "live",
        };
      }),
    placeAsk: (askAnchor, askSize) =>
      set(askSize ? { askAnchor, askSize } : { askAnchor }),
    toggleColumn: (fallback) =>
      set((state) =>
        state.active !== null || state.askColumn !== null
          ? { columnHidden: !state.columnHidden, motion: "live" }
          : { ...showAsk(state, fallback, {}), motion: "live" },
      ),
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
    // A lens reads the whole range, so a picked commit sets it aside.
    pickCommit: (scope) =>
      set(scope ? { diffScope: scope, lens: null } : { diffScope: null }),
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
    setContentsRailHidden: (contentsRailHidden) => set({ contentsRailHidden }),
    openContents: () =>
      set((state) => ({ contentsRequest: state.contentsRequest + 1 })),
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

/** Where the thread with this key shows now: a fullscreen diagram covers
 * the column until it closes. */
export function askShown(state: AskShownState, key: number): AskShown | null {
  if (key === state.askWindow) return "window";

  return key === state.askColumn && askColumnShown(state) ? "panel" : null;
}

/** Whether a thread fills the column. */
export function askColumnShown(state: AskShownState): boolean {
  return state.askColumn !== null && !state.overlayTour && !state.columnHidden;
}

/** Whether the column shows its peek. */
export function peekShown(state: ReviewPanelState): boolean {
  return state.active !== null && !state.columnHidden;
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

type AskPlacement = Pick<
  ReviewPanelState,
  "active" | "asks" | "askColumn" | "askWindow"
>;

/** Takes a thread off the screen; its agent runs on. */
function offScreen(state: AskPlacement, key: number): AskPlacement {
  return {
    active: state.active,
    asks: state.asks.filter((ask) => ask.key !== key),
    askColumn: state.askColumn === key ? null : state.askColumn,
    askWindow: state.askWindow === key ? null : state.askWindow,
  };
}

/** Floats a thread in the window; the one floating there leaves the
 * screen. */
function float(state: AskPlacement, key: number): AskPlacement {
  const previous = state.askWindow;
  const rest = previous === null ? state : offScreen(state, previous);

  return {
    ...rest,
    askColumn: rest.askColumn === key ? null : rest.askColumn,
    askWindow: key,
  };
}

/** The panel store. Every change to it keeps the column right of the board
 * to one thing at a time, whichever action opens a tour, a peek or a
 * thread: a tour opening takes the column from a peek or a thread, as one
 * of those opening takes it from the tour. */
const createColumnStore = (initializer: StateCreator<ReviewPanelStoreState>) =>
  createStore<ReviewPanelStoreState>()(oneInColumn(initializer));

function oneInColumn(
  initializer: StateCreator<ReviewPanelStoreState>,
): StateCreator<ReviewPanelStoreState> {
  return (setState, get, api) =>
    initializer(
      // SAFETY: the store's actions only merge partial states, never replace
      // the whole state, so the one form this takes is the form they call.
      ((update: SetUpdate) =>
        setState((state) => {
          const partial = update instanceof Function ? update(state) : update;

          return partial === state
            ? state
            : keepOne(state, { ...state, ...partial });
        })) as typeof setState,
      get,
      api,
    );
}

type SetUpdate =
  | Partial<ReviewPanelStoreState>
  | ((state: ReviewPanelStoreState) => Partial<ReviewPanelStoreState>);

function keepOne(
  previous: ReviewPanelStoreState,
  next: ReviewPanelStoreState,
): ReviewPanelStoreState {
  if (
    next.overlayTour !== null &&
    next.overlayTour.tourId !== previous.overlayTour?.tourId
  )
    return { ...next, ...vacateColumn(next) };

  // A fullscreen tour covers the column: a thread opened over it, new or
  // saved, floats instead, and the tour stays.
  if (
    next.overlayTour !== null &&
    next.askColumn !== null &&
    next.askColumn !== previous.askColumn
  )
    return { ...next, ...float(next, next.askColumn) };

  const taken =
    (next.active !== null && next.active !== previous.active) ||
    (next.askColumn !== null && next.askColumn !== previous.askColumn) ||
    (previous.columnHidden && !next.columnHidden);

  return next.overlayTour !== null && taken
    ? { ...next, overlayTour: null }
    : next;
}

/** Empties the column for what opens next: a peek closes, a working thread
 * floats, an idle one leaves the screen. */
function vacateColumn(state: AskPlacement): AskPlacement {
  const occupant = state.asks.find((ask) => ask.key === state.askColumn);
  const rest = { ...state, active: null };

  if (!occupant) return rest;

  return occupant.busy
    ? float(rest, occupant.key)
    : offScreen(rest, occupant.key);
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
    // A commit filter holds across views while there is a diff to filter.
    ...(!state.availableViews.includes("diff") && { diffScope: null }),
    ...(view !== "map" &&
      state.mapFocus?.pending && {
        mapFocus: { ...state.mapFocus, pending: false },
      }),
    ...(view !== "review" && state.overlayTour && { overlayTour: null }),
    ...(shouldCloseSidePeekForReviewView(view) &&
      state.active && { active: null, motion: "live" }),
  };
}
