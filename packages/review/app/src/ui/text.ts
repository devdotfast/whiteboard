import { fontSize, fontWeight, tracking } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

// Type roles shared by elements of every kind. Sites keep their own layout
// and font family, applied after these.
export const textStyles = stylex.create({
  // The uppercase micro label over a panel, group or figure.
  eyebrow: {
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    fontWeight: fontWeight.semibold,
    letterSpacing: tracking.caps,
    textTransform: "uppercase",
  },
  // A count that changes in place; its digits keep their width.
  count: {
    fontVariantNumeric: "tabular-nums",
  },
});
