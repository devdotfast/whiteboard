import { motion } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { spinStyles } from "@canvas/ui/spinner";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

/** Styles a parent adds to an icon for its context. */
export type IconProps = { xstyle?: stylex.StyleXStyles };

// Every icon draws round 1.7 strokes on a 24 grid; `iconStyles` sizes it.
function Icon({
  xstyle,
  base = styles.icon,
  children,
}: IconProps & {
  base?: stylex.StyleXStyles;
  children: ReactNode;
}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(base, xstyle)}
      focusable="false"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

export function CloseIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M7 7l10 10M17 7 7 17" />
    </Icon>
  );
}

export function CheckIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Icon>
  );
}

/** A check that draws itself in when it mounts, for a just-finished action. */
export function DrawnCheckIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={[styles.drawnCheck, xstyle]}>
      <path d="M5 12.5l4.5 4.5L19 7" pathLength={1} />
    </Icon>
  );
}

export function PlusIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function MinusIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M5 12h14" />
    </Icon>
  );
}

export function ArrowUpIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Icon>
  );
}

export function ArrowDownIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Icon>
  );
}

export function ArrowLeftIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Icon>
  );
}

export function ArrowRightIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}

/** Opens somewhere outside the canvas. */
export function ExternalLinkIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M8 6h10v10M18 6 6 18" />
    </Icon>
  );
}

export function PopOutIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M13.5 3.75h6.75v6.75M20.25 3.75 12 12M9.75 5.25H6A2.25 2.25 0 0 0 3.75 7.5V18A2.25 2.25 0 0 0 6 20.25h10.5A2.25 2.25 0 0 0 18.75 18v-3.75" />
    </Icon>
  );
}

/** A side panel, for docking a floating window back into it. */
export function DockIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <rect x="3.75" y="4.5" width="16.5" height="15" rx="2.25" />
      <path d="M14.25 4.5v15" />
    </Icon>
  );
}

export function RefreshIcon({
  xstyle,
  spinning = false,
}: IconProps & { spinning?: boolean } = {}): ReactElement {
  return (
    <Icon xstyle={[spinning && spinStyles.turning, xstyle]}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </Icon>
  );
}

/** Folds a list of sections closed. */
export function FoldIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M8 4l4 4 4-4M8 20l4-4 4 4M5 12h14" />
    </Icon>
  );
}

/** Unfolds a list of sections. */
export function UnfoldIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M8 7l4-4 4 4M8 17l4 4 4-4M5 12h14" />
    </Icon>
  );
}

export function SearchIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <circle cx="10.5" cy="10.5" r="6.75" />
      <path d="m15.75 15.75 4.5 4.5" />
    </Icon>
  );
}

export function FilterIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M3 6h18M6 12h12M9 18h6" />
    </Icon>
  );
}

export function ClearFiltersIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M3 6h18M6 12h5.25M9 18h2.25M15 12.75l6 6m0-6-6 6" />
    </Icon>
  );
}

export function SortIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M7.5 3v18m-4.5-4.5 4.5 4.5 4.5-4.5M16.5 21V3M12 7.5 16.5 3 21 7.5" />
    </Icon>
  );
}

/** Oldest first: the arrow points back up the list. */
export function SortAscendingIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M6 19.5v-15M2.25 8.25 6 4.5l3.75 3.75M12.75 6.75h9M12.75 12h6.75M12.75 17.25h4.5" />
    </Icon>
  );
}

/** Newest first. */
export function SortDescendingIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M6 4.5v15M2.25 15.75 6 19.5l3.75-3.75M12.75 6.75h9M12.75 12h6.75M12.75 17.25h4.5" />
    </Icon>
  );
}

export function SlidersIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M4 8h4.5M13.5 8H20M4 16h6.5M15.5 16H20" />
      <circle cx="11" cy="8" r="2.5" />
      <circle cx="13" cy="16" r="2.5" />
    </Icon>
  );
}

export function GearIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <circle cx="12" cy="12" r="3.3" />
      <circle cx="12" cy="12" r="6.9" />
      <path d="M12 2.7v2.4M12 18.9v2.4M2.7 12h2.4M18.9 12h2.4M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M5.4 18.6l1.7-1.7M16.9 7.1l1.7-1.7" />
    </Icon>
  );
}

export function HelpIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <circle cx="12" cy="12" r="9.4" />
      <path d="M9.3 9.4q.2-2.4 2.7-2.4 2.7 0 2.7 2.3 0 1.5-1.8 2.2-.9.4-.9 1.8M12 16.8h.01" />
    </Icon>
  );
}

export function InfoIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <circle cx="12" cy="12" r="9.4" />
      <path d="M12 11v5.5M12 7.6h.01" />
    </Icon>
  );
}

export function StackIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M12 4 20 8.5 12 13 4 8.5Z" />
      <path d="M4 12.5 12 17l8-4.5M4 16.5 12 21l8-4.5" />
    </Icon>
  );
}

export function ContentsIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M8 7h10M8 12h10M8 17h10" />
      <path d="M5 7h.01M5 12h.01M5 17h.01" />
    </Icon>
  );
}

/** Lines of text. */
export function TextIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h10.5" />
    </Icon>
  );
}

export function FileIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </Icon>
  );
}

export function FolderIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M3 6.75V18h18V9h-9l-2.25-2.25z" />
    </Icon>
  );
}

export function ImageIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <rect x="3.75" y="4.5" width="16.5" height="15" rx="2.25" />
      <circle cx="9" cy="9.75" r="1.5" />
      <path d="m20.25 15.75-4.5-4.5L6 19.5" />
    </Icon>
  );
}

