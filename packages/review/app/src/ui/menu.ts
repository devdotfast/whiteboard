import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { KeyboardEvent } from "react";

const steps = ["ArrowDown", "ArrowUp", "Home", "End"];

/** Arrow, Home and End move focus among a menu's enabled items. */
export function moveMenuFocus(
  event: KeyboardEvent<HTMLElement>,
  items = '[role^="menuitem"]',
) {
  if (!steps.includes(event.key)) return;
  event.preventDefault();

  const enabled = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      `:is(${items}):not(:disabled)`,
    ),
  ];

  const current = enabled.findIndex((item) => item === document.activeElement);
  const last = enabled.length - 1;

  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : event.key === "ArrowDown"
          ? current === last
            ? 0
            : current + 1
          : current <= 0
            ? last
            : current - 1;

  enabled[index]?.focus();
}

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
