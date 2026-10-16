import { fontSize, fontWeight } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

// The header every diagram figure shares: a kind badge, the title and a quiet
// count, then its 24px controls (the tour Button, the use-case select).
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
    color: tokens.ink,
    fontSize: fontSize.body,
    fontStyle: "normal",
    fontWeight: fontWeight.semibold,
    lineHeight: "18px",
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
    font: `${fontWeight.regular} ${fontSize.small} ${tokens.fontMono}`,
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
});
