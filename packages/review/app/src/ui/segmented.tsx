import { segmentMarker } from "@canvas/markers.stylex";
import { fontSize, fontWeight, radius, space } from "@canvas/scale.stylex";
import { type StyleArg, withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import { buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { MarkerUnderline } from "@canvas/ui/marker-underline";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps, ReactNode } from "react";

type SegmentedControlProps<T extends string> = Omit<
  ComponentProps<"div">,
  "onChange" | "className" | "style" | "aria-label"
> & {
  label: string;
  value: T | undefined;
  options: readonly SegmentOption<T>[];
  onChange(value: T): void;
  // Large segments stand in prose (the welcome page).
  size?: "default" | "large";
  // The top bar's view tabs: words on the tray, a marker under the chosen.
  variant?: "default" | "topbar";
  disabled?: boolean;
  className?: string;
  xstyle?: StyleArg;
};

type SegmentOption<T extends string> = {
  value: T;
  label: ReactNode;
  // A tally after the label, like a tab's file count.
  count?: number;
  "aria-label"?: string;
  title?: string;
};

/** Pick one of a few; `children` follow the segments inside the track. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "default",
  variant = "default",
  disabled = false,
  className,
  xstyle,
  children,
  ...props
}: SegmentedControlProps<T>) {
  const topbar = variant === "topbar";

  return (
    <div
      role="group"
      aria-label={label}
      {...props}
      {...withClass(
        className,
        segmentStyles.segmented,
        topbar && segmentStyles.segmentedTopbar,
        xstyle,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option["aria-label"]}
            title={option.title}
            disabled={disabled}
            {...stylex.props(
              topbar && segmentMarker,
              focusStyles.ringInset,
              buttonStyles.reset,
              segmentStyles.segment,
              size === "large" && segmentStyles.segmentLarge,
              topbar && segmentStyles.segmentTopbar,
              active && segmentStyles.segmentActive,
              active && topbar && segmentStyles.segmentTopbarActive,
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.count === undefined ? null : (
              <span
                {...stylex.props(
                  segmentStyles.segmentCount,
                  active && segmentStyles.segmentCountActive,
                )}
              >
                {option.count}
              </span>
            )}
            {topbar ? <MarkerUnderline active={active} /> : null}
          </button>
        );
      })}
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

// Exported for a segment another component renders: the connect card's
// "Other…" menu trigger.
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
    padding: space.s2,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.control,
    backgroundColor: tokens.tray,
  },
  segmentedTopbar: {
    gap: space.s18,
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
    fontFamily: tokens.chromeFont,
    whiteSpace: "nowrap",
    position: "relative",
    gap: space.s6,
    height: "20px",
    padding: `0 ${space.s10}`,
    borderRadius: radius.small,
    color: { default: tokens.inkMuted, ":hover": tokens.ink },
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
    opacity: { default: null, ":disabled": 0.5 },
    cursor: { default: null, ":disabled": "default" },
  },
  // Segments set in prose (the welcome page) grow a step.
  segmentLarge: {
    height: "26px",
    padding: `0 ${space.s12}`,
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
