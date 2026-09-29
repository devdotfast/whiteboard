import * as stylex from "@stylexjs/stylex";

// The review document's prose sizes: a reading scale of its own, larger than
// the canvas's UI scale in scale.stylex.ts.
export const documentType = stylex.defineConsts({
  body: "17px",
  h3: "20px",
  h2: "26px",
  title: "32px",
  h1: "34px",
});
