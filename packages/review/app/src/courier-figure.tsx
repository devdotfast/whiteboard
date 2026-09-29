import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

/** What the board courier is doing, which his figure draws. */
export interface CourierPose {
  idle: "none" | "march" | "sit";
  jumping: boolean;
}

/**
 * The courier: the one character on the board. A marker-blue outline with
 * two dot eyes and two feet, the same figure at every size. Strokes take
 * `currentColor`; the shell is filled with the board so lines behind him
 * do not show through.
 */
export function CourierFigure({
  xstyle,
  pose,
  marching = false,
}: {
  xstyle?: stylex.StyleXStyles;
  /** The board courier's pose; the badge's mini courier has none. */
  pose?: CourierPose;
  /** The badge's mini courier marches while an agent works. */
  marching?: boolean;
}) {
  const board = pose !== undefined;
  const march = pose?.idle === "march";
  const sit = pose?.idle === "sit";

  return (
    <svg
      {...stylex.props(xstyle)}
      viewBox="0 0 28 34"
      aria-hidden="true"
      focusable="false"
    >
      <path
        {...stylex.props(styles.whoosh, march && styles.whooshMarching)}
        d="M-6 27h6M-9 31h5"
      />
      <path
        {...stylex.props(
          styles.line,
          board && styles.still,
          (march || marching) && styles.marchLeft,
          sit && styles.sitLeft,
        )}
        d="M9 24v7h-4"
      />
      <path
        {...stylex.props(
          styles.line,
          board && styles.still,
          (march || marching) && styles.marchRight,
          sit && styles.sitRight,
        )}
        d="M19 24v7h4"
      />
      <rect
        {...stylex.props(styles.shell)}
        x="4"
        y="8"
        width="20"
        height="16"
        rx="6"
      />
      <g {...stylex.props(board && styles.still, sit && styles.dozing)}>
        <circle {...stylex.props(styles.eye)} cx="11" cy="15" r="1.3" />
        <circle {...stylex.props(styles.eye)} cx="18" cy="15" r="1.3" />
        <path
          {...stylex.props(
            styles.line,
            styles.lids,
            board && styles.still,
            pose?.jumping && styles.happy,
          )}
          d="M8.5 15.5q2.5-3 5 0M15.5 15.5q2.5-3 5 0"
        />
      </g>
    </svg>
  );
}

const REDUCED = "@media (prefers-reduced-motion: reduce)";

const marchLeft = stylex.keyframes({
  "0%, 100%": { transform: "translateY(0)" },
  "50%": { transform: "translateY(-4px)" },
});

const marchRight = stylex.keyframes({
  "0%, 100%": { transform: "translateY(-4px)" },
  "50%": { transform: "translateY(0)" },
});

const doze = stylex.keyframes({
  "0%, 80%": { transform: "translateY(0)" },
  "81%, 100%": { transform: "translateY(1.5px)" },
});

const happy = stylex.keyframes({
  "0%, 10%": { opacity: 0 },
  "12%, 70%": { opacity: 1 },
  "72%, 100%": { opacity: 0 },
});

const styles = stylex.create({
  shell: {
    fill: tokens.surface,
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinejoin: "round",
  },
  eye: {
    fill: "currentColor",
  },
  // The legs and the eyelids.
  line: {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  lids: {
    strokeWidth: 1.4,
    opacity: 0,
  },
  whoosh: {
    stroke: "currentColor",
    strokeWidth: 1.2,
    strokeLinecap: "round",
    opacity: 0,
  },
  whooshMarching: {
    opacity: 0.5,
  },
  // On the board, reduced motion keeps him still.
  still: {
    transition: { default: null, [REDUCED]: "none" },
  },
  // Idle: march in place, then sit.
  marchLeft: {
    animationName: { default: marchLeft, [REDUCED]: "none" },
    animationDuration: { default: "480ms", [REDUCED]: "0s" },
    animationTimingFunction: { default: "ease-in-out", [REDUCED]: "ease" },
    animationIterationCount: { default: "infinite", [REDUCED]: 1 },
  },
  marchRight: {
    animationName: { default: marchRight, [REDUCED]: "none" },
    animationDuration: { default: "480ms", [REDUCED]: "0s" },
    animationTimingFunction: { default: "ease-in-out", [REDUCED]: "ease" },
    animationIterationCount: { default: "infinite", [REDUCED]: 1 },
  },
  // Sitting eases in, reduced motion included.
  sitLeft: {
    transform: "rotate(-80deg)",
    transformOrigin: "9px 24px",
    transition: "transform 300ms ease",
  },
  sitRight: {
    transform: "rotate(80deg)",
    transformOrigin: "19px 24px",
    transition: "transform 300ms ease",
  },
  dozing: {
    animationName: { default: doze, [REDUCED]: "none" },
    animationDuration: { default: "5s", [REDUCED]: "0s" },
    animationTimingFunction: { default: "steps(1)", [REDUCED]: "ease" },
    animationIterationCount: { default: "infinite", [REDUCED]: 1 },
  },
  // Happy eyes on a jump.
  happy: {
    animationName: { default: happy, [REDUCED]: "none" },
    animationDuration: { default: "520ms", [REDUCED]: "0s" },
    animationTimingFunction: { default: "steps(1)", [REDUCED]: "ease" },
    animationFillMode: { default: "forwards", [REDUCED]: "none" },
  },
});
