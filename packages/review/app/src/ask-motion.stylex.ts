import * as stylex from "@stylexjs/stylex";

// Ask's own timing, where the motion scale has no step for it.
export const askMotion = stylex.defineConsts({
  // One turn of a tool's spinner: a scale step would read as stalled.
  spin: "0.8s",
});
