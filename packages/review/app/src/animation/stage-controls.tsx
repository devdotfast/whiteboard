// The pieces under an animation's or clip's stage: icon buttons, the caption
// of the stop showing, and the strip of named stops.

import { fontSize, leading, space, tracking } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { IconButton } from "@canvas/ui/button";
import { textStyles } from "@canvas/ui/text";
import { useTooltip } from "@canvas/ui/tooltip";
import * as stylex from "@stylexjs/stylex";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
} from "react";

import type { FrameTimer, PlayerStop } from "./stage-player";

export function ControlButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  const tooltip = useTooltip(label, { quick: true });

  return (
    <IconButton
      ref={tooltip}
      aria-label={label}
      size="small"
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        {...stylex.props(styles.icon)}
      >
        {children}
      </svg>
    </IconButton>
  );
}

export const playIcon = <path d="M8.5 6.5v11l9-5.5z" />;

export const pauseIcon = <path d="M9 6.5v11M15 6.5v11" />;

/** The title and caption of the stop showing, read out as it changes. Every
 * stop's caption shares one cell, with only the current one visible, so the
 * row keeps the height of the longest and never moves as the reader steps.
 * A caption stops at three lines. */
export function StopCaption({
  stops,
  activeIndex,
}: {
  stops: readonly PlayerStop[];
  activeIndex: number;
}) {
  return (
    <div {...stylex.props(styles.caption)} aria-live="polite">
      {stops.map((stop, position) => {
        const current = position === activeIndex;

        return (
          <div
            key={stop.key}
            {...stylex.props(
              textStyles.clamp3,
              styles.captionText,
              !current && styles.captionHidden,
            )}
          >
            <strong data-review-copy-prose={current || undefined}>
              {stop.title}
            </strong>
            {stop.caption && (
              <span data-review-copy-prose={current || undefined}>
                {" "}
                {stop.caption}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The clock as custom properties: where the marker starts, how much of it
 * is left to draw, and how long that takes. Reduced motion ignores them. */
export const timerVars = (timer: FrameTimer) =>
  // SAFETY: React passes custom properties through to style.setProperty;
  // only its CSSProperties type leaves them out.
  ({
    "--frame-timer-fill": `${timer.fraction * 100}%`,
    "--frame-timer-rest": `${1 - timer.fraction}`,
    "--frame-timer-ms": `${timer.remaining}ms`,
  }) as CSSProperties;

/** The clock's state, a marker for tests. */
export const timerState = (timer: FrameTimer) =>
  timer.running ? "running" : "held";

/** A named step per stop, like a progress strip. While frames play, the
 * marker under the step showing is drawn along it as the frame's time runs,
 * over a wash of where it will end. The strip stays one row: narrower than
 * its steps, it scrolls sideways and keeps the step showing in view. */
export function StepStrip({
  label,
  items,
  activeIndex,
  timer,
  onPick,
  onKeyDown,
}: {
  label: string;
  items: { key: string; text: string }[];
  activeIndex: number;
  timer?: FrameTimer | null;
  onPick(position: number): void;
  onKeyDown(event: KeyboardEvent): void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  // Scroll the strip alone, not the page: a step off its edge comes in.
  useEffect(() => {
    const strip = stripRef.current;
    const step = strip?.children[activeIndex];

    if (!strip || !(step instanceof HTMLElement)) return;
    const left = step.offsetLeft - strip.offsetLeft;
    const right = left + step.offsetWidth;

    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth)
      strip.scrollLeft = right - strip.clientWidth;
  }, [activeIndex]);

  return (
    <div
      ref={stripRef}
      {...stylex.props(styles.steps)}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {items.map((item, position) => (
        <button
          key={item.key}
          type="button"
          aria-current={position === activeIndex ? "step" : undefined}
          onClick={() => onPick(position)}
          {...stylex.props(
            styles.step,
            position === activeIndex && styles.stepCurrent,
            position === activeIndex && timer && styles.stepTimed,
          )}
        >
          <span {...stylex.props(styles.stepIndex)}>{position + 1}</span>
          <span data-review-copy-prose>{item.text}</span>
          {position === activeIndex && timer && (
            <i
              aria-hidden="true"
              data-frame-timer={timerState(timer)}
              {...stylex.props(
                styles.timer,
                timer.running && styles.timerRunning,
              )}
              style={timerVars(timer)}
            />
          )}
        </button>
      ))}
    </div>
  );
}

// The marker drawn along the underline, from where the clock was read to its end.
const draw = stylex.keyframes({
  to: { width: "100%" },
});

const styles = stylex.create({
  icon: {
    width: "16px",
    height: "16px",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  caption: {
    display: "grid",
    flex: "1 1 auto",
    minWidth: 0,
    marginLeft: space.s6,
    paddingBlock: space.s8,
    color: tokens.inkMuted,
    lineHeight: leading.px18,
  },
  captionText: {
    gridArea: "1 / 1",
  },
  captionHidden: {
    visibility: "hidden",
  },
  steps: {
    display: "flex",
    overflowX: "auto",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
  },
  step: {
    position: "relative",
    display: "flex",
    flex: "1 1 0",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s4,
    minWidth: "fit-content",
    padding: `${space.s6} ${space.s10}`,
    borderStyle: "none",
    borderBottomWidth: "2px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.transparent,
    backgroundColor: tokens.transparent,
    color: tokens.inkMuted,
    font: `${fontSize.micro} ${tokens.fontMono}`,
    letterSpacing: tracking.chrome,
    textAlign: "center",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    cursor: "pointer",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: "-2px",
  },
  stepCurrent: {
    borderBottomColor: tokens.accent,
    color: tokens.ink,
  },
  // With a clock, the underline rests as a wash and the marker draws over it.
  stepTimed: {
    borderBottomColor: {
      default: tokens.accentStripe,
      [stylex.env.reducedMotion]: tokens.accent,
    },
  },
  // Sits on the step's own 2px underline, one height below the padding box.
  timer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    transform: "translateY(100%)",
    width: {
      default: tokens.frameTimerFill,
      [stylex.env.reducedMotion]: "100%",
    },
    height: "2px",
    backgroundColor: tokens.accent,
  },
  timerRunning: {
    animationName: { default: draw, [stylex.env.reducedMotion]: "none" },
    animationDuration: tokens.frameTimerMs,
    animationTimingFunction: "linear",
    animationFillMode: "forwards",
  },
  stepIndex: {
    color: "inherit",
  },
});
