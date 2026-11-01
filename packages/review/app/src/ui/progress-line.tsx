import { motion, radius } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

/** A thin track filled to `value` (0 to 1), with a tick at each of `ticks`.
 * It only shows progress: nothing on it is interactive. */
export function ProgressLine({
  value,
  ticks = [],
}: {
  value: number;
  ticks?: readonly number[];
}) {
  const clamp = (fraction: number) => Math.max(0, Math.min(1, fraction));

  return (
    <div aria-hidden="true" {...stylex.props(styles.track)}>
      <div
        {...stylex.props(styles.fill)}
        style={{ transform: `scaleX(${clamp(value)})` }}
      />
      {ticks.map((tick, index) => (
        <span
          key={index}
          {...stylex.props(
            styles.tick,
            clamp(tick) <= clamp(value) && styles.tickPassed,
          )}
          style={{ left: `${clamp(tick) * 100}%` }}
        />
      ))}
    </div>
  );
}

const styles = stylex.create({
  track: {
    position: "relative",
    height: "2px",
    backgroundColor: tokens.rule,
  },
  // Updates arrive a few times a second; the transition joins them up.
  fill: {
    position: "absolute",
    inset: 0,
    backgroundColor: tokens.accent,
    transformOrigin: "left center",
    transitionProperty: "transform",
    transitionDuration: {
      default: motion.fast,
      [stylex.env.reducedMotion]: motion.instant,
    },
    transitionTimingFunction: "linear",
  },
  tick: {
    position: "absolute",
    top: "50%",
    width: "2px",
    height: "6px",
    transform: "translate(-50%, -50%)",
    borderRadius: radius.round,
    backgroundColor: tokens.inkFaint,
  },
  tickPassed: {
    backgroundColor: tokens.accent,
  },
});