export function CopyIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </Icon>
  );
}

export function ShareIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M12 15V3m-4 4 4-4 4 4M7 10H5v11h14V10h-2" />
    </Icon>
  );
}

export function MailIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </Icon>
  );
}

export function TrashIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M4.5 6.75h15M9.75 6.75V4.5h4.5v2.25M6.75 6.75l.9 12.75h8.7l.9-12.75M10.5 10.5v6M13.5 10.5v6" />
    </Icon>
  );
}

export function ArchiveIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <rect x="3" y="4.5" width="18" height="4.5" rx="1.5" />
      <path d="M5 9v9.25A1.75 1.75 0 0 0 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25V9M10 13h4" />
    </Icon>
  );
}

export function LockIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.25" />
      <path d="M8.25 10.5v-3a3.75 3.75 0 0 1 7.5 0v3" />
    </Icon>
  );
}

export function HistoryIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M3.75 12a8.25 8.25 0 1 0 2.4-5.85M3.75 3.75v3.9h3.9M12 7.5v4.8l3 1.95" />
    </Icon>
  );
}

export function ChatIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M4.5 5.25h15v10.5H11.25L6.75 19.5v-3.75H4.5z" />
    </Icon>
  );
}

export function BugIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <rect x="8" y="7" width="8" height="12" rx="4" />
      <path d="M10 7V6a2 2 0 0 1 4 0v1M12 8v10" />
      <path d="M8 10H5M19 10h-3M8 14H5M19 14h-3M8.75 18 6 20M15.25 18 18 20" />
    </Icon>
  );
}

/** "⋯": more actions. */
export function MoreIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" />
    </Icon>
  );
}

/** A thread pinned to the passage it asks about. */
export function PinIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M12 3v11M7 8q0 6 5 6t5-6M12 14v7" />
    </Icon>
  );
}

export function MapPinIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M12 21s6-5.25 6-11a6 6 0 1 0-12 0c0 5.75 6 11 6 11Z" />
      <circle cx="12" cy="10" r="2.25" />
    </Icon>
  );
}

export function CodeIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="m9 7-5 5 5 5m6-10 5 5-5 5" />
    </Icon>
  );
}

/** A commit: a node on its line. */
export function CommitIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <circle cx="12" cy="12" r="3.75" />
      <path d="M2.25 12h6M15.75 12h6" />
    </Icon>
  );
}

export function BranchIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <circle cx="6" cy="4.5" r="2.5" />
      <circle cx="6" cy="19.5" r="2.5" />
      <circle cx="18" cy="7.5" r="2.5" />
      <path d="M6 7v10M18 10c0 3.9-6 3.9-12 5.7" />
    </Icon>
  );
}

export function PullRequestIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <circle cx="6" cy="4.5" r="2.5" />
      <circle cx="6" cy="19.5" r="2.5" />
      <circle cx="18" cy="19.5" r="2.5" />
      <path d="M6 7v10M18 17V9a3 3 0 0 0-3-3h-4M12 3.5 9.5 6 12 8.5" />
    </Icon>
  );
}

/** A terminal: a command an agent ran. */
export function TerminalIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <rect x="2.25" y="3.75" width="19.5" height="16.5" rx="2.25" />
      <path d="M6.75 9l3 3-3 3M12.75 15.75h4.5" />
    </Icon>
  );
}

export function PencilIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M16.65 3.3a2.4 2.4 0 0 1 3.45 3.45L7.5 19.35l-4.5 1.05 1.05-4.5z" />
    </Icon>
  );
}

/** A light bulb: an agent thinking. */
export function ThinkingIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M12 3a7.5 7.5 0 0 0-5.25 12.75V18a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-2.25A7.5 7.5 0 0 0 12 3zM9 22.5h6" />
    </Icon>
  );
}

/** Steps fading down the page: a run of tool calls. */
export function StepsIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={[styles.filled, xstyle]}>
      <rect x="4.5" y="3.75" width="15" height="4.5" rx="2.25" />
      <rect x="4.5" y="9.75" width="15" height="4.5" rx="2.25" opacity="0.6" />
      <rect
        x="4.5"
        y="15.75"
        width="15"
        height="4.5"
        rx="2.25"
        opacity="0.35"
      />
    </Icon>
  );
}

/** A spark: work handed to another agent. */
export function SparkleIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon xstyle={xstyle}>
      <path d="M12 3l2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7z" />
    </Icon>
  );
}

/**
 * The one chevron glyph, pointing down. Callers rotate it with `iconStyles.flip`;
 * `DisclosureChevron` turns it. `tokens.chevronDown` draws the same path.
 */
export function ChevronDownIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <Icon base={styles.chevron} xstyle={xstyle}>
      <path d="M5 8.5 12 16l7-7.5" />
    </Icon>
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

const styles = stylex.create({
  icon: {
    flexShrink: 0,
    width: "15px",
    height: "15px",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.7px",
  },
  // The tree glyphs, chevrons and file marks, draw a 1.5px line to match the
  // workbench's twisties and file marks.
  chevron: {
    flexShrink: 0,
    width: "12px",
    height: "12px",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "3px",
  },
  drawnCheck: {
    width: "12px",
    height: "12px",
    strokeWidth: "2.1px",
    strokeDasharray: "1",
    animationName: { default: drawIn, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: motion.slow,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "ease-out",
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  filled: {
    fill: "currentColor",
    stroke: "none",
  },
  grip: {
    flexShrink: 0,
    width: "10px",
    height: "14px",
    fill: "currentColor",
  },
});
