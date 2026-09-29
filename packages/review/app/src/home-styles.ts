import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

// Exclusive ranges: StyleX does not order overlapping queries.
const wide = "@container review-canvas (660px < width <= 980px)";

const narrow = "@container review-canvas (max-width: 660px)";

// The page shell Home, Welcome and Settings share.
export const homeStyles = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    color: tokens.ink,
    backgroundColor: tokens.reviewHomeBg,
    font: `12px/16px ${tokens.fontMono}`,
  },
  scroll: {
    flex: "1 1 auto",
    minHeight: 0,
    paddingTop: { default: "36px", [narrow]: "32px" },
    paddingInline: {
      default: "clamp(36px, calc(12.5cqw - 60px), 120px)",
      [wide]: "36px",
      [narrow]: "24px",
    },
    paddingBottom: "max(56px, var(--review-bottom-scroll-padding, 0px))",
    overflow: "auto",
    scrollbarGutter: "stable",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    width: "min(1200px, 100%)",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: { default: "flex-start", [narrow]: "center" },
    justifyContent: "space-between",
    gap: "32px",
  },
  heading: {
    margin: 0,
    color: tokens.ink,
    font: `600 32px/42px ${tokens.fontMono}`,
    letterSpacing: "-0.02em",
  },
});
