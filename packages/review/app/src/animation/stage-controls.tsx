// The pieces under an animation's or clip's stage: icon buttons, the caption
// of the stop showing, and the strip of named stops.

import { fontSize, leading, space, tracking } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { IconButton } from "@canvas/ui/button";
import { useTooltip } from "@canvas/ui/tooltip";
import * as stylex from "@stylexjs/stylex";
import type { KeyboardEvent, ReactNode } from "react";

import type { PlayerStop } from "./stage-player";

export function ControlButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  const tooltip = useTooltip(label, { quick: true });

  return (
    <IconButton
      ref={tooltip}
      aria-label={label}
      size="small"
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        {...stylex.props(styles.icon)}
      >
        {children}
      </svg>
    </IconButton>
  );
}

export const playIcon = <path d="M8.5 6.5v11l9-5.5z" />;

export const pauseIcon = <path d="M9 6.5v11M15 6.5v11" />;

/** The title and caption of the stop showing, read out as it changes. */
export function StopCaption({ stop }: { stop: PlayerStop | undefined }) {
  return (
    <div {...stylex.props(styles.caption)} aria-live="polite">
      {stop && <strong data-review-copy-prose>{stop.title}</strong>}
      {stop?.caption && <span data-review-copy-prose> {stop.caption}</span>}
    </div>
  );
}

/** A named step per stop, like a progress strip. */
export function StepStrip({
  label,
  items,
  activeIndex,
  onPick,
  onKeyDown,
}: {
  label: string;
  items: { key: string; text: string }[];
  activeIndex: number;
  onPick(position: number): void;
  onKeyDown(event: KeyboardEvent): void;
}) {
  return (
    <div
      {...stylex.props(styles.steps)}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {items.map((item, position) => (
        <button
          key={item.key}
          type="button"
          aria-current={position === activeIndex ? "step" : undefined}
          onClick={() => onPick(position)}
          {...stylex.props(
            styles.step,
            position === activeIndex && styles.stepCurrent,
          )}
        >
          <span {...stylex.props(styles.stepIndex)}>{position + 1}</span>
          <span data-review-copy-prose>{item.text}</span>
        </button>
      ))}
    </div>
  );
}

const styles = stylex.create({
  icon: {
    width: "16px",
    height: "16px",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  caption: {
    flex: "1 1 auto",
    minWidth: 0,
    marginLeft: space.s6,
    paddingBlock: space.s8,
    color: tokens.inkMuted,
    lineHeight: leading.px18,
  },
  steps: {
    display: { default: "flex", [stylex.env.narrow]: "grid" },
    gridTemplateColumns: {
      default: null,
      [stylex.env.narrow]: "repeat(4, minmax(0, 1fr))",
    },
    overflowX: { default: "auto", [stylex.env.narrow]: "visible" },
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
  },
  step: {
    display: "flex",
    flex: "1 1 0",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s4,
    minWidth: { default: "fit-content", [stylex.env.narrow]: 0 },
    padding: {
      default: `${space.s6} ${space.s10}`,
      [stylex.env.narrow]: `${space.s6} ${space.s4}`,
    },
    borderStyle: "none",
    borderBottomWidth: "2px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.transparent,
    backgroundColor: tokens.transparent,
    color: tokens.inkMuted,
    font: `${fontSize.micro} ${tokens.fontMono}`,
    letterSpacing: tracking.chrome,
    textAlign: "center",
    textTransform: "uppercase",
    whiteSpace: { default: "nowrap", [stylex.env.narrow]: "normal" },
    cursor: "pointer",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: "-2px",
  },
  stepCurrent: {
    borderBottomColor: tokens.accent,
    color: tokens.ink,
  },
  stepIndex: {
    color: "inherit",
  },
});
