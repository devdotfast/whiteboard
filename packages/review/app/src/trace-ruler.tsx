import { fontSize, fontWeight, motion, radius } from "@canvas/scale.stylex";
import { surfaceStyles } from "@canvas/ui/surface";
import type { ReviewAgentTraceEvent } from "@dev.fast/review-protocol";
import { extractTraceEventText } from "@dev.fast/trace-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import {
  type IndexedTraceTurnGroup,
  buildIndexedTraceTurns,
} from "./trace-document";
import { findScrollContainer } from "./trace-scroll-anchor";

/**
 * Turn-ruler scrollbar for the agent trace view. A left-edge column of
 * uniform dashes maps the whole session at even pitch: one tick per turn
 * (a user prompt, its collapsed work, and the final response — the same
 * grouping the trace view renders via buildIndexedTraceTurns), bucketed only
 * when turns outnumber the rail. Brightness marks the turns currently in the
 * viewport. Hovering bulges nearby ticks toward the content and previews the
 * turn's prompt plus its final response; clicking a tick jumps to the turn.
 * There is no proportional thumb.
 */

export const RULER_TICK_PITCH = 11;

export const RULER_PAD = 10;

const RULER_TICK_WIDTH = 6;

const RULER_HOVER_WIDTH = 30;

const RULER_COMB_REACH = 4;

export function rulerTickCount(height: number, eventCount: number): number {
  if (eventCount <= 0) return 0;
  const fit = Math.floor((height - RULER_PAD * 2) / RULER_TICK_PITCH);

  return Math.max(0, Math.min(eventCount, fit));
}

/** Half-open event range [start, end) represented by one tick. */
export interface RulerBucketRange {
  start: number;
  end: number;
}

export function rulerBucketRange(
  tick: number,
  tickCount: number,
  eventCount: number,
): RulerBucketRange {
  const start = Math.floor((tick * eventCount) / tickCount);

  const end = Math.max(
    start + 1,
    Math.floor(((tick + 1) * eventCount) / tickCount),
  );

  return { start, end: Math.min(end, eventCount) };
}

/** Comb widths: the hovered tick is longest, neighbors taper back to rest. */
export function rulerCombWidth(tick: number, hoverTick: number | null): number {
  if (hoverTick === null) return RULER_TICK_WIDTH;
  const distance = Math.abs(tick - hoverTick);

  if (distance > RULER_COMB_REACH) return RULER_TICK_WIDTH;
  const falloff = (RULER_COMB_REACH - distance) / RULER_COMB_REACH;

  return Math.round(
    RULER_TICK_WIDTH + (RULER_HOVER_WIDTH - RULER_TICK_WIDTH) * falloff ** 1.6,
  );
}

/**
 * Index of the tick whose rendered center is nearest the pointer. Hit-testing
 * against the real tick rects keeps hover exact regardless of layout.
 */
export function rulerNearestTick(
  rects: readonly { top: number; bottom: number }[],
  clientY: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  rects.forEach((rect, index) => {
    const distance = Math.abs((rect.top + rect.bottom) / 2 - clientY);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });

  return best;
}

/** First event index of each turn; the last entry's span runs to eventCount. */
export function rulerTurnStarts(
  turns: readonly IndexedTraceTurnGroup[],
): number[] {
  return turns.map(
    (turn) =>
      turn.user?.index ?? turn.work[0]?.index ?? turn.final[0]?.index ?? 0,
  );
}

/** The turn whose span contains an event index (binary search over starts). */
export function rulerTurnForEvent(
  index: number,
  starts: readonly number[],
): number {
  let lo = 0;
  let hi = starts.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;

    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }

  return lo;
}

/**
 * Preview for one turn, mirroring what the trace view shows for it: the user
 * prompt as the title and the final agent response (the trailing assistant
 * text after the collapsed work) as the snippet.
 */
