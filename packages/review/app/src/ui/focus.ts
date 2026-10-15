import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

// The keyboard focus ring. Sites apply one before their own styles.
export const focusStyles = stylex.create({
  ring: {
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "1px" },
  },
  // Inside the edge, for controls flush with a neighbor or a clipping scroller.
  ringInset: {
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "-1px" },
  },
});
