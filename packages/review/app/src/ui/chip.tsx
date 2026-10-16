import {
  fontSize,
  fontWeight,
  leading,
  radius,
  space,
  tracking,
} from "@canvas/scale.stylex";
import { type StyleArg, withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";

type ChipProps = Omit<ComponentProps<"span">, "className" | "style"> & {
  // A tag names a kind (DB, PK, a harness); a pill holds a short phrase.
  variant?: "tag" | "pill";
  // Large pills stand alone in a row; tags have one size.
  size?: "default" | "large";
  className?: string;
  xstyle?: StyleArg;
};

export function Chip({
  variant = "tag",
  size = "default",
  className,
  xstyle,
  ...props
}: ChipProps) {
  return (
    <span
      {...props}
      {...withClass(
        className,
        chipStyles[variant],
        size === "large" && chipStyles.large,
        xstyle,
      )}
    />
  );
}

// Exported for chips that are buttons. Sites set their own tone after these.
export const chipStyles = stylex.create({
  tag: {
    display: "inline-flex",
    flex: "0 0 auto",
    alignItems: "center",
    height: "18px",
    padding: `0 ${space.s4}`,
    borderRadius: radius.small,
    backgroundColor: tokens.well,
    color: tokens.inkMuted,
    fontSize: fontSize.micro,
    fontWeight: fontWeight.semibold,
    lineHeight: leading.none,
    letterSpacing: tracking.caps,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  pill: {
    display: "inline-flex",
    flex: "0 0 auto",
    alignItems: "center",
    gap: space.s6,
    height: "18px",
    padding: `0 ${space.s8}`,
    borderRadius: radius.pill,
    backgroundColor: tokens.well,
    color: tokens.inkMuted,
    fontSize: fontSize.small,
    lineHeight: leading.none,
    whiteSpace: "nowrap",
  },
  large: {
    height: "22px",
  },
});
