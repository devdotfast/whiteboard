import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

// An in-page menu: a manual popover that useAnchoredPopover puts in the top
// layer under its trigger, so no clipping ancestor cuts it off. Pair with
// surfaceStyles.popover; sites set their own width.
export const menuStyles = stylex.create({
  popover: {
    position: "fixed",
    top: "calc(anchor(bottom) + 4px)",
    right: "auto",
    bottom: "auto",
    left: "anchor(left)",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    maxWidth: "calc(100vw - 16px)",
    maxHeight: "min(420px, calc(100vh - 16px))",
    margin: 0,
    padding: "4px",
    overflowY: "auto",
    overscrollBehavior: "contain",
    // Its trigger's row may not wrap; the menu does.
    whiteSpace: "normal",
    positionTryFallbacks: "flip-block, flip-inline",
    positionVisibility: "anchors-visible",
  },
  above: {
    top: "auto",
    bottom: "calc(anchor(top) + 4px)",
  },
  end: {
    right: "anchor(right)",
    left: "auto",
  },
  label: {
    padding: "6px 8px 4px",
  },
  item: {
    display: "flex",
    // A scrolling list must not squeeze its items.
    flex: "none",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    minHeight: "28px",
    padding: "5px 8px",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: radius.control,
    backgroundColor: {
      default: tokens.transparent,
      ":hover:not(:disabled)": tokens.tray,
      ":focus-visible": tokens.tray,
    },
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
    lineHeight: "16px",
    textAlign: "left",
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: null, ":disabled": 0.5 },
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "-1px" },
  },
  // Keyboard-highlighted in a list driven from a search field.
  itemHighlighted: {
    backgroundColor: tokens.tray,
  },
  itemCurrent: {
    fontWeight: fontWeight.semibold,
  },
  check: {
    flex: "none",
    marginLeft: "auto",
    color: tokens.accent,
  },
});
