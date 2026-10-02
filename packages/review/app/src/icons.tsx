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

export function StackIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M12 4 20 8.5 12 13 4 8.5Z" />
      <path d="M4 12.5 12 17l8-4.5M4 16.5 12 21l8-4.5" />
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

export function ChatIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M4.5 5.25h15v10.5H11.25L6.75 19.5v-3.75H4.5z" />
    </svg>
  );
}

export function LockIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.25" />
      <path d="M8.25 10.5v-3a3.75 3.75 0 0 1 7.5 0v3" />
    </svg>
  );
}

export function ArrowUpIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M12 20V4m-7 7 7-7 7 7" />
    </svg>
  );
}

export function HistoryIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M3.75 12a8.25 8.25 0 1 0 2.4-5.85M3.75 3.75v3.9h3.9M12 7.5v4.8l3 1.95" />
    </svg>
  );
}

export function ImageIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <rect x="3.75" y="4.5" width="16.5" height="15" rx="2.25" />
      <circle cx="9" cy="9.75" r="1.5" />
      <path d="m20.25 15.75-4.5-4.5L6 19.5" />
    </svg>
  );
}

export function TrashIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M4.5 6.75h15M9.75 6.75V4.5h4.5v2.25M6.75 6.75l.9 12.75h8.7l.9-12.75M10.5 10.5v6M13.5 10.5v6" />
    </svg>
  );
}

export function SearchIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <circle cx="10.5" cy="10.5" r="6.75" />
      <path d="m15.75 15.75 4.5 4.5" />
    </svg>
  );
}

export function PopOutIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M13.5 3.75h6.75v6.75M20.25 3.75 12 12M9.75 5.25H6A2.25 2.25 0 0 0 3.75 7.5V18A2.25 2.25 0 0 0 6 20.25h10.5A2.25 2.25 0 0 0 18.75 18v-3.75" />
    </svg>
  );
}

/** A side panel, for docking a floating window back into it. */
export function DockIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <rect x="3.75" y="4.5" width="16.5" height="15" rx="2.25" />
      <path d="M14.25 4.5v15" />
    </svg>
  );
}

/** The Command key, drawn: the canvas's mono font has no ⌘. */
export function CommandKeyIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, styles.key, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M9 9h6v6H9zM9 9V6.5A2.5 2.5 0 1 0 6.5 9H9m6 0V6.5A2.5 2.5 0 1 1 17.5 9H15m-6 6v2.5A2.5 2.5 0 1 1 6.5 15H9m6 0v2.5a2.5 2.5 0 1 0 2.5-2.5H15" />
    </svg>
  );
}

/** The Shift key, drawn: the canvas's mono font has no ⇧. */
export function ShiftKeyIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, styles.key, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M12 4.5 5 12.5h4v7h6v-7h4z" />
    </svg>
  );
}

/** A select's closed-state chevron, the same glyph as `tokens.chevronDown`. */
export function ChevronDownIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.chevronDown, xstyle)}
      focusable="false"
      viewBox="0 0 12 12"
    >
      <path d="M2.5 4.25 6 8l3.5-3.75" />
    </svg>
  );
}

/** Where a floating window is dragged from. */
export function GripIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.grip, xstyle)}
      focusable="false"
      viewBox="0 0 10 14"
    >
      {[3, 7].flatMap((cx) =>
        [3, 7, 11].map((cy) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.1" />
        )),
      )}
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
  // As tall as a shortcut's letter.
  key: {
    width: "10px",
    height: "10px",
    strokeWidth: "2.2px",
  },
  chevronDown: {
    flex: "none",
    width: "12px",
    height: "12px",
    fill: "none",
    stroke: "currentcolor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  grip: {
    flex: "none",
    width: "10px",
    height: "14px",
    fill: "currentColor",
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
