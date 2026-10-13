import { radius } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

const mixedBar = `linear-gradient(${tokens.onAccent}, ${tokens.onAccent})`;

// Native inputs use the pseudo-classes; ARIA checkboxes pass `checked` or `mixed`.
export const checkboxStyles = stylex.create({
  box: {
    flex: "none",
    boxSizing: "border-box",
    width: "14px",
    height: "14px",
    margin: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: tokens.ruleSoft,
      ":checked": tokens.accent,
      ":indeterminate": tokens.accent,
    },
    borderRadius: radius.small,
    backgroundColor: {
      default: tokens.surface,
      ":checked": tokens.accent,
      ":indeterminate": tokens.accent,
    },
    backgroundImage: {
      default: "none",
      ":checked": tokens.checkMark,
      ":indeterminate": mixedBar,
    },
    backgroundPosition: "center",
    backgroundSize: { default: "10px 10px", ":indeterminate": "8px 1.5px" },
    backgroundRepeat: "no-repeat",
    appearance: "none",
    cursor: "pointer",
  },
  checked: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
    backgroundImage: tokens.checkMark,
  },
  mixed: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
    backgroundImage: mixedBar,
    backgroundSize: "8px 1.5px",
  },
});
