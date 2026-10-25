import {
  fontSize,
  fontWeight,
  leading,
  radius,
  space,
} from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

// The header every diagram figure shares: a kind badge, the title and a quiet
// count, then its 24px controls (the tour Button, the use-case select).
// Clears the select's chevron.
const CHEVRON_CLEARANCE = "26px";

export const diagramStyles = stylex.create({
  handle: {
    width: "1px",
    height: "1px",
    minWidth: 0,
    minHeight: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    opacity: 0,
    pointerEvents: "none",
  },
  header: {
    position: "relative",
    top: "auto",
    left: "auto",
    zIndex: 6,
    display: "flex",
    alignItems: "center",
    gap: space.s10,
    minWidth: 0,
    minHeight: "36px",
    paddingBlock: 0,
    paddingRight: space.s12,
    paddingLeft: "calc(14px + var(--review-fullscreen-inset, 0px))",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    backgroundColor: tokens.surface,
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    letterSpacing: 0,
  },
  headerMain: {
    display: "inline-flex",
    flex: "1 1 auto",
    alignItems: "center",
    gap: space.s10,
    minWidth: 0,
  },
  title: {
    minWidth: 0,
    color: tokens.ink,
    fontSize: fontSize.body,
    fontStyle: "normal",
    fontWeight: fontWeight.semibold,
    lineHeight: leading.px18,
  },
  // A quiet count ("5 stops", "4 nodes"), not a chip.
  meta: {
    flex: "0 0 auto",
    marginLeft: "auto",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: 0,
    backgroundColor: tokens.transparent,
    color: tokens.inkMuted,
    font: `${fontWeight.regular} ${fontSize.small} ${tokens.chromeFont}`,
    fontStyle: "normal",
    letterSpacing: 0,
    textTransform: "none",
  },
  button: {
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    backgroundColor: {
      default: tokens.surface,
      ":hover:not(:disabled)": tokens.well,
    },
  },
  control: {
    flex: "0 0 auto",
    height: "24px",
    padding: `0 ${space.s10}`,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: tokens.ruleSoft, ":focus-visible": tokens.accent },
    borderRadius: radius.control,
    backgroundColor: { default: tokens.surface, ":hover": tokens.well },
    color: tokens.ink,
    font: `${fontWeight.medium} ${fontSize.small} ${tokens.chromeFont}`,
    lineHeight: leading.px22,
    cursor: "pointer",
    outline: { default: null, ":focus-visible": "none" },
  },
  select: {
    width: "100%",
    minWidth: 0,
    paddingRight: CHEVRON_CLEARANCE,
    overflow: "hidden",
    appearance: "none",
    backgroundImage: tokens.chevronDown,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 8px center",
    backgroundSize: "12px 12px",
    textOverflow: "ellipsis",
  },
});
