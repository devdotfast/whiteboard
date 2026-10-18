import { elevation, fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

import { segmentStyles } from "./segmented";

/** A native, draggable range with five equally sized, numbered stops. */
export function RatingScale({
  id,
  value,
  onChange,
  disabled,
  describedBy,
}: {
  id: string;
  value: number | undefined;
  onChange(value: number): void;
  disabled: boolean;
  describedBy: string;
}) {
  return (
    <div {...stylex.props(segmentStyles.segmented, styles.track)}>
      <div aria-hidden="true" {...stylex.props(styles.stops)}>
        {[1, 2, 3, 4, 5].map((stop) => (
          <span
            key={stop}
            {...stylex.props(
              segmentStyles.segment,
              styles.stop,
              value === stop && segmentStyles.segmentActive,
              value === stop && styles.selected,
            )}
          >
            {stop}
          </span>
        ))}
      </div>
      <input
        id={id}
        name="rating"
        type="range"
        min={1}
        max={5}
        step={1}
        value={value ?? 3}
        disabled={disabled}
        aria-valuetext={value === undefined ? "Not rated" : `${value} out of 5`}
        aria-describedby={describedBy}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(event) => {
          if (event.button !== 0) return;
          const { left, width } = event.currentTarget.getBoundingClientRect();
          // Commit the stop under the released pointer, even if Chromium
          // coalesces the last native input event during a fast drag.
          onChange(
            Math.max(
              1,
              Math.min(5, Math.floor(((event.clientX - left) / width) * 5) + 1),
            ),
          );
        }}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            onChange(Number(event.currentTarget.value));
          }
        }}
        {...stylex.props(styles.input)}
      />
    </div>
  );
}

const styles = stylex.create({
  track: {
    position: "relative",
    outline: {
      default: null,
      ":focus-within": `1px solid ${tokens.accent}`,
    },
    outlineOffset: "3px",
  },
  stops: { display: "flex", flex: 1, minWidth: 0, pointerEvents: "none" },
  stop: {
    flex: "1 1 0",
    minWidth: 0,
    justifyContent: "center",
    height: "32px",
    padding: 0,
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
    fontVariantNumeric: "tabular-nums",
  },
  selected: {
    color: tokens.accent,
    boxShadow: `${elevation.raised}, 0 0 0 1px ${tokens.ruleSoft}`,
  },
  input: {
    position: "absolute",
    inset: "2px",
    width: "calc(100% - 4px)",
    height: "32px",
    margin: 0,
    padding: 0,
    opacity: 0,
    appearance: "none",
    borderRadius: radius.small,
    cursor: { default: "grab", ":active": "grabbing", ":disabled": "default" },
    // Matching the thumb to one cell puts its five centers at 10–90%.
    "::-webkit-slider-thumb": {
      appearance: "none",
      width: "20%",
      height: "32px",
    },
    "::-moz-range-thumb": { width: "20%", height: "32px", borderWidth: 0 },
  },
});
