import * as stylex from "@stylexjs/stylex";

// The review document's prose sizes: a reading scale of its own, larger than
// the canvas's UI scale in scale.stylex.ts, with each heading's line height.
// Scaled by --document-scale, which the article sets.
export const documentType = stylex.defineConsts({
  small: "calc(13px * var(--document-scale, 1))",
  reading: "calc(15px * var(--document-scale, 1))",
  body: "calc(17px * var(--document-scale, 1))",
  h3: "calc(20px * var(--document-scale, 1))",
  h3Leading: "calc(23px * var(--document-scale, 1))",
  h3EditorLeading: "calc(28px * var(--document-scale, 1))",
  bodyEditorLeading: "calc(26px * var(--document-scale, 1))",
  h2: "calc(26px * var(--document-scale, 1))",
  h2Leading: "calc(32px * var(--document-scale, 1))",
  title: "calc(32px * var(--document-scale, 1))",
  titleLeading: "calc(36px * var(--document-scale, 1))",
  h1: "calc(34px * var(--document-scale, 1))",
  h1Leading: "calc(40px * var(--document-scale, 1))",
});

export const codeType = stylex.defineConsts({
  size: "var(--review-code-font-size, 13px)",
  leading: "calc(var(--review-code-font-size, 13px) * 20 / 13)",
  ligatures: "var(--review-code-ligatures, normal)",
});
