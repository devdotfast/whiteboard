import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

// Controls shared across the canvas.
export const controlStyles = stylex.create({
  // The icon never takes the pointer from its button.
  inertIcon: {
    pointerEvents: "none",
  },
  // Icons in top bar chrome buttons.
  chromeIcon: {
    width: tokens.chromeIconSize,
    height: tokens.chromeIconSize,
  },
  // Icons beside a label, in a button or chip.
  inlineIcon: {
    width: "12px",
    height: "12px",
  },
});
