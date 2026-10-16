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

// When each beat starts once its phase begins. A list delays each animation of
// a multi-part beat.
export const drawDelay = stylex.defineConsts({
  labelQuick: "60ms",
  labelFill: "90ms",
  labelEdgeQuick: "100ms",
  labelStep: "120ms",
  rowLand: "180ms",
  labelEdge: "300ms",
  dot: "260ms, 680ms",
  rewrite: "0s, 200ms, 600ms",
  erase: "0s, 0s, 400ms",
});
