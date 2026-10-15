import { motion, radius } from "@canvas/scale.stylex";
import type { StyleArg } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

/** A small ring that turns while something loads. */
export function Spinner({ xstyle }: { xstyle?: StyleArg }) {
  return <span aria-hidden="true" {...stylex.props(styles.ring, xstyle)} />;
}

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });

const styles = stylex.create({
  ring: {
    display: "inline-block",
    flexShrink: 0,
    boxSizing: "border-box",
    width: "9px",
    height: "9px",
    borderWidth: "1.4px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderTopColor: tokens.accent,
    borderRadius: radius.round,
    animationName: { default: spin, [reducedMotion]: "none" },
    animationDuration: motion.spin,
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});
