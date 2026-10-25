import { fontSize, leading, radius, space } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

// A row of a sidebar list: a board, a heading, a thread. Menus keep
// menuStyles.item and take `current` for the row on screen.
export const listRowStyles = stylex.create({
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.s10,
    width: "100%",
    height: "24px",
    paddingBlock: 0,
    paddingInline: space.s8,
    borderRadius: radius.small,
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: leading.px16,
    textAlign: "left",
    cursor: "pointer",
  },
  wash: {
    backgroundColor: {
      default: tokens.transparent,
      ":hover": tokens.markerTint,
    },
  },
  // The board, heading or thread on screen.
  current: {
    backgroundColor: tokens.markerTint,
  },
});
