import { radius } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps, ReactElement } from "react";

type StatusDotProps = Omit<
  ComponentProps<"span">,
  "className" | "style" | "role" | "aria-label"
> & {
  label: string;
  /** Accent for news, warning for something that needs the reader. */
  tone?: "accent" | "warning";
  /** Small sits on a 10px mark, the default on a 14px icon. */
  size?: "default" | "small";
};

/** A dot on the corner of an icon, cut out of it by a ring of the tray.
 * The icon's slot is its containing block. */
export function StatusDot({
  label,
  tone = "accent",
  size = "default",
  ...props
}: StatusDotProps): ReactElement {
  return (
    <span
      role="img"
      aria-label={label}
      {...props}
      {...stylex.props(
        styles.dot,
        styles[tone],
        size === "small" && styles.small,
      )}
    />
  );
}

const styles = stylex.create({
  dot: {
    position: "absolute",
    top: "-3px",
    right: "-4px",
    width: "8px",
    height: "8px",
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: tokens.tray,
    borderRadius: radius.round,
  },
  small: {
    right: "-3px",
    width: "6px",
    height: "6px",
  },
  accent: { backgroundColor: tokens.accent },
  warning: { backgroundColor: tokens.changeModified },
});
