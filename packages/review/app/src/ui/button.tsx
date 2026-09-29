import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import { type StyleArg, withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";

type NativeButtonProps = Omit<ComponentProps<"button">, "className" | "style">;

type ButtonProps = NativeButtonProps & {
  variant?: "ghost" | "secondary" | "primary";
  // Large is for canvas and dialog actions; default matches the chrome.
  size?: "default" | "large";
  /** A plain class that code, tests or global.css look up. */
  className?: string;
  /** Call-site styles, applied last; a StyleX marker may ride along. */
  xstyle?: StyleArg;
};

type IconButtonProps = NativeButtonProps & {
  "aria-label": string;
  size?: "small" | "default" | "large";
  className?: string;
  xstyle?: StyleArg;
};

export function Button({
  variant = "secondary",
  size = "default",
  className,
  xstyle,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      {...props}
      {...withClass(
        className,
        buttonStyles.base,
        buttonStyles[variant],
        size === "large" && buttonStyles.large,
        xstyle,
      )}
    />
  );
}

export function IconButton({
  size = "default",
  className,
  xstyle,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      {...props}
      {...withClass(
        className,
        buttonStyles.base,
        buttonStyles.icon,
        size === "small" && buttonStyles.iconSmall,
        size === "large" && buttonStyles.iconLarge,
        xstyle,
      )}
    />
  );
}

// Only popup triggers: disclosure toggles also carry aria-expanded.
const expanded = ':is([aria-haspopup][aria-expanded="true"])';

// Exported only for a button another component renders (an OptionMenu trigger).
export const buttonStyles = stylex.create({
  base: {
    display: "inline-flex",
    flex: "0 0 auto",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    height: tokens.chromeControlHeight,
    padding: "0 10px",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: radius.control,
    // A trigger whose menu or popover is showing stays held down.
    backgroundColor: {
      default: tokens.transparent,
      ":hover:not(:disabled)": tokens.chromeHoverBg,
      [expanded]: tokens.chromeHoverBg,
    },
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    lineHeight: 1,
    whiteSpace: "nowrap",
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: null, ":disabled": 0.5 },
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "-1px" },
  },
  ghost: {
    color: {
      default: tokens.chromeFgMuted,
      ":hover:not(:disabled)": tokens.chromeFg,
      [expanded]: tokens.chromeFg,
    },
  },
  secondary: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    color: tokens.chromeFg,
  },
  primary: {
    backgroundColor: tokens.accent,
    color: tokens.onAccent,
    filter: { default: null, ":hover:not(:disabled)": "brightness(1.1)" },
    outlineOffset: { default: null, ":focus-visible": "1px" },
  },
  large: {
    height: "28px",
  },
  icon: {
    width: tokens.chromeControlHeight,
    padding: 0,
    color: {
      default: tokens.chromeIconFg,
      ":hover:not(:disabled)": tokens.chromeFg,
      ":focus-visible": tokens.chromeFg,
      [expanded]: tokens.chromeFg,
    },
  },
  iconSmall: {
    width: "20px",
    height: "20px",
    borderRadius: radius.small,
  },
  iconLarge: {
    width: "30px",
    height: "30px",
  },
});
