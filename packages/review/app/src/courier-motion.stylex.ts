import * as stylex from "@stylexjs/stylex";

// The courier's moves. courier.tsx times its hops, jumps and exits against
// these, so change them together.
export const courierMotion = stylex.defineConsts({
  hop: "260ms",
  squash: "340ms",
  arrive: "380ms",
  jump: "420ms",
  leave: "420ms",
  march: "480ms",
  bounce: "520ms",
  doze: "5s",
  ponder: "2.4s",
});