export function rulerPreview(
  turn: IndexedTraceTurnGroup | undefined,
): { title: string; snippet: string } | null {
  if (!turn?.user) return null;
  const title = collapseWhitespace(extractTraceEventText(turn.user.event));

  if (!title) return null;
  let snippet = "";

  for (const item of turn.final) {
    snippet = collapseWhitespace(extractTraceEventText(item.event));

    if (snippet) break;
  }

  return { title, snippet };
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function TraceRuler({
  events,
  onSelectEvent,
}: {
  events: readonly ReviewAgentTraceEvent[];
  onSelectEvent?: (index: number) => void;
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const [rect, setRect] = useState<{
    top: number;
    left: number;
    height: number;
  } | null>(null);

  const railHeight = rect?.height ?? 0;

  const [visibleRange, setVisibleRange] = useState<{
    lo: number;
    hi: number;
  } | null>(null);

  const [hoverTick, setHoverTick] = useState<number | null>(null);

  const eventCount = events.length;
  const turns = useMemo(() => buildIndexedTraceTurns([...events]), [events]);
  const turnStarts = useMemo(() => rulerTurnStarts(turns), [turns]);
  const turnCount = turns.length;
  const tickCount = rulerTickCount(railHeight, turnCount);

  const measureVisible = useCallback(() => {
    const container = containerRef.current;

    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;

    const wrappers =
      container.querySelectorAll<HTMLElement>("[data-trace-event]");

    for (const wrapper of wrappers) {
      const index = Number(wrapper.dataset.traceEvent);

      if (!Number.isFinite(index)) continue;
      const rect = wrapper.getBoundingClientRect();

      if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
        lo = Math.min(lo, index);
        hi = Math.max(hi, index);
      }
    }

    setVisibleRange(lo <= hi ? { lo, hi } : null);
  }, []);

  useEffect(() => {
    const anchor = anchorRef.current;

    if (!anchor) return;
    const container = findScrollContainer(anchor);
    containerRef.current = container;

    if (!container) return;

    const measureHeight = () => {
      const bounds = container.getBoundingClientRect();
      setRect({
        top: bounds.top,
        left: bounds.left,
        height: container.clientHeight,
      });
    };

    measureHeight();
    measureVisible();

    const onScroll = () => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        measureVisible();
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measureHeight);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            measureHeight();
            measureVisible();
          })
        : null;

    resizeObserver?.observe(container);

    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measureHeight);
      resizeObserver?.disconnect();

      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [measureVisible, eventCount]);

  const tickTop = useCallback(
    (tick: number) => RULER_PAD + tick * RULER_TICK_PITCH,
    [],
  );

  const tickFromPointer = useCallback((clientY: number) => {
    const rail = railRef.current;

    if (!rail) return null;

    const rects = [
      ...rail.querySelectorAll<HTMLElement>(".review-trace-ruler-tick"),
    ].map((tick) => tick.getBoundingClientRect());

    return rulerNearestTick(rects, clientY);
  }, []);

  const jumpToTick = useCallback(
    (tick: number) => {
      const container = containerRef.current;

      if (!container || tickCount === 0) return;
      const { start: turn } = rulerBucketRange(tick, tickCount, turnCount);
      const start = turnStarts[turn] ?? 0;
      onSelectEvent?.(start);

      const wrappers = container
        .querySelectorAll<HTMLElement>("[data-trace-event]")
        .values()
        .map((wrapper) => ({
          wrapper,
          index: Number(wrapper.dataset.traceEvent),
        }))
        .filter((entry) => Number.isFinite(entry.index))
        .toArray()
        .sort((left, right) => left.index - right.index);

      const target =
        wrappers.find((entry) => entry.index >= start) ?? wrappers.at(-1);

      // jsdom has no scrollIntoView, so the call stays optional.
      if (target?.wrapper.scrollIntoView) {
        target.wrapper.scrollIntoView({ block: "start", behavior: "auto" });

        return;
      }

      container.scrollTop =
        (start / Math.max(1, eventCount)) *
        (container.scrollHeight - container.clientHeight);
    },
    [tickCount, turnCount, turnStarts, eventCount, onSelectEvent],
  );

  const preview = useMemo(() => {
    if (hoverTick === null || tickCount === 0) return null;
    const { start } = rulerBucketRange(hoverTick, tickCount, turnCount);

    return rulerPreview(turns[start]);
  }, [hoverTick, tickCount, turnCount, turns]);

  if (eventCount === 0 || turnCount === 0) return null;

  // Visible events map onto the turns that contain them.
  const visibleTurns =
    visibleRange === null
      ? null
      : {
          lo: rulerTurnForEvent(visibleRange.lo, turnStarts),
          hi: rulerTurnForEvent(visibleRange.hi, turnStarts),
        };

  const ticks: ReactNode[] = [];

  for (let tick = 0; tick < tickCount; tick += 1) {
    const { start, end } = rulerBucketRange(tick, tickCount, turnCount);

    const isVisible =
      visibleTurns !== null &&
      start <= visibleTurns.hi &&
      end > visibleTurns.lo;

    const width = rulerCombWidth(tick, hoverTick);

    ticks.push(
      <div
        key={tick}
        // The class is how pointer hit-testing finds the ticks.
        {...withClass(
          "review-trace-ruler-tick",
          styles.tick,
          // While the comb is active only the hover treatment shows; the
          // viewport run returns when the pointer leaves.
          isVisible && hoverTick === null && styles.tickVisible,
          tick === hoverTick && styles.tickHovered,
        )}
        style={{ top: tickTop(tick), width }}
      />,
    );
  }

  const cardTop =
    hoverTick !== null
      ? Math.max(RULER_PAD, Math.min(tickTop(hoverTick) - 24, railHeight - 140))
      : 0;

  return (
    <div ref={anchorRef} {...stylex.props(styles.ruler)} aria-hidden="true">
      <div
        ref={railRef}
        {...stylex.props(styles.rail)}
        style={{
          height: railHeight,
          top: rect?.top ?? 0,
          left: (rect?.left ?? 0) + 6,
        }}
        onMouseMove={(event) => setHoverTick(tickFromPointer(event.clientY))}
        onMouseLeave={() => setHoverTick(null)}
        onClick={(event) => {
          const tick = tickFromPointer(event.clientY);

          if (tick !== null) jumpToTick(tick);
        }}
      >
        {ticks}
        {preview && hoverTick !== null && (
          <div
            {...stylex.props(surfaceStyles.popover, styles.card)}
            style={{ top: cardTop }}
          >
            <span {...stylex.props(styles.cardTitle)}>{preview.title}</span>
            {preview.snippet && (
              <span {...stylex.props(styles.cardSnippet)}>
                {preview.snippet}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// A left-edge column of uniform dashes mapping the whole session at even
// pitch. Brightness marks the events currently in the viewport; hovering
// bulges nearby ticks toward the content and shows a preview card. Strictly
// grayscale via the ink tokens.
const styles = stylex.create({
  ruler: {
    height: 0,
    overflow: "visible",
  },
  rail: {
    position: "fixed",
    width: "40px",
    zIndex: 3,
  },
  tick: {
    position: "absolute",
    // Inset from the panel edge; the comb grows rightward from here.
    left: "8px",
    height: "2px",
    borderRadius: radius.hairline,
    backgroundColor: tokens.inkFaint,
    opacity: 0.55,
    transition: `width ${motion.fast} ${motion.ease}, opacity ${motion.fast} ${motion.ease}`,
    pointerEvents: "none",
  },
  tickVisible: {
    backgroundColor: tokens.ink,
    opacity: 0.9,
  },
  tickHovered: {
    backgroundColor: tokens.ink,
    opacity: 1,
  },
  card: {
    position: "absolute",
    left: "52px",
    width: "300px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "12px 14px",
    pointerEvents: "none",
  },
  cardTitle: {
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "19px",
    fontWeight: fontWeight.semibold,
    color: tokens.ink,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  cardSnippet: {
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.ui,
    lineHeight: "18px",
    color: tokens.inkMuted,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
});
