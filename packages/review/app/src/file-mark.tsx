import type { ReviewDiffFileWire } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { tokens } from "./tokens.stylex";

// Added and deleted take the two change colors, modified the warn amber the
// diagrams use, renamed ink-muted, referenced context a ghost file outline.
const styles = stylex.create({
  mark: {
    flex: "none",
    width: "16px",
    height: "16px",
    fill: "none",
    stroke: "currentcolor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  dot: {
    fill: "currentcolor",
    stroke: "none",
  },
  added: { color: tokens.changeAdded },
  deleted: { color: tokens.changeRemoved },
  modified: { color: tokens.changeModified },
  renamed: { color: tokens.inkMuted },
  unchanged: { color: tokens.ghost },
});

const MARK_PATHS: Record<ReviewDiffFileWire["status"], ReactElement> = {
  added: <path d="M8 4v8M4 8h8" />,
  deleted: <path d="M4 8h8" />,
  modified: <circle {...stylex.props(styles.dot)} cx="8" cy="8" r="2.75" />,
  renamed: <path d="M3.5 8h9M9 4.5 12.5 8 9 11.5" />,
  unchanged: <path d="M4.5 2.5h4.5l3 3v8h-7.5z M9 2.5v3h3" />,
};

/**
 * A file's status as one stroke beside its name: plus, minus, dot, arrow, or
 * a ghost file outline for referenced context. Same 16px slot as the chevron;
 * the workbench draws the same paths for its tree and diff headers.
 */
export function FileMark({
  status,
}: {
  status: ReviewDiffFileWire["status"];
}): ReactElement {
  return (
    <svg
      {...stylex.props(styles.mark, styles[status])}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      {MARK_PATHS[status]}
    </svg>
  );
}
