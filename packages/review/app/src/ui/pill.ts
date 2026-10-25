import { radius, space } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

// A rounded control that holds a short phrase: a picker's trigger, a step, a
// filter that is on. Sites set their own height and padding after these.
export const pillStyles = stylex.create({
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s6,
    borderRadius: radius.pill,
    fontFamily: tokens.chromeFont,
    whiteSpace: "nowrap",
  },
  neutral: {
    backgroundColor: tokens.tray,
    boxShadow: `inset 0 0 0 1px ${tokens.rule}`,
    color: tokens.ink,
  },
  // A pill that is one button washes while hovered.
  pressable: {
    backgroundColor: { default: tokens.tray, ":hover": tokens.markerTint },
    cursor: "pointer",
  },
  accent: {
    backgroundColor: tokens.accentWash,
    boxShadow: `inset 0 0 0 1px ${tokens.accentOutline}`,
    color: tokens.accent,
  },
  // A filter that is on.
  active: {
    backgroundColor: tokens.markerTint,
  },
});
