import { motion } from "@canvas/scale.stylex";
import type { StyleArg } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import { iconStyles } from "@canvas/ui/icon-styles";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

/**
 * A ring that turns while something loads. It is decorative unless it has a
 * `label`; leave that off when a live region nearby already says it is busy.
 */
export function Spinner({
  size = "inline",
  tone = "current",
  label,
  xstyle,
}: {
  // Inline sits beside text like an icon; large fills a 20px status badge.
  size?: "inline" | "large";
  tone?: "current" | "accent";
  label?: string;
  xstyle?: StyleArg;
}): ReactElement {
  return (
    <svg
      {...(label
        ? { role: "status", "aria-label": label }
        : { "aria-hidden": true })}
      {...stylex.props(
        styles.ring,
        spinStyles.turning,
        size === "inline" ? [iconStyles.inline, styles.inline] : styles.large,
        tone === "accent" && styles.accent,
        xstyle,
      )}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <circle {...stylex.props(styles.track)} cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  );
}

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });

// The spinner's turn, for something else that turns while it works: a
// refresh icon in its button. Reduced motion holds it still.
export const spinStyles = stylex.create({
  turning: {
    animationName: { default: spin, [stylex.env.reducedMotion]: "none" },
    animationDuration: motion.spin,
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});

const styles = stylex.create({
  ring: {
    flexShrink: 0,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
  },
  track: {
    opacity: 0.25,
  },
  inline: {
    strokeWidth: "3px",
  },
  large: {
    width: "20px",
    height: "20px",
    strokeWidth: "2.4px",
  },
  accent: {
    color: tokens.accent,
  },
});
