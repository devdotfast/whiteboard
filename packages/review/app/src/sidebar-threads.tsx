import { BoardIcon } from "@canvas/ui/board-icons";
import { AgentLogo } from "@canvas/ui/brand-icons";
import { buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { PinIcon } from "@canvas/ui/icons";
import { listRowStyles } from "@canvas/ui/list-row";
import { Spinner } from "@canvas/ui/spinner";
import { StatusDot } from "@canvas/ui/status-dot";
import { textStyles } from "@canvas/ui/text";
import {
  type ReviewProjectThread,
  type ReviewSidebarSectionProps,
  type ReviewThreadsFilter,
  boardTitle,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { FolderLabel } from "./folder-label";
import { countLabel, formatRelativeTime } from "./format";
import { fontSize, fontWeight, leading, radius, space } from "./scale.stylex";
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
            : `${started} · edited ${countLabel(edited, "board")}`,
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
                    focusStyles.ringInset,
                    buttonStyles.reset,
                    listRowStyles.wash,
                    styles.row,
                    threads.open?.includes(thread.id) && listRowStyles.current,
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
                      {formatRelativeTime(thread.updatedAt, Date.now(), {
                        short: true,
                      })}
                    </span>
                  </span>
                  <span
                    {...stylex.props(
                      textStyles.truncate,
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
                      <PinIcon xstyle={styles.pin} />
                    )}
                    <span
                      {...stylex.props(
                        textStyles.truncate,
                        styles.relationText,
                      )}
                    >
                      {text}
                    </span>
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
        <Spinner tone="accent" label="Answering" xstyle={styles.spinner} />
      </span>
    );

  return (
    <span {...stylex.props(styles.mark)}>
      <AgentLogo agent={thread.agent} xstyle={styles.logo} />
      {thread.status === "waiting" ? (
        <StatusDot label="Needs you" tone="warning" size="small" />
      ) : thread.unread ? (
        <StatusDot label="Answered since you looked" size="small" />
      ) : null}
    </span>
  );
}

const styles = stylex.create({
  scope: {
    display: "flex",
    paddingTop: space.s4,
    paddingBottom: space.s8,
    paddingInline: space.s12,
  },
  empty: {
    margin: 0,
    paddingBlock: space.s8,
    paddingInline: space.s14,
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: leading.px18,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    paddingTop: 0,
    paddingBottom: space.s8,
    paddingInline: space.s6,
    listStyle: "none",
  },
  row: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    width: "100%",
    minWidth: 0,
    padding: space.s8,
    borderRadius: radius.control,
    color: tokens.ink,
    textAlign: "start",
    cursor: "pointer",
  },
  line: {
    display: "flex",
    alignItems: "center",
    gap: space.s6,
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
  spinner: { width: "11px", height: "11px" },
  agent: {
    flexShrink: 0,
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: leading.px16,
  },
  status: {
    flexShrink: 0,
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: leading.px16,
  },
  statusWaiting: { color: tokens.changeModified },
  statusRunning: { color: tokens.inkMuted },
  spacer: { flex: "1 1 0" },
  opening: {
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.title,
    lineHeight: leading.px20,
  },
  openingUnread: { fontWeight: fontWeight.medium },
  relation: { gap: space.s4 },
  relationText: {
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: leading.px16,
  },
  // " · edited here" stays when the board's title is cut short.
  relationSuffix: {
    flexShrink: 0,
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: leading.px16,
    whiteSpace: "pre",
  },
  kind: { width: "12px", height: "12px", color: tokens.inkFaint },
  pin: { width: "11px", height: "11px", color: tokens.inkFaint },
});
