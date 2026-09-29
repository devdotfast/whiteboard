import { motion } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { chevronMarker, segmentMarker } from "./markers.stylex";
import { tokens } from "./tokens.stylex";

/** Styles a parent adds to an icon for its context. */
export type IconProps = { xstyle?: stylex.StyleXStyles };

export function CloseIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M7 7l10 10M17 7 7 17" />
    </svg>
  );
}

export function SlidersIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M4 8h4.5M13.5 8H20M4 16h6.5M15.5 16H20" />
      <circle cx="11" cy="8" r="2.5" />
      <circle cx="13" cy="16" r="2.5" />
    </svg>
  );
}

export function UnifiedLayoutIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 10h8M8 14h8" />
    </svg>
  );
}

export function SplitLayoutIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function BugIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <rect x="8" y="7" width="8" height="12" rx="4" />
      <path d="M10 7V6a2 2 0 0 1 4 0v1M12 8v10" />
      <path d="M8 10H5M19 10h-3M8 14H5M19 14h-3M8.75 18 6 20M15.25 18 18 20" />
    </svg>
  );
}

export function ContentsIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M8 7h10M8 12h10M8 17h10" />
      <path d="M5 7h.01M5 12h.01M5 17h.01" />
    </svg>
  );
}

export function TutorialIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M4.5 5.5h4.75A2.75 2.75 0 0 1 12 8.25V19a2.75 2.75 0 0 0-2.75-2.75H4.5V5.5Z" />
      <path d="M19.5 5.5h-4.75A2.75 2.75 0 0 0 12 8.25V19a2.75 2.75 0 0 1 2.75-2.75h4.75V5.5Z" />
    </svg>
  );
}

export function PlusIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function MinusIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

export function RefreshIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M20 7v5h-5" />
      <path d="M20 12a8 8 0 1 0-2.34 5.66" />
    </svg>
  );
}

export function SettingsSlidersIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.settingsSliders)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M4.5 8h15M4.5 16h15" />
      <circle cx="9" cy="8" r="2" />
      <circle cx="15" cy="16" r="2" />
    </svg>
  );
}

export function MapPinIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M12 21s6-5.25 6-11a6 6 0 1 0-12 0c0 5.75 6 11 6 11Z" />
      <circle cx="12" cy="10" r="2.25" />
    </svg>
  );
}

/**
 * The whiteboard marker stroke, drawn under a top bar surface; it is revealed
 * left to right with a clip. Its tab carries `segmentMarker`.
 */
export function MarkerUnderline({ active }: { active: boolean }): ReactElement {
  return (
    <svg
      {...stylex.props(styles.underline, active && styles.underlineActive)}
      viewBox="0 0 48 3"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        {...stylex.props(styles.underlineStroke)}
        d="M1 1.6 C 12 0.5, 30 2.5, 47 1.2"
      />
    </svg>
  );
}

/**
 * The one disclosure glyph. A 12px stroke chevron in a 16px slot that points
 * right when closed and rotates to point down when open; every section
 * header, lens row, tree row, commit card and dropdown chip uses this, and the
 * workbench restyles its codicon twisties to the same path (review.css).
 * Its button carries `chevronMarker`.
 */
export function DisclosureChevron({
  expanded,
  xstyle,
}: IconProps & {
  expanded: boolean;
}): ReactElement {
  return (
    <svg
      {...stylex.props(styles.chevron, expanded && styles.chevronOpen, xstyle)}
      viewBox="0 0 12 12"
      aria-hidden="true"
      data-open={expanded || undefined}
    >
      <path d="M4.25 2.5 8 6l-3.75 3.5" />
    </svg>
  );
}

export function DiscordIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      {...stylex.props(styles.icon, styles.discord, xstyle)}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20.317 4.37a19.792 19.792 0 0 0-4.885-1.515c-.211.375-.457.88-.626 1.282a18.416 18.416 0 0 0-5.42 0 12.64 12.64 0 0 0-.635-1.282A19.736 19.736 0 0 0 3.86 4.37C.768 8.946-.07 13.408.35 17.807a19.9 19.9 0 0 0 5.993 3.03c.483-.66.914-1.36 1.286-2.095a12.87 12.87 0 0 1-2.025-.987c.17-.124.337-.253.498-.385 3.905 1.826 8.148 1.826 12.006 0 .163.132.33.26.498.385a12.91 12.91 0 0 1-2.029.989c.372.734.802 1.434 1.285 2.094a19.84 19.84 0 0 0 5.997-3.03c.493-5.1-.843-9.521-3.542-13.438ZM8.02 15.117c-1.182 0-2.153-1.084-2.153-2.405s.95-2.407 2.153-2.407c1.203 0 2.174 1.084 2.153 2.407 0 1.32-.95 2.405-2.153 2.405Zm7.957 0c-1.182 0-2.153-1.084-2.153-2.405s.95-2.407 2.153-2.407c1.203 0 2.174 1.084 2.153 2.407 0 1.32-.95 2.405-2.153 2.405Z" />
    </svg>
  );
}

