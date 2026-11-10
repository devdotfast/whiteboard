// The player under a diagram: play, pause or replay, a track split into its
// chapters or frames, their names, and the current one's caption. A timeline
// (`TimelineControls`) has a thumb at the playhead and the time, and its stage
// owns the clock; frames (`FrameControls`) step, and each frame's clock is
// drawn along its segment.

import {
  elevation,
  fontSize,
  leading,
  motion,
  radius,
  space,
  tracking,
} from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { Button, IconButton, buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  PauseIcon,
  PlayIcon,
  ReplayIcon,
} from "@canvas/ui/icons";
import { Kbd } from "@canvas/ui/kbd";
import { textStyles } from "@canvas/ui/text";
import { useTooltip } from "@canvas/ui/tooltip";
import * as stylex from "@stylexjs/stylex";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";

import {
  StopCaption,
  playerIconStyles,
  timerState,
  timerVars,
} from "./stage-controls";
import type { FrameTimer, PlayerStop } from "./stage-player";

// The largest stop, the one showing, across; the line's ends sit under the
// centers of stops this wide. Matches `dotCurrent` and `line`.
const STOP = 12;

// Pressed this soon after a frame starts, Left goes to the frame before it
// rather than back to the start of this one.
const BACK_GRACE = 500;

/**
 * Where Left (-1) or Right (1) takes the playhead from `time`: the start of
 * the next frame, or of this frame unless it has only just begun. Past the
 * last frame, Right goes to the end.
 */
export function stepFrame(
  starts: readonly number[],
  time: number,
  duration: number,
  direction: -1 | 1,
) {
  if (direction === 1) return starts.find((start) => start > time) ?? duration;

  return starts.findLast((start) => start < time - BACK_GRACE) ?? 0;
}

/** A chapter of the timeline, with where it starts. */
export interface TimelineChapter extends PlayerStop {
  at: number;
}

/**
 * Space plays and pauses from anywhere in the player; Left and Right snap
 * to the previous and next chapter, Home and End jump to the ends. Dragging
 * the track scrubs, pausing while the pointer is down and carrying on
 * afterwards if it was playing.
 */
