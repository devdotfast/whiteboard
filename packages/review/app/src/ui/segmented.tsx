import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import { type StyleArg, withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps, ReactNode } from "react";

type SegmentedControlProps<T extends string> = Omit<
  ComponentProps<"div">,
  "onChange" | "className" | "style" | "aria-label"
> & {
  label: string;
  value: T | undefined;
  options: readonly { value: T; label: ReactNode }[];
  onChange(value: T): void;
  // Large segments stand in prose (the welcome and tutorial pages).
  size?: "default" | "large";
  disabled?: boolean;
  className?: string;
  xstyle?: StyleArg;
};

/** Pick one of a few; `children` follow the segments inside the track. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "default",
  disabled = false,
  className,
  xstyle,
  children,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      {...props}
      {...withClass(className, segmentStyles.segmented, xstyle)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled}
          {...stylex.props(
            segmentStyles.segment,
            size === "large" && segmentStyles.segmentLarge,
            option.value === value && segmentStyles.segmentActive,
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
      {children}
    </div>
  );
}

/** Options from a label map, in its key order. */
export function labeledOptions<T extends string>(labels: Record<T, ReactNode>) {
  // SAFETY: `labels` is declared as Record<T, ReactNode>, so its own keys are
  // exactly the T values.
  return (Object.keys(labels) as T[]).map((value) => ({
    value,
    label: labels[value],
  }));
}

// Exported for segments another component renders: the top bar's view tabs
// and the connect card's "Other…" menu trigger.
export const segmentStyles = stylex.create({
  // Segmented choice controls: a tray-colored track, the chosen side raised
  // on a hairline. One part for every "pick one of a few" setting. The
  // surface tabs on the left of the top bar are the exception: words on the
  // tray with the marker under the current one.
  segmented: {
    display: "flex",
    flex: "0 0 auto",
    alignItems: "center",
    gap: 0,
    padding: "2px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.control,
    backgroundColor: tokens.tray,
  },
  segmentedTopbar: {
    gap: "18px",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: 0,
    backgroundColor: tokens.transparent,
  },
  segment: {
    display: "inline-flex",
    alignItems: "center",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: tokens.transparent,
    fontFamily: tokens.chromeFont,
    whiteSpace: "nowrap",
    position: "relative",
    gap: "6px",
    height: "20px",
    padding: "0 10px",
    borderRadius: radius.small,
    color: { default: tokens.inkMuted, ":hover": tokens.ink },
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
    opacity: { default: null, ":disabled": 0.5 },
    cursor: { default: null, ":disabled": "default" },
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "-1px" },
  },
  // Segments set in prose (the welcome and tutorial pages) grow a step.
  segmentLarge: {
    height: "26px",
    padding: "0 12px",
    fontSize: fontSize.ui,
  },
  segmentTopbar: {
    height: tokens.reviewHeaderHeight,
    padding: 0,
    borderRadius: { default: 0, ":focus-visible": radius.small },
    fontSize: fontSize.body,
    fontWeight: fontWeight.regular,
  },
  segmentActive: {
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.ruleSoft}`,
    color: tokens.ink,
    fontWeight: fontWeight.semibold,
  },
  segmentTopbarActive: {
    backgroundColor: tokens.transparent,
    boxShadow: "none",
  },
  segmentCount: {
    flex: "0 0 auto",
    fontVariantNumeric: "tabular-nums",
    color: tokens.inkFaint,
    fontSize: fontSize.body,
    fontWeight: fontWeight.regular,
  },
  segmentCountActive: {
    color: tokens.accent,
  },
});
