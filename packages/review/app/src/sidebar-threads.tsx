import type {
  ReviewProjectThread,
  ReviewSidebarSectionProps,
  ReviewThreadsFilter,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { AGENT_LOGOS } from "./agent-logos";
import { BoardIcon } from "./board-icons";
import { elevation, fontSize, fontWeight, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

/** Whether a thread belongs to the board: it started on it, or edited it. */
export function threadOnBoard(
  thread: ReviewProjectThread,
  reviewId: string,
): boolean {
  return (
    thread.anchor.board.reviewId === reviewId ||
    thread.edited.some((board) => board.reviewId === reviewId)
  );
}

/** "2m", "1h", "Yesterday", then the date. */
function age(updatedAt: string, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - Date.parse(updatedAt)) / 60_000);

  if (!Number.isFinite(minutes)) return "";

  if (minutes < 1) return "now";

  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${hours}h`;

  if (hours < 48) return "Yesterday";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(Date.parse(updatedAt));
}

const statusText = {
  waiting: "Needs you",
  running: "Answering…",
  starting: "Answering…",
  failed: "Stopped",
  idle: "Answered",
} as const;

/** How the thread relates to the board: where it started and what it
 * changed. */
function relation(thread: ReviewProjectThread, reviewId: string) {
  const here = thread.anchor.board.reviewId === reviewId;
  const editedHere = thread.edited.some((board) => board.reviewId === reviewId);
  const edited = thread.edited.length;

  if (here) {
    const started = thread.pinned ? "Pinned here" : "Asked here";

    return {
      board: undefined,
      suffix: undefined,
      text:
        edited === 0
          ? started
          : edited === 1 && editedHere
            ? `${started} · edited here`
            : `${started} · edited ${edited} ${edited === 1 ? "board" : "boards"}`,
    };
  }

  return {
    board: thread.anchor.board,
    text: `From ${thread.anchor.board.title || "another whiteboard"}`,
    suffix: editedHere ? " · edited here" : undefined,
  };
}

/** The Threads tab: the board's threads, the project's or every project's,
 * newest first; a row opens its thread in Ask. */
export function ThreadsSectionBody({
  reviewId,
  threads,
  onFilterThreads,
  onOpenThread,
}: ReviewSidebarSectionProps): ReactElement | null {
  if (!threads) return null;

  const onBoard = threads.list.filter((thread) =>
    threadOnBoard(thread, reviewId),
  );

  const inProject = threads.list.filter(
    (thread) =>
      thread.anchor.board.reviewId === reviewId ||
      (threads.project !== undefined && thread.projectId === threads.project),
  );

  const shown = {
    board: onBoard,
    project: inProject,
    all: threads.list,
  }[threads.filter];

  const option = (
    filter: ReviewThreadsFilter,
    label: string,
    count: number,
  ) => {
    const selected = threads.filter === filter;

    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        {...stylex.props(styles.option, selected && styles.optionSelected)}
        onClick={() => onFilterThreads?.(filter)}
      >
        <span {...stylex.props(styles.optionLabel)}>{label}</span>
        <span {...stylex.props(styles.optionCount)}>{count}</span>
      </button>
    );
  };

  return (
    <>
      <div {...stylex.props(styles.scope)}>
        <div
          role="radiogroup"
          aria-label="Threads to list"
          {...stylex.props(styles.switch)}
        >
          {option("board", "This board", onBoard.length)}
          {option("project", "Project", inProject.length)}
          {option("all", "All", threads.list.length)}
        </div>
      </div>
      {shown.length === 0 ? (
        <p {...stylex.props(styles.empty)}>
          {
            {
              board:
                "No threads about this board yet. Select a passage and choose Ask.",
              project: "No threads in this project yet.",
              all: "No threads yet.",
            }[threads.filter]
          }
        </p>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {shown.map((thread) => {
            const status = statusText[thread.status ?? "idle"];

            const Logo = Object.hasOwn(AGENT_LOGOS, thread.agent)
              ? // SAFETY: hasOwn just checked the key.
                AGENT_LOGOS[thread.agent as keyof typeof AGENT_LOGOS]
              : undefined;

            const { board, text, suffix } = relation(thread, reviewId);

            return (
              <li key={thread.id}>
                <button
                  type="button"
                  aria-current={thread.id === threads.open || undefined}
                  {...stylex.props(
                    styles.row,
                    thread.id === threads.open && styles.rowOpen,
                  )}
                  onClick={() => onOpenThread?.(thread.id)}
                >
                  <span {...stylex.props(styles.line)}>
                    <span {...stylex.props(styles.mark)}>
                      {Logo ? <Logo xstyle={styles.logo} /> : null}
                    </span>
                    <span {...stylex.props(styles.agent)}>
                      {thread.agentName}
                    </span>
                    <span
                      {...stylex.props(
                        styles.status,
                        thread.status === "waiting" && styles.statusWaiting,
                        (thread.status === "running" ||
                          thread.status === "starting") &&
                          styles.statusRunning,
                      )}
                    >
                      {status}
                    </span>
                    <span {...stylex.props(styles.spacer)} />
                    <span {...stylex.props(styles.status)}>
                      {age(thread.updatedAt)}
                    </span>
                  </span>
                  <span {...stylex.props(styles.opening)}>
                    “{thread.opening}”
                  </span>
                  <span {...stylex.props(styles.line, styles.relation)}>
                    {board ? (
                      <BoardIcon icon={board.icon} xstyle={styles.kind} />
                    ) : (
                      <PinIcon />
                    )}
                    <span {...stylex.props(styles.relationText)}>{text}</span>
                    {suffix ? (
                      <span {...stylex.props(styles.relationSuffix)}>
                        {suffix}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function PinIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 12 12"
      {...stylex.props(styles.pin)}
    >
      <path d="M6 1.5 V7 M3.5 4 Q3.5 7 6 7 Q8.5 7 8.5 4 M6 7 V10.5" />
    </svg>
  );
}

const styles = stylex.create({
  scope: {
    display: "flex",
    paddingTop: "4px",
    paddingBottom: "8px",
    paddingInline: "12px",
  },
  switch: {
    display: "flex",
    flex: "1 1 0",
    minWidth: 0,
    padding: "2px",
    borderRadius: radius.control,
    backgroundColor: tokens.well,
  },
  // Each segment takes a third, on one line: a label too long for it ends in
  // an ellipsis rather than wrapping.
  option: {
    display: "flex",
    flex: "1 1 0",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    minWidth: 0,
    height: "24px",
    paddingBlock: 0,
    paddingInline: "6px",
    whiteSpace: "nowrap",
    borderWidth: 0,
    borderRadius: radius.small,
    backgroundColor: "transparent",
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "16px",
    cursor: "pointer",
  },
  // Raised on a hairline, as the other segmented controls are: in dark the
  // raised fill matches the well, so the hairline marks it.
  optionSelected: {
    backgroundColor: tokens.raised,
    boxShadow: `${elevation.raised}, 0 0 0 1px ${tokens.ruleSoft}`,
    color: tokens.ink,
    fontWeight: fontWeight.medium,
  },
  optionLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  // A count, in Inter, its digits lined up.
  optionCount: {
    flexShrink: 0,
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontVariantNumeric: "tabular-nums",
    fontSize: fontSize.small,
    fontWeight: fontWeight.regular,
    lineHeight: "14px",
  },
  empty: {
    margin: 0,
    paddingBlock: "8px",
    paddingInline: "14px",
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "18px",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    paddingTop: 0,
    paddingBottom: "8px",
    paddingInline: "6px",
    listStyle: "none",
  },
  row: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    width: "100%",
    minWidth: 0,
    padding: "8px",
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": tokens.markerTint },
    color: tokens.ink,
    textAlign: "start",
    cursor: "pointer",
  },
  rowOpen: { backgroundColor: tokens.markerTint },
  line: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
  },
  mark: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: "10px",
    height: "10px",
  },
  logo: { width: "10px", height: "10px" },
  agent: {
    flexShrink: 0,
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "16px",
  },
  status: {
    flexShrink: 0,
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "16px",
  },
  statusWaiting: { color: tokens.changeModified },
  statusRunning: { color: tokens.inkMuted },
  spacer: { flex: "1 1 0" },
  opening: {
    overflow: "hidden",
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.title,
    lineHeight: "19px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  relation: { gap: "5px" },
  relationText: {
    overflow: "hidden",
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "16px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // " · edited here" stays when the board's title is cut short.
  relationSuffix: {
    flexShrink: 0,
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "16px",
    whiteSpace: "pre",
  },
  kind: { width: "12px", height: "12px", color: tokens.inkFaint },
  pin: {
    flexShrink: 0,
    fill: "none",
    stroke: tokens.inkFaint,
    strokeLinecap: "round",
    strokeWidth: 1.1,
  },
});