export function TimelineControls({
  chapters,
  duration,
  at,
  playing,
  activeIndex,
  onToggle,
  onScrub,
  onPick,
}: {
  chapters: readonly TimelineChapter[];
  duration: number;
  at: number;
  playing: boolean;
  activeIndex: number;
  onToggle(): void;
  /** Move the playhead to this many milliseconds. */
  onScrub(at: number): void;
  /** Jump to the start of the chapter at this position. */
  onPick(position: number): void;
}) {
  const segments = useRef<(HTMLDivElement | null)[]>([]);
  const resume = useRef(false);
  // While dragging, the thumb follows the pointer rather than waiting for
  // the stage to report back.
  const [dragAt, setDragAt] = useState<number | null>(null);
  const time = dragAt ?? at;
  const ended = !playing && dragAt === null && duration > 0 && at >= duration;

  const lengths = chapters.map(
    (chapter, index) => (chapters[index + 1]?.at ?? duration) - chapter.at,
  );

  const starts = chapters.map((chapter) => chapter.at);
  const clamp = (value: number) => Math.min(Math.max(value, 0), duration);

  // A pointer's x on the track, as a time: the chapter under it, and how far
  // into that chapter. The gap between two chapters splits down the middle.
  const timeAt = (x: number) => {
    for (const [index, chapter] of chapters.entries()) {
      const rect = segments.current[index]?.getBoundingClientRect();
      const next = segments.current[index + 1]?.getBoundingClientRect();

      if (rect && (!next || x < (rect.right + next.left) / 2)) {
        const share = rect.width
          ? Math.min(Math.max((x - rect.left) / rect.width, 0), 1)
          : 0;

        return chapter.at + share * lengths[index]!;
      }
    }

    return duration;
  };

  const drag = (x: number) => {
    const next = clamp(timeAt(x));
    setDragAt(next);
    onScrub(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resume.current = playing;

    if (playing) onToggle();
    drag(event.clientX);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragAt !== null) drag(event.clientX);
  };

  const onPointerUp = () => {
    if (dragAt === null) return;

    if (resume.current && dragAt < duration) onToggle();
    resume.current = false;
    setDragAt(null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const next = {
      ArrowLeft: stepFrame(starts, time, duration, -1),
      ArrowRight: stepFrame(starts, time, duration, 1),
      Home: 0,
      End: duration,
    }[event.key];

    if (next === undefined) return;
    event.preventDefault();
    onScrub(clamp(next));
  };

  const chapter = chapters[activeIndex];
  const scrubbing = dragAt !== null;

  return (
    <Player
      stops={chapters}
      activeIndex={activeIndex}
      playing={playing}
      ended={ended}
      grow={lengths}
      onToggle={onToggle}
      onPick={onPick}
      onKeyDown={onKeyDown}
      readout={
        <span {...stylex.props(styles.time, scrubbing && styles.timeScrubbing)}>
          {clock(time, !ended && time > 0)}{" "}
          <span {...stylex.props(styles.total)}>/ {clock(duration)}</span>
        </span>
      }
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={`${clock(time, true)} of ${clock(duration)}${chapter ? `, ${chapter.title}` : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        {...stylex.props(focusStyles.ring, styles.track)}
      >
        {chapters.map((item, index) => {
          const length = lengths[index]!;

          // A chapter with no length is done once the time reaches it.
          const share = length
            ? Math.min(Math.max((time - item.at) / length, 0), 1)
            : Number(time >= item.at);

          return (
            <div
              key={item.key}
              ref={(element) => {
                segments.current[index] = element;
              }}
              {...stylex.props(styles.segment)}
              style={{ flexGrow: length }}
            >
              <span
                {...stylex.props(styles.fill)}
                style={{ width: `${share * 100}%` }}
              />
              {index === activeIndex && !ended && (
                <span
                  {...stylex.props(
                    styles.thumb,
                    scrubbing && styles.thumbScrubbing,
                  )}
                  style={{ left: `${share * 100}%` }}
                />
              )}
            </div>
          );
        })}
      </div>
    </Player>
  );
}

/**
 * The same player for frames, which step rather than scrub. Frames are stops
 * on a line rather than stretches of it: the first stop is the start and the
 * last is the end, however it was reached. The line fills up to the stop
 * showing, and on toward the next one as the frame's clock runs. Left and
 * Right go to the previous and next stop, Home and End to the first and last,
 * and a press on the line goes to the stop nearest it.
 */
export function FrameControls({
  frames,
  activeIndex,
  playing,
  timer,
  onToggle,
  onPick,
  onReplay,
}: {
  frames: readonly PlayerStop[];
  activeIndex: number;
  playing: boolean;
  timer: FrameTimer | null;
  onToggle(): void;
  /** Go to the frame at this position. */
  onPick(position: number): void;
  /** Play the frame showing again, when it has motion of its own. */
  onReplay?(): void;
}) {
  const last = frames.length - 1;
  const ended = !playing && activeIndex >= last;
  const frame = frames[activeIndex];

  // The stop nearest a pointer's x on the line, which runs edge to edge.
  const frameAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const share = rect.width ? (event.clientX - rect.left) / rect.width : 0;

    return Math.min(Math.max(Math.round(share * last), 0), last);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const next = {
      ArrowLeft: activeIndex - 1,
      ArrowRight: activeIndex + 1,
      Home: 0,
      End: last,
    }[event.key];

    if (next === undefined) return;
    event.preventDefault();

    if (next >= 0 && next <= last && next !== activeIndex) onPick(next);
  };

  return (
    <Player
      stops={frames}
      activeIndex={activeIndex}
      playing={playing}
      ended={ended}
      centered
      onToggle={onToggle}
      onPick={onPick}
      onKeyDown={onKeyDown}
      readout={
        <span {...stylex.props(styles.time)}>
          {/* Figure spaces keep "5 / 11" as wide as "10 / 11", so the
              step names beside it never shift. */}
          {String(activeIndex + 1).padStart(
            String(frames.length).length,
            "\u2007",
          )}{" "}
          <span {...stylex.props(styles.total)}>/ {frames.length}</span>
        </span>
      }
      action={
        onReplay && (
          <Button variant="secondary" xstyle={styles.replay} onClick={onReplay}>
            <ReplayIcon xstyle={playerIconStyles.inline} />
            Replay step
          </Button>
        )
      }
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label="Frame"
        aria-valuemin={1}
        aria-valuemax={frames.length}
        aria-valuenow={activeIndex + 1}
        aria-valuetext={`${activeIndex + 1} of ${frames.length}${frame ? `, ${frame.title}` : ""}`}
        onPointerDown={(event) => {
          const index = frameAt(event);

          if (index !== activeIndex) onPick(index);
        }}
        {...stylex.props(focusStyles.ring, styles.track, styles.stations)}
      >
        {/* The line spans the track, as the timeline's does, from the first
            stop's center to the last's. */}
        <div {...stylex.props(styles.line)}>
          {frames.slice(0, last).map((item, index) => (
            <div key={item.key} {...stylex.props(styles.stretch)}>
              {index < activeIndex && (
                <span {...stylex.props(styles.fill, styles.fillWhole)} />
              )}
              {index === activeIndex && timer && (
                <span
                  data-frame-timer={timerState(timer)}
                  {...stylex.props(
                    styles.fill,
                    styles.fillTimer,
                    timer.running && styles.fillRunning,
                  )}
                  style={timerVars(timer)}
                />
              )}
            </div>
          ))}
        </div>
        {frames.map((item, index) => (
          <span
            key={item.key}
            {...stylex.props(
              styles.dot,
              index < activeIndex && styles.dotPassed,
              index === activeIndex && styles.dotCurrent,
              index === activeIndex && ended && styles.dotEnded,
            )}
            // Inset by half the largest stop, so the end stops sit inside
            // the track, edge to edge with it, as the names under them do.
            style={{
              left: `calc(${STOP / 2}px + (100% - ${STOP}px) * ${last ? index / last : 0})`,
            }}
          />
        ))}
      </div>
    </Player>
  );
}

/** What both players share: the toggle, the track (`children`) with the
 * names under it, a readout at the end, and the caption with its keys. */
function Player({
  stops,
  activeIndex,
  playing,
  ended,
  grow,
  centered = false,
  readout,
  action,
  onToggle,
  onPick,
  onKeyDown,
  children,
}: {
  stops: readonly PlayerStop[];
  activeIndex: number;
  playing: boolean;
  ended: boolean;
  /** Each name's share of the row, matching its segment; even if left out. */
  grow?: readonly number[];
  /** Names under stops spread edge to edge, rather than starting their
   * segments. */
  centered?: boolean;
  readout?: ReactNode;
  /** Something to do with the stop showing, beside its caption. */
  action?: ReactNode;
  onToggle(): void;
  onPick(position: number): void;
  onKeyDown(event: KeyboardEvent): void;
  children: ReactNode;
}) {
  const label = playing ? "Pause" : ended ? "Replay" : "Play";
  const tooltip = useTooltip(label, { quick: true });
  const Glyph = playing ? PauseIcon : ended ? ReplayIcon : PlayIcon;
  // Names under stops show only when every one fits whole; otherwise the
  // first and last cut off and the rest run into each other.
  const [crowded, setCrowded] = useState(false);
  const titles = stops.map((stop) => stop.title).join("\n");

  const measureNames = useCallback(
    (row: HTMLDivElement | null) => {
      if (!row || !centered || typeof ResizeObserver === "undefined") return;

      const observer = new ResizeObserver(() =>
        setCrowded(
          [...row.children].some((name) => name.scrollWidth > name.clientWidth),
        ),
      );

      observer.observe(row);

      return () => observer.disconnect();
    },
    // Measure again when the names change.
    [centered, titles],
  );

  return (
    // Keys from any control in the player play, pause and move.
    <div
      {...stylex.props(styles.player)}
      onKeyDown={(event) => {
        // Space on a button presses it; everywhere else it plays and pauses.
        if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
          event.preventDefault();
          onToggle();
        } else onKeyDown(event);
      }}
    >
      <div {...stylex.props(styles.row)}>
        <IconButton
          ref={tooltip}
          aria-label={label}
          onClick={onToggle}
          xstyle={styles.toggle}
        >
          <Glyph xstyle={playerIconStyles.control} />
        </IconButton>
        <div {...stylex.props(styles.trackArea)}>
          {children}
          <div
            ref={measureNames}
            {...stylex.props(
              styles.chapters,
              centered && styles.flush,
              centered && crowded && styles.crowded,
            )}
          >
            {stops.map((item, index) => (
              <StopName
                key={item.key}
                stop={item}
                current={index === activeIndex}
                onPick={() => onPick(index)}
                // Under stops, the first and last names take half a share
                // and sit flush with the ends; the rest center on theirs.
                grow={
                  grow?.[index] ??
                  (centered && (index === 0 || index === stops.length - 1)
                    ? 0.5
                    : 1)
                }
                align={
                  !centered
                    ? undefined
                    : index === 0
                      ? "start"
                      : index === stops.length - 1
                        ? "end"
                        : "center"
                }
              />
            ))}
          </div>
        </div>
        {readout}
      </div>
      <div {...stylex.props(styles.captionRow)}>
        <StopCaption stops={stops} activeIndex={activeIndex} look="reading" />
        {action}
        {!ended && (
          // The keys the player answers to; the controls name what they do.
          <span aria-hidden="true" {...stylex.props(styles.hint)}>
            <Kbd>Space</Kbd>
            <Kbd>
              <ArrowLeftIcon xstyle={styles.keyIcon} />
            </Kbd>
            <Kbd>
              <ArrowRightIcon xstyle={styles.keyIcon} />
            </Kbd>
          </span>
        )}
      </div>
    </div>
  );
}

/** A stop's name under the track, which goes to it; its caption shows on
 * hover. */
function StopName({
  stop,
  current,
  grow,
  align,
  onPick,
}: {
  stop: PlayerStop;
  current: boolean;
  /** Its share of the row. */
  grow: number;
  /** Where it sits under its stop, for names under stops. */
  align?: "start" | "center" | "end";
  onPick(): void;
}) {
  const tooltip = useTooltip(stop.caption ?? "", { quick: true });

  return (
    <button
      ref={stop.caption ? tooltip : undefined}
      type="button"
      aria-current={current ? "step" : undefined}
      data-stop-label=""
      onClick={onPick}
      style={{ flexGrow: grow }}
      {...stylex.props(
        buttonStyles.reset,
        focusStyles.ring,
        textStyles.truncate,
        styles.chapter,
        align === "start" && styles.chapterStart,
        align === "center" && styles.chapterCentered,
        align === "end" && styles.chapterEnd,
        current && styles.chapterCurrent,
      )}
    >
      {stop.title}
    </button>
  );
}

/** 2400 → "0:02.4" with tenths, "0:02" without. */
function clock(ms: number, tenths = false) {
  const seconds = Math.max(ms, 0) / 1000;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;

  const shown = tenths
    ? (Math.floor(rest * 10) / 10).toFixed(1).padStart(4, "0")
    : String(Math.round(rest)).padStart(2, "0");

  return `${minutes}:${shown}`;
}

// A frame's clock drawn along its segment, from where it was read to its end.
const draw = stylex.keyframes({
  to: { width: "100%" },
});

const styles = stylex.create({
  player: {
    display: "grid",
    fontFamily: tokens.chromeFont,
    gap: space.s12,
    padding: `${space.s12} ${space.s14} ${space.s14}`,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.s12,
  },
  // A round button with a hairline, the player's one solid control.
  toggle: {
    width: "32px",
    height: "32px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.pill,
    backgroundColor: {
      default: tokens.surface,
      ":hover": tokens.chromeHoverBg,
    },
    color: tokens.ink,
  },
  trackArea: {
    flex: "1 1 auto",
    minWidth: 0,
    display: "grid",
    gap: space.s6,
    paddingTop: space.s8,
  },
  track: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    height: "16px",
    borderRadius: radius.control,
    cursor: "pointer",
    touchAction: "none",
  },
  segment: {
    position: "relative",
    flexBasis: 0,
    height: "4px",
    borderRadius: radius.hairline,
    backgroundColor: tokens.rule,
  },
  stations: {
    position: "relative",
  },
  line: {
    position: "absolute",
    top: "50%",
    left: space.s6,
    right: space.s6,
    display: "flex",
    height: "2px",
    transform: "translateY(-50%)",
    pointerEvents: "none",
  },
  stretch: {
    position: "relative",
    flex: "1 1 0",
    backgroundColor: tokens.rule,
  },
  // A stop ahead: an open ring.
  dot: {
    position: "absolute",
    top: "50%",
    width: "8px",
    height: "8px",
    boxSizing: "border-box",
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: radius.round,
    backgroundColor: tokens.surface,
    transform: "translate(-50%, -50%)",
  },
  dotPassed: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
  },
  // The stop showing: a larger ring, solid once the last one is reached.
  dotCurrent: {
    width: "12px",
    height: "12px",
    borderWidth: "2px",
    borderColor: tokens.accent,
  },
  dotEnded: {
    backgroundColor: tokens.accent,
  },
  fill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.hairline,
    backgroundColor: tokens.accent,
  },
  fillWhole: {
    width: "100%",
  },
  fillTimer: {
    width: {
      default: tokens.frameTimerFill,
      [stylex.env.reducedMotion]: "100%",
    },
  },
  fillRunning: {
    animationName: { default: draw, [stylex.env.reducedMotion]: "none" },
    animationDuration: tokens.frameTimerMs,
    animationTimingFunction: "linear",
    animationFillMode: "forwards",
  },
  thumb: {
    position: "absolute",
    top: "50%",
    width: "12px",
    height: "12px",
    boxSizing: "border-box",
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: tokens.accent,
    borderRadius: radius.round,
    backgroundColor: tokens.surface,
    boxShadow: elevation.raised,
    transform: "translate(-50%, -50%)",
    transitionProperty: "width, height, box-shadow",
    transitionDuration: {
      default: motion.fast,
      [stylex.env.reducedMotion]: motion.instant,
    },
  },
  thumbScrubbing: {
    width: "16px",
    height: "16px",
    borderWidth: 0,
    backgroundColor: tokens.accent,
  },
  chapters: {
    display: {
      default: "flex",
      [stylex.env.narrow]: "none",
    },
    gap: space.s2,
  },
  chapter: {
    flexBasis: 0,
    minWidth: 0,
    padding: 0,
    borderRadius: radius.small,
    // The diagram's own voice: its tag and its nodes' kinds are mono caps.
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    letterSpacing: tracking.caps,
    lineHeight: leading.px14,
    textAlign: "left",
    textTransform: "uppercase",
    color: {
      default: tokens.inkMuted,
      ":hover": tokens.ink,
    },
    cursor: "pointer",
  },
  // Names under stops keep a gap inside their share, so neighbours never
  // touch; the first and last stay flush with the ends.
  chapterStart: {
    paddingRight: space.s4,
  },
  chapterCentered: {
    paddingInline: space.s2,
    textAlign: "center",
  },
  chapterEnd: {
    paddingLeft: space.s4,
    textAlign: "right",
  },
  // Names under stops share the row exactly, so each centers on its stop.
  flush: {
    gap: 0,
  },
  // Kept laid out, so the names can be measured as the row widens again.
  crowded: {
    height: 0,
    overflow: "hidden",
    visibility: "hidden",
  },
  chapterCurrent: {
    color: tokens.ink,
  },
  time: {
    flex: "none",
    paddingTop: space.s8,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: leading.px16,
    fontVariantNumeric: "tabular-nums",
    color: tokens.inkMuted,
  },
  // A pill beside the caption, so the round button is the only bare ↻.
  replay: {
    flex: "none",
    height: "24px",
    paddingInline: `${space.s8} ${space.s10}`,
    borderRadius: radius.pill,
    color: {
      default: tokens.inkMuted,
      ":hover": tokens.ink,
    },
  },
  timeScrubbing: {
    color: tokens.ink,
  },
  total: {
    color: tokens.inkFaint,
  },
  captionRow: {
    display: "flex",
    alignItems: "center",
    gap: space.s16,
    paddingTop: space.s12,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
  },
  hint: {
    display: {
      default: "inline-flex",
      [stylex.env.narrow]: "none",
    },
    flex: "none",
    alignItems: "center",
    gap: space.s4,
  },
  keyIcon: {
    width: "10px",
    height: "10px",
  },
});
