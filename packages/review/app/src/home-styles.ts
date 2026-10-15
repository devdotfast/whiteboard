import { documentType } from "@canvas/document-type.stylex";
import {
  fontSize,
  fontWeight,
  leading,
  space,
  tracking,
} from "@canvas/scale.stylex";
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
    backgroundColor: tokens.bg,
    font: `${fontSize.body}/${leading.px16} ${tokens.chromeFont}`,
  },
  scroll: {
    flex: "1 1 auto",
    minHeight: 0,
    paddingTop: { default: space.s36, [narrow]: space.s32 },
    paddingInline: {
      default: "clamp(36px, calc(12.5cqw - 60px), 120px)",
      [wide]: space.s36,
      [narrow]: space.s24,
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
    gap: space.s32,
  },
  heading: {
    margin: 0,
    color: tokens.ink,
    font: `${fontWeight.semibold} ${documentType.title}/${documentType.titleLeading} ${tokens.chromeFont}`,
    letterSpacing: tracking.tight,
  },
});
