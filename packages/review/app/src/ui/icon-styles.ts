import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

// Icon sizes and behavior shared across the canvas.
export const iconStyles = stylex.create({
  // The icon never takes the pointer from its button.
  inert: {
    pointerEvents: "none",
  },
  // Icons in top bar chrome buttons.
  chrome: {
    width: tokens.chromeIconSize,
    height: tokens.chromeIconSize,
  },
  // Icons beside a label, in a button or chip.
  inline: {
    width: "12px",
    height: "12px",
  },
});
