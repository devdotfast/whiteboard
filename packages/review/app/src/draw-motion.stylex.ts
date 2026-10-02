import * as stylex from "@stylexjs/stylex";

// The whiteboard's draw beats. draw-queue.ts times each phase to cover these,
// so change them together.
export const drawMotion = stylex.defineConsts({
  tick: "120ms",
  dotFade: "150ms",
  label: "160ms",
  beat: "200ms",
  // A diagram written whole, traced in one quick pass.
  quick: "220ms",
  ring: "250ms",
  collapse: "260ms",
  rowErase: "320ms",
  fill: "330ms",
  rowLand: "340ms",
  // One pass of the eraser.
  pass: "400ms",
  // A unit's outline, a wipe or a relabel.
  stroke: "420ms",
  line: "450ms",
  lensLand: "520ms",
  land: "680ms",
});
