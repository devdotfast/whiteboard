import { tokens } from "@canvas/tokens.stylex";
import { useTooltip } from "@canvas/ui/tooltip";
import {
  BOARD_ICONS,
  type BoardIconDefinition,
  type BoardIconKind,
  PULL_REQUEST_STATE_ICONS,
  PULL_REQUEST_STATE_LABELS,
  type PullRequestState,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, createElement } from "react";

function DrawnIcon({
  icon,
  xstyle,
}: {
  icon: BoardIconDefinition;
  xstyle?: stylex.StyleXStyles;
}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      strokeWidth={icon.strokeWidth}
      {...stylex.props(styles.icon, xstyle)}
    >
      {icon.strokes.map(({ tag, attrs }, index) =>
        createElement(tag, { key: index, ...attrs }),
      )}
    </svg>
  );
}

/** A board's icon: the board with lines, or with <> when code is attached. */
export function BoardIcon({
  // A board whose target is unknown draws as one with none.
  icon = "board",
  current = false,
  xstyle,
}: {
  icon?: BoardIconKind;
  /** The board on screen, drawn in the marker colour. */
  current?: boolean;
  xstyle?: stylex.StyleXStyles;
}): ReactElement {
  return (
    <DrawnIcon
      icon={BOARD_ICONS[icon]}
      xstyle={[styles.kind, current && styles.current, xstyle]}
    />
  );
}

/** A PR's state, coloured by it, with "PR #908 · Open" on hover. Before the
 * state is known it is the open icon in faint ink. */
export function PullRequestStateIcon({
  number,
  state,
  xstyle,
}: {
  number: number;
  state?: PullRequestState;
  xstyle?: stylex.StyleXStyles;
}): ReactElement {
  const tooltip = useTooltip<HTMLSpanElement>(
    state
      ? `PR #${number} · ${PULL_REQUEST_STATE_LABELS[state]}`
      : `PR #${number}`,
    { instant: true },
  );

  return (
    <span
      ref={tooltip}
      role="img"
      aria-label={
        state
          ? `PR #${number}, ${PULL_REQUEST_STATE_LABELS[state].toLowerCase()}`
          : `PR #${number}`
      }
      data-pull-request-state={state ?? "unknown"}
      {...stylex.props(styles.state)}
    >
      <DrawnIcon
        icon={PULL_REQUEST_STATE_ICONS[state ?? "open"]}
        xstyle={[stateStyles[state ?? "unknown"], xstyle]}
      />
    </span>
  );
}

const styles = stylex.create({
  icon: {
    flexShrink: 0,
    display: "inline-block",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  kind: { color: tokens.inkMuted },
  current: { color: tokens.accent },
  state: { display: "inline-flex", flexShrink: 0 },
});

const stateStyles = stylex.create({
  open: { color: tokens.changeAdded },
  draft: { color: tokens.inkFaint },
  merged: { color: tokens.merged },
  closed: { color: tokens.changeRemoved },
  unknown: { color: tokens.inkFaint },
});
