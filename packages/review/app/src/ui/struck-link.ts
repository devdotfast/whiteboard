import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

export const struckLinkStyles = stylex.create({
  struck: {
    color: tokens.inkFaint,
    textDecoration: "line-through",
    cursor: "default",
  },
});
