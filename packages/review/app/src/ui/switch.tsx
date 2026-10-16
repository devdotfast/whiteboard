import { motion, radius } from "@canvas/scale.stylex";
import { type StyleArg, withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import { focusStyles } from "@canvas/ui/focus";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";

const thumbOff = `radial-gradient(circle closest-side, ${tokens.inkFaint} 92%, transparent)`;

const thumbOn = `radial-gradient(circle closest-side, ${tokens.accent} 92%, transparent)`;

type SwitchProps = Omit<
  ComponentProps<"input">,
  "type" | "role" | "className" | "style"
> & {
  className?: string;
  xstyle?: StyleArg;
};

/** An on/off setting that applies at once: a checkbox drawn as a track. */
export function Switch({ className, xstyle, ...props }: SwitchProps) {
  return (
    <input
      type="checkbox"
      role="switch"
      {...props}
      {...withClass(className, focusStyles.ring, styles.track, xstyle)}
    />
  );
}

const styles = stylex.create({
  track: {
    flex: "none",
    boxSizing: "border-box",
    width: "38px",
    height: "22px",
    margin: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: tokens.ruleSoft, ":checked": tokens.accent },
    borderRadius: radius.pill,
    backgroundColor: {
      default: tokens.controlBg,
      ":checked": tokens.accentSoft,
    },
    backgroundImage: { default: thumbOff, ":checked": thumbOn },
    backgroundPosition: { default: "3px center", ":checked": "19px center" },
    backgroundSize: "14px 14px",
    backgroundRepeat: "no-repeat",
    appearance: "none",
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: null, ":disabled": 0.5 },
    transition: {
      default: `background-position ${motion.fast} ${motion.ease}`,
      [stylex.env.reducedMotion]: "none",
    },
  },
});
