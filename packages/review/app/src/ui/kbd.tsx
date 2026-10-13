import { fontSize, fontWeight, radius, tracking } from "@canvas/scale.stylex";
import type { StyleArg } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";

type KbdProps = Omit<ComponentProps<"kbd">, "className" | "style"> & {
  xstyle?: StyleArg;
};

/** One key of a hotkey hint on the canvas. */
export function Kbd({ xstyle, ...props }: KbdProps) {
  return (
    <kbd {...props} {...stylex.props(styles.shortcut, styles.key, xstyle)} />
  );
}

export function Shortcut({ xstyle, ...props }: KbdProps) {
  return <kbd {...props} {...stylex.props(styles.shortcut, xstyle)} />;
}

const styles = stylex.create({
  shortcut: {
    fontFamily: tokens.fontSans,
    fontSize: fontSize.body,
    fontWeight: fontWeight.regular,
    lineHeight: "16px",
    letterSpacing: tracking.shortcut,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  key: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: "16px",
    height: "17px",
    padding: "0 4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: radius.small,
    backgroundColor: tokens.bg,
    color: tokens.ink,
  },
});
