import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import { type StyleArg, withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import { focusStyles } from "@canvas/ui/focus";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";

import { Spinner } from "./spinner";

type NativeButtonProps = Omit<ComponentProps<"button">, "className" | "style">;

type ButtonProps = NativeButtonProps & {
  loading?: boolean;
  variant?: "ghost" | "secondary" | "primary" | "warning";
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
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const filled = variant === "primary" || variant === "warning";

  return (
    <button
      type={type}
      {...props}
      disabled={disabled || loading}
      {...withClass(
        className,
        filled ? focusStyles.ring : focusStyles.ringInset,
        buttonStyles.reset,
        buttonStyles.base,
        buttonStyles[variant],
        size === "large" && buttonStyles.large,
        loading && buttonStyles.loading,
        xstyle,
      )}
    >
      {loading ? (
        <>
          <span {...stylex.props(buttonStyles.loadingLabel)}>{children}</span>
          <span {...stylex.props(buttonStyles.loadingIndicator)}>
            <Spinner xstyle={buttonStyles.loadingSpinner} />
          </span>
        </>
      ) : (
        children
      )}
    </button>
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
        focusStyles.ringInset,
        buttonStyles.reset,
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

// Exported for a button another component renders (an OptionMenu trigger),
// and `reset` for anything drawn without the native button box.
export const buttonStyles = stylex.create({
  reset: {
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: tokens.transparent,
  },
  base: {
    display: "inline-flex",
    flex: "0 0 auto",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    height: tokens.chromeControlHeight,
    padding: "0 10px",
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
  },
  // The one action a warning asks for, like allowing an agent's command.
  warning: {
    backgroundColor: tokens.changeModified,
    color: tokens.onWarning,
    filter: { default: null, ":hover:not(:disabled)": "brightness(1.1)" },
  },
  large: {
    height: "28px",
  },
  loading: {
    position: "relative",
    opacity: { default: null, ":disabled": 1 },
  },
  loadingLabel: { opacity: 0 },
  loadingIndicator: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  loadingSpinner: {
    width: "14px",
    height: "14px",
    borderTopColor: "currentcolor",
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
