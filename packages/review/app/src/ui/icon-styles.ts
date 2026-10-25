import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

// Icon sizes and behavior shared across the canvas. An icon is 15px unless it
// takes a size here; each size sets the stroke that draws about 1px lines on
// the 24 grid, so icons of every size read at one weight.
export const iconStyles = stylex.create({
  // The icon never takes the pointer from its button.
  inert: {
    pointerEvents: "none",
  },
  // Icons in top bar chrome buttons.
  chrome: {
    width: tokens.chromeIconSize,
    height: tokens.chromeIconSize,
    strokeWidth: "1.8px",
  },
  // Icons beside a label, in a button or chip, or in place of a text glyph.
  inline: {
    width: "12px",
    height: "12px",
    strokeWidth: "2.1px",
  },
  // In a line of text, centered on the x-height like the glyph it replaces.
  glyph: {
    verticalAlign: "middle",
  },
  // Points a chevron or arrow the other way.
  flip: {
    transform: "rotate(180deg)",
  },
});
