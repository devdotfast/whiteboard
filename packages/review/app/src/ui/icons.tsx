import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

export function CheckIcon({
  xstyle,
}: { xstyle?: stylex.StyleXStyles } = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

const styles = stylex.create({
  icon: {
    width: "15px",
    height: "15px",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.7px",
  },
});
