import * as stylex from "@stylexjs/stylex";

// The popover renders in the workbench document, outside the canvas theme, so
// it carries its own shadow rather than elevation's canvas variables.
export const workbenchShadow = stylex.defineConsts({
  widget: "0 3px 12px #0004",
});
