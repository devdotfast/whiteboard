import { BoardIcon } from "@canvas/ui/board-icons";
import { AgentLogo } from "@canvas/ui/brand-icons";
import {
  type ReviewProjectThread,
  type ReviewSidebarSectionProps,
  type ReviewThreadsFilter,
  boardTitle,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { FolderLabel } from "./folder-label";
import { fontSize, fontWeight, motion, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { SegmentedControl, segmentStyles } from "./ui/segmented";

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
    text: `From ${
      thread.anchor.board.title === undefined
        ? "another whiteboard"
        : boardTitle(thread.anchor.board.title)
    }`,
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

  return (
    <>
      <div {...stylex.props(styles.scope)}>
        <SegmentedControl
          label="Threads to list"
          value={threads.filter}
          options={(
            [
              ["board", "This board", onBoard.length],
              ["project", "Project", inProject.length],
              ["all", "All", threads.list.length],
            ] as const
          ).map(([value, label, count]) => ({
            value,
            label: (
              <>
                {label}
                <span
                  {...stylex.props(
                    segmentStyles.segmentCount,
                    threads.filter === value &&
                      segmentStyles.segmentCountActive,
                  )}
                >
                  {count}
                </span>
              </>
            ),
          }))}
          onChange={(filter) => onFilterThreads?.(filter)}
        />
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

            const { board, text, suffix } = relation(thread, reviewId);

            return (
              <li key={thread.id}>
                <button
                  type="button"
                  aria-current={threads.open?.includes(thread.id) || undefined}
                  {...stylex.props(
                    styles.row,
                    threads.open?.includes(thread.id) && styles.rowOpen,
                  )}
                  onClick={() => onOpenThread?.(thread.id)}
                >
                  <span {...stylex.props(styles.line)}>
                    <ThreadMark thread={thread} />
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
                  <span
                    {...stylex.props(
                      styles.opening,
                      thread.unread && styles.openingUnread,
                    )}
                  >
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
                    {/* Every project's threads: where each lives. */}
                    {threads.filter === "all" && thread.place ? (
                      <>
                        <span {...stylex.props(styles.spacer)} />
                        <FolderLabel name={thread.place} />
                      </>
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

/** Whether a thread's agent is answering now. */
export function threadAnswering(thread: ReviewProjectThread): boolean {
  return thread.status === "running" || thread.status === "starting";
}

/** A row's leading mark: the spinner while its agent answers; else the
 * agent's logo, with an amber dot when it needs you or a blue one when it
 * finished a turn you have not seen. */
function ThreadMark({ thread }: { thread: ReviewProjectThread }): ReactElement {
  if (threadAnswering(thread))
    return (
      <span {...stylex.props(styles.mark)}>
        <ThreadSpinner />
      </span>
    );

  const dot =
    thread.status === "waiting"
      ? styles.dotWaiting
      : thread.unread
        ? styles.dotUnread
        : null;

  return (
    <span {...stylex.props(styles.mark)}>
      <AgentLogo agent={thread.agent} xstyle={styles.logo} />
      {dot ? (
        <span
          role="img"
          aria-label={
            thread.status === "waiting"
              ? "Needs you"
              : "Answered since you looked"
          }
          {...stylex.props(styles.dot, dot)}
        />
      ) : null}
    </span>
  );
}

/** A marker arc turning on a faint track: an agent is answering. */
export function ThreadSpinner(): ReactElement {
  return (
    <svg
      role="img"
      aria-label="Answering"
      width="11"
      height="11"
      viewBox="0 0 11 11"
      {...stylex.props(styles.spinner)}
    >
      <circle cx="5.5" cy="5.5" r="3.75" {...stylex.props(styles.track)} />
      <path
        d="M5.5 1.75 A3.75 3.75 0 0 1 9.25 5.5"
        {...stylex.props(styles.arc)}
      />
    </svg>
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

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });

const styles = stylex.create({
  scope: {
    display: "flex",
    paddingTop: "4px",
    paddingBottom: "8px",
    paddingInline: "12px",
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
    position: "relative",
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: "10px",
    height: "10px",
  },
  logo: { width: "10px", height: "10px" },
  dot: {
    position: "absolute",
    top: "-3px",
    right: "-3px",
    boxSizing: "border-box",
    width: "6px",
    height: "6px",
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: tokens.tray,
    borderRadius: radius.round,
  },
  dotUnread: { backgroundColor: tokens.accent },
  dotWaiting: { backgroundColor: tokens.changeModified },
  spinner: {
    flexShrink: 0,
    animationName: { default: spin, [reducedMotion]: "none" },
    animationDuration: motion.spin,
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  track: { fill: "none", stroke: tokens.ruleSoft, strokeWidth: 1.4 },
  arc: {
    fill: "none",
    stroke: tokens.accent,
    strokeLinecap: "round",
    strokeWidth: 1.4,
  },
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
  openingUnread: { fontWeight: fontWeight.medium },
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