export function ShareIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      {...stylex.props(styles.icon, xstyle)}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 15V3m-4 4 4-4 4 4M7 10H5v11h14V10h-2" />
    </svg>
  );
}

export function CopyIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

export function CodeIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="m9 7-5 5 5 5m6-10 5 5-5 5" />
    </svg>
  );
}

export function CheckIcon({ xstyle }: IconProps = {}): ReactElement {
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

/** A check that draws itself in when it mounts, for a just-finished action. */
export function DrawnCheckIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.drawnCheck)}
      focusable="false"
      viewBox="0 0 12 12"
    >
      <path
        {...stylex.props(styles.drawnCheckStroke)}
        d="M2.5 6.5 5 9l4.5-6"
        pathLength={1}
      />
    </svg>
  );
}

const drawIn = stylex.keyframes({
  from: { strokeDashoffset: 1 },
  to: { strokeDashoffset: 0 },
});

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

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
  settingsSliders: {
    width: "16px",
    height: "16px",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.5px",
  },
  discord: {
    fill: "currentColor",
    stroke: "none",
  },
  // The marker is drawn, not painted: a clip slides open, so the pen's
  // progress is the same whatever the tab's width (a dash offset would not
  // be under non-scaling-stroke). Hover draws a lighter stroke; leaving fades
  // the ink and only then closes the clip, so the pen never runs backwards.
  underline: {
    position: "absolute",
    bottom: "6px",
    left: 0,
    width: "100%",
    height: "3px",
    overflow: "visible",
    clipPath: {
      default: "inset(-2px 100% -2px 0)",
      [stylex.when.ancestor(":hover", segmentMarker)]: "inset(-2px 0 -2px 0)",
    },
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", segmentMarker)]: 0.7,
    },
    pointerEvents: "none",
    transition: {
      default: `opacity ${motion.fast} ${motion.ease}, clip-path ${motion.instant} linear ${motion.fast}`,
      [stylex.when.ancestor(":hover", segmentMarker)]:
        `opacity ${motion.instant}, clip-path ${motion.slow} cubic-bezier(0.2, 0.7, 0.2, 1)`,
      [reducedMotion]: `opacity ${motion.fast} ${motion.ease}`,
    },
  },
  underlineActive: {
    clipPath: "inset(-2px 0 -2px 0)",
    opacity: {
      default: 1,
      [stylex.when.ancestor(":hover", segmentMarker)]: 0.7,
    },
    transition: {
      default: `opacity ${motion.instant}, clip-path ${motion.slow} cubic-bezier(0.2, 0.7, 0.2, 1)`,
      [reducedMotion]: `opacity ${motion.fast} ${motion.ease}`,
    },
  },
  underlineStroke: {
    fill: "none",
    stroke: tokens.accent,
    strokeWidth: "2",
    strokeLinecap: "round",
    vectorEffect: "non-scaling-stroke",
  },
  chevron: {
    flex: "none",
    width: "12px",
    height: "12px",
    margin: "2px",
    color: {
      default: tokens.inkFaint,
      [stylex.when.ancestor(":hover", chevronMarker)]: tokens.ink,
      [stylex.when.ancestor(":focus-visible", chevronMarker)]: tokens.ink,
    },
    fill: "none",
    stroke: "currentcolor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    transition: `transform ${motion.fast} ${motion.ease}, color ${motion.fast} ${motion.ease}`,
  },
  chevronOpen: {
    transform: "rotate(90deg)",
  },
  drawnCheck: {
    flex: "none",
    width: "12px",
    height: "12px",
  },
  drawnCheckStroke: {
    fill: "none",
    stroke: "currentColor",
    strokeDasharray: "1",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.2",
    animationName: { default: drawIn, [reducedMotion]: "none" },
    animationDuration: {
      default: motion.slow,
      [reducedMotion]: motion.instant,
    },
    animationTimingFunction: { default: "ease-out", [reducedMotion]: "ease" },
    animationFillMode: { default: "both", [reducedMotion]: "none" },
  },
});
