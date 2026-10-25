import { segmentMarker } from "@canvas/markers.stylex";
import { motion, space } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

/**
 * The whiteboard marker stroke, drawn under a top bar surface; it is revealed
 * left to right with a clip. Its tab carries `segmentMarker`.
 */
export function MarkerUnderline({ active }: { active: boolean }): ReactElement {
  return (
    <svg
      {...stylex.props(styles.underline, active && styles.underlineActive)}
      viewBox="0 0 48 3"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        {...stylex.props(styles.underlineStroke)}
        d="M1 1.6 C 12 0.5, 30 2.5, 47 1.2"
      />
    </svg>
  );
}

const styles = stylex.create({
  // The marker is drawn, not painted: a clip slides open, so the pen's
  // progress is the same whatever the tab's width (a dash offset would not
  // be under non-scaling-stroke). Hover draws a lighter stroke; leaving fades
  // the ink and only then closes the clip, so the pen never runs backwards.
  underline: {
    position: "absolute",
    bottom: space.s6,
    left: 0,
    width: "100%",
    height: "3px",
    overflow: "visible",
    clipPath: {
      default: "inset(-2px 100% -2px 0)",
      [stylex.when.ancestor(":hover", segmentMarker)]: "inset(-2px 0 -2px 0)",
    },
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", segmentMarker)]: 0.7,
    },
    pointerEvents: "none",
    transition: {
      default: `opacity ${motion.fast} ${motion.ease}, clip-path ${motion.instant} linear ${motion.fast}`,
      [stylex.when.ancestor(":hover", segmentMarker)]:
        `opacity ${motion.instant}, clip-path ${motion.slow} ${motion.enter}`,
      [stylex.env.reducedMotion]: `opacity ${motion.fast} ${motion.ease}`,
    },
  },
  underlineActive: {
    clipPath: "inset(-2px 0 -2px 0)",
    opacity: {
      default: 1,
      [stylex.when.ancestor(":hover", segmentMarker)]: 0.7,
    },
    transition: {
      default: `opacity ${motion.instant}, clip-path ${motion.slow} ${motion.enter}`,
      [stylex.env.reducedMotion]: `opacity ${motion.fast} ${motion.ease}`,
    },
  },
  underlineStroke: {
    fill: "none",
    stroke: tokens.accent,
    strokeWidth: "2",
    strokeLinecap: "round",
    vectorEffect: "non-scaling-stroke",
  },
});
