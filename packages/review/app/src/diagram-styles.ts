import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

// The header every diagram figure shares: a kind badge, the title and a quiet
// count, then its 24px hairline controls (the tour button, the use-case
// select).
export const diagramStyles = stylex.create({
  header: {
    position: "relative",
    top: "auto",
    left: "auto",
    zIndex: 6,
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minWidth: 0,
    minHeight: "36px",
    padding: "0 12px 0 14px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    backgroundColor: tokens.surface,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    letterSpacing: 0,
  },
  headerMain: {
    display: "inline-flex",
    flex: "1 1 auto",
    alignItems: "center",
    gap: "10px",
    minWidth: 0,
  },
  title: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.ink,
    fontSize: fontSize.body,
    fontStyle: "normal",
    fontWeight: fontWeight.semibold,
    lineHeight: "18px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
    color: tokens.inkFaint,
    font: `400 11px ${tokens.fontMono}`,
    fontStyle: "normal",
    letterSpacing: 0,
    textTransform: "none",
  },
  control: {
    flex: "0 0 auto",
    height: "24px",
    padding: "0 10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: tokens.ruleSoft, ":focus-visible": tokens.accent },
    borderRadius: radius.control,
    backgroundColor: { default: tokens.surface, ":hover": tokens.well },
    color: tokens.ink,
    font: `500 11px ${tokens.fontMono}`,
    lineHeight: "22px",
    cursor: "pointer",
    outline: { default: null, ":focus-visible": "none" },
  },
  select: {
    width: "100%",
    minWidth: 0,
    paddingRight: "26px",
    overflow: "hidden",
    appearance: "none",
    backgroundImage: tokens.chevronDown,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 8px center",
    backgroundSize: "12px 12px",
    textOverflow: "ellipsis",
  },
});
