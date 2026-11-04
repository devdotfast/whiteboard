import type { ActivitySurface } from "@dev.fast/whiteboard-document";
import {
  type Context,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AuthoringCursor } from "./authoring-cursor";
import { cursorContext } from "./courier";
import {
  type DrawState,
  EMPTY_QUEUE,
  type MotionPhase,
  arrive,
  nextDue,
  painted,
  phases,
  standingCursor,
  tick,
} from "./draw-queue";

/** Id for a callback a clock has scheduled; only ever passed back to that
 * same clock's `clearTimeout`. */
export type DrawQueueTimerHandle = number;

/** The time source that drives the queue: injectable so tests can advance
 * it by hand instead of racing the wall clock. */
export interface DrawQueueClock {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => DrawQueueTimerHandle;
  clearTimeout: (handle: DrawQueueTimerHandle) => void;
}

const defaultClock: DrawQueueClock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

/** One queue per surface: the document's blocks, the Diffs page's lens
 * rows. */
const MotionPhasesContexts: Record<
  ActivitySurface,
  Context<Map<string, MotionPhase>>
> = {
  document: createContext<Map<string, MotionPhase>>(new Map()),
  lenses: createContext<Map<string, MotionPhase>>(new Map()),
};

/** What a block may tell its queue about its own drawing. */
export interface DrawQueueControls {
  /** The block's stage finished painting it in. */
  painted: (id: string) => void;
}

const noControls: DrawQueueControls = { painted: () => {} };

const ControlsContexts: Record<ActivitySurface, Context<DrawQueueControls>> = {
  document: createContext<DrawQueueControls>(noControls),
  lenses: createContext<DrawQueueControls>(noControls),
};

/** The queue's controls; outside a queue (history) they do nothing. */
export function useDrawQueueControls(
  scope: ActivitySurface = "document",
): DrawQueueControls {
  return useContext(ControlsContexts[scope]);
}

/** Every element's phase, for a list that must keep an erased block around. */
export function useMotionPhases(
  scope: ActivitySurface = "document",
): Map<string, MotionPhase> {
  return useContext(MotionPhasesContexts[scope]);
}

/** The phase an element is being drawn in, for its `data-motion`. */
export function useMotionPhase(
  id: string | undefined,
  scope: ActivitySurface = "document",
): MotionPhase | undefined {
  const map = useContext(MotionPhasesContexts[scope]);

  return id === undefined ? undefined : map.get(id);
}

/**
 * Runs the draw queue on the stream's cursor moves and hands out two things:
 * the cursor the courier stands on (the head of the queue), and each
 * element's motion phase. Timers advance the queue; the pure model in
 * draw-queue.ts decides what happens. `undefined` is history: no queue.
 *
 * Every updater reads the clock before it is queued, never inside: React may
 * run a queued updater again later, and one that told the time itself would
 * then end a step early.
 */
export function DrawQueueProvider({
  cursor,
  scope = "document",
  clock = defaultClock,
  children,
}: {
  cursor: AuthoringCursor | null | undefined;
  /** Which courier this queue drives; each scope has its own contexts. */
  scope?: ActivitySurface;
  /** Defaults to `performance`/window timers; browser tests inject a
   * manual clock so phase transitions land on the test's schedule. */
  clock?: DrawQueueClock;
  children: ReactNode;
}) {
  const [state, setState] = useState<DrawState>(EMPTY_QUEUE);
  // The state as last rendered, for a control that must not queue an update
  // it knows changes nothing: a stale no-op update can be replayed over a
  // later arrival and lose it.
  const stateRef = useRef(state);
  stateRef.current = state;

  const [seen, setSeen] = useState<AuthoringCursor | null | undefined>(
    undefined,
  );

  // An arrival is folded in during this very render, so a block the same
  // version removed is already "erasing" when the document renders without it.
  if (cursor !== seen) {
    setSeen(cursor);

    if (!cursor) setState(EMPTY_QUEUE);
    else {
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const now = clock.now();
      setState((current) => arrive(current, cursor, now, reduced));
    }
  }

  useEffect(() => {
    const due = nextDue(state);

    if (due === null) return;

    // A timer can fire a hair before its due time; the step it was set for
    // is due regardless, or the queue would stall with no timer to follow.
    const timer = clock.setTimeout(
      () => {
        const now = Math.max(due, clock.now());
        setState((current) => tick(current, now));
      },
      Math.max(0, due - clock.now()),
    );

    return () => clock.clearTimeout(timer);
  }, [state, clock]);

  const onPainted = useCallback(
    (id: string) => {
      const now = clock.now();

      if (painted(stateRef.current, id, now) === stateRef.current) return;
      setState((current) => painted(current, id, now));
    },
    [clock],
  );

  const controls = useMemo(() => ({ painted: onPainted }), [onPainted]);
  const standing = standingCursor(state);
  const map = useMemo(() => phases(state), [state]);
  const CursorContext = cursorContext(scope);
  const PhasesContext = MotionPhasesContexts[scope];
  const ControlsContext = ControlsContexts[scope];

  return (
    <CursorContext.Provider value={cursor === undefined ? undefined : standing}>
      <ControlsContext.Provider value={controls}>
        <PhasesContext.Provider value={map}>{children}</PhasesContext.Provider>
      </ControlsContext.Provider>
    </CursorContext.Provider>
  );
}
