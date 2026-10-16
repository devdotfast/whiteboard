import * as stylex from "@stylexjs/stylex";

// The contents rail floats over the board's scroller; its card opens in the
// top layer, over everything.
export const tocLayer = stylex.defineConsts({
  rail: "31",
});

export const tocRail = stylex.defineConsts({
  // Where the board's page drops to its narrowest padding: no room for the
  // rail, so it hides and the page bar's ⋯ offers the contents instead.
  hidden: "@container review-content (max-width: 720px)",
  // The page's right padding while the rail shows: the longest tick (14px),
  // its inset from the board's edge (14px), and a gap before the content.
  gutter: "40px",
});
