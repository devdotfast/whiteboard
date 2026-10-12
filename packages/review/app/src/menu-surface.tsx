import * as stylex from "@stylexjs/stylex";
import type { ComponentPropsWithRef } from "react";

import { elevation, fontSize, layer, motion, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

const enter = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-4px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

/** Shared menu surface; callers own placement and their menu's contents. */
export function MenuSurface({
  xstyle,
  onClose,
  onKeyDown,
  ...props
}: ComponentPropsWithRef<"div"> & {
  xstyle?: stylex.StyleXStyles;
  onClose?(): void;
}) {
  return (
    <div
      {...props}
      {...stylex.props(menuSurfaceStyles.surface, xstyle)}
      onKeyDown={(event) => {
        onKeyDown?.(event);

        if (event.defaultPrevented || props.role !== "menu") return;

        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose?.();

          return;
        }

        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();

        const items = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            '[role^="menuitem"]:not(:disabled):not([aria-disabled="true"])',
          ),
        ];

        const current = items.findIndex(
          (item) => item === document.activeElement,
        );

        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowDown"
                ? (current + 1) % items.length
                : current < 0
                  ? items.length - 1
                  : (current + items.length - 1) % items.length;

        items[index]?.focus();
      }}
    />
  );
}

export const menuSurfaceStyles = stylex.create({
  surface: {
    zIndex: layer.popover,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    padding: "6px",
    maxWidth: "calc(100vw - 24px)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.homeChipBorder,
    borderRadius: radius.panel,
    backgroundColor: tokens.homePicker,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    boxShadow: elevation.popover,
    animationName: {
      default: enter,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: motion.medium,
    animationTimingFunction: "ease-out",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    textAlign: "left",
    padding: "9px 12px",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: radius.small,
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.tray,
      ":focus-visible": tokens.tray,
    },
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    cursor: "pointer",
    textDecoration: "none",
  },
});
