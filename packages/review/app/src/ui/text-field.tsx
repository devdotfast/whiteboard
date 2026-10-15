import { fontSize, radius } from "@canvas/scale.stylex";
import { type StyleArg, withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";

type Styled<Props> = Omit<Props, "className" | "style"> & {
  className?: string;
  xstyle?: StyleArg;
};

export function TextField({
  variant = "default",
  className,
  xstyle,
  ...props
}: Styled<ComponentProps<"input">> & { variant?: "default" | "form" }) {
  return (
    <input
      {...props}
      {...withClass(
        className,
        fieldStyles.box,
        variant === "form" && fieldStyles.form,
        xstyle,
      )}
    />
  );
}

export function TextArea({
  className,
  xstyle,
  ...props
}: Styled<ComponentProps<"textarea">>) {
  return (
    <textarea
      {...props}
      {...withClass(className, fieldStyles.box, fieldStyles.multiline, xstyle)}
    />
  );
}

// Exported for a shell around an input and its buttons or icon.
export const fieldStyles = stylex.create({
  box: {
    boxSizing: "border-box",
    minWidth: 0,
    height: "26px",
    padding: "0 8px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: tokens.rule, ":focus": tokens.accent },
    borderRadius: radius.small,
    backgroundColor: tokens.controlBg,
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    outline: "none",
    opacity: { default: null, ":disabled": 0.5 },
  },
  form: {
    height: "32px",
    padding: "0 10px",
    borderRadius: radius.control,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    lineHeight: 1.5,
    "::placeholder": { color: tokens.inkMuted, opacity: 1 },
  },
  // The input inside draws no box of its own.
  shell: {
    borderColor: { default: tokens.rule, ":focus-within": tokens.accent },
  },
  // An input or textarea inside a shell: no box, the shell's type.
  bare: {
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: tokens.transparent,
    color: tokens.ink,
    font: "inherit",
    // The shell shows the focus.
    outline: "none",
    "::placeholder": {
      color: tokens.inkFaint,
    },
  },
  multiline: {
    height: "auto",
    padding: "6px 8px",
    lineHeight: 1.5,
    resize: "vertical",
  },
});
