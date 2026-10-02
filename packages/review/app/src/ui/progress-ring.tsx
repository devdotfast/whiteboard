import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

export function ProgressRing({
  percent,
  size,
}: {
  percent: number;
  size: number;
}) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20">
      <circle {...stylex.props(styles.track)} cx="10" cy="10" r="7" />
      <circle
        {...stylex.props(styles.track, styles.value)}
        cx="10"
        cy="10"
        r="7"
        pathLength="100"
        strokeDasharray={`${percent} 100`}
      />
    </svg>
  );
}

const styles = stylex.create({
  track: {
    fill: "none",
    stroke: tokens.well,
    strokeWidth: "2.5",
  },
  value: {
    transform: "rotate(-90deg)",
    transformOrigin: "10px 10px",
    stroke: tokens.accent,
    strokeLinecap: "round",
  },
});
