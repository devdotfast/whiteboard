import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

// A hairline between groups of controls in a row. Sites keep their own
// spacing.
export const dividerStyles = stylex.create({
  vertical: {
    flex: "none",
    width: "1px",
    height: "16px",
    backgroundColor: tokens.ruleSoft,
  },
});
