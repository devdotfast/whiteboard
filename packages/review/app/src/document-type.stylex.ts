import * as stylex from "@stylexjs/stylex";

// The review document's prose sizes: a reading scale of its own, larger than
// the canvas's UI scale in scale.stylex.ts, with each heading's line height.
export const documentType = stylex.defineConsts({
  body: "17px",
  h3: "20px",
  h3Leading: "23px",
  h2: "26px",
  h2Leading: "32px",
  title: "32px",
  titleLeading: "38px",
  h1: "34px",
  h1Leading: "40px",
});
