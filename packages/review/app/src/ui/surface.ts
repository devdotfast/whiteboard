import { elevation, radius } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

// The box of anything that floats over the canvas. Sites keep their own
// placement, size and padding, applied after these.
export const surfaceStyles = stylex.create({
  popover: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: radius.surface,
    backgroundColor: tokens.surfaceRaised,
    boxShadow: elevation.popover,
    color: tokens.ink,
  },
  dialog: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: radius.surface,
    backgroundColor: tokens.surfaceRaised,
    boxShadow: elevation.dialog,
    color: tokens.ink,
  },
});
