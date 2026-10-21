import { fontSize, leading, space } from "@canvas/scale.stylex";
import { Button } from "@canvas/ui/button";
import {
  type ReviewBoardPlace,
  type ReviewDiffStats,
  summarizeReviewDiffFiles,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { canvasQueryKeys } from "./canvas-query";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { drawStyles } from "./draw-styles";
import { formatRelativeTime } from "./format";
import { useReviewSession } from "./host/review-session";
import { useReviewDiffFiles } from "./review-diff-files-context";
import { ComparedSides, DiffChanges, PullRequestLink } from "./review-source";
import { ReviewStackSelector } from "./review-stack-selector";
import { tokens } from "./tokens.stylex";

export function useBoardPlace(): ReviewBoardPlace {
  const session = useReviewSession();
  const review = session.review;
  const version = useContext(DisplayedReviewVersionContext);

  // Optional context: a failed read shows none.
  const { data } = useQuery({
    queryKey: canvasQueryKeys.place(session.reviewId, version),
    queryFn: ({ signal }) => review!.place(signal),
    enabled: review !== undefined,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });

  return data ?? NO_PLACE;
}

const NO_PLACE: ReviewBoardPlace = { siblings: [] };

/** Where the person's edits are: none yet on a new board, being saved,
 * saved, or not saved. */
export type BoardSaveStatus = "new" | "saving" | "saved" | "failed";

export const BoardSaveStatusContext = createContext<
  BoardSaveStatus | undefined
>(undefined);

/** Saves again after autosave gave up. */
export const BoardSaveRetryContext = createContext<(() => void) | undefined>(
  undefined,
);

/**
 * The board's header: for a child, its parent and its place among the
 * parent's children; the title; then one faint line with the PR, the
 * compared branches and the diff.
 */
export function ReviewDocumentMetaLine({
  children,
  editable = false,
}: {
  children?: ReactNode;
  /** The title is edited in place; the caret skips the rest. */
  editable?: boolean;
}): ReactElement {
  const session = useReviewSession();
  const diffFiles = useReviewDiffFiles();
  const place = useBoardPlace();
  const saveStatus = useContext(BoardSaveStatusContext);
  const retrySave = useContext(BoardSaveRetryContext);

  const review = session.review!;

  const diff =
    review.pins && diffFiles.status === "loaded"
      ? reviewDiffStats(diffFiles)
      : null;

  // The branch stack leads, a pill hidden unless the board is in one.
  const facts: { key: string; node: ReactNode }[] = [];

  // A board on another machine names it first.
  if (review.host)
    facts.push({
      key: "host",
      node: <span {...stylex.props(styles.fixed)}>{review.host}</span>,
    });

  if (review.pullRequestNumber)
    facts.push({
      key: "pull-request",
      node: <PullRequestLink review={review} place={place} />,
    });

  if (review.pins)
    facts.push({
      key: "compare",
      node: <ComparedSides review={review} place={place} />,
    });

  if (diff && diff.additions + diff.deletions > 0)
    facts.push({ key: "diff", node: <DiffChanges diff={diff} /> });

  if (saveStatus === "failed")
    facts.push({
      key: "updated",
      node: (
        <span {...stylex.props(styles.fixed, styles.failed)} role="status">
          Not saved
          {retrySave && (
            <>
              {" · "}
              <Button variant="link" xstyle={styles.retry} onClick={retrySave}>
                Retry
              </Button>
            </>
          )}
        </span>
      ),
    });

  return (
    // The attribute is a marker for tests.
    <header
      {...stylex.props(styles.header, drawStyles.blockChild)}
      data-review-document-header
    >
      {children}
      {facts.length ? (
        <div
          {...stylex.props(styles.facts)}
          data-review-copy-ignore
          contentEditable={editable ? false : undefined}
        >
          <ReviewStackSelector />
          {facts.map(({ key, node }, index) => (
            <Fragment key={key}>
              {index > 0 ? (
                <span aria-hidden="true" {...stylex.props(styles.fixed)}>
                  ·
                </span>
              ) : null}
              {node}
            </Fragment>
          ))}
        </div>
      ) : null}
    </header>
  );
}

/** When the board was last updated, for the page bar. */
export function BoardUpdatedAt(): ReactElement | null {
  const updatedAtMs = useReviewSession().review?.updatedAtMs;
  const displayedVersion = useContext(DisplayedReviewVersionContext);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
  }, [displayedVersion]);

  if (
    updatedAtMs === undefined ||
    !Number.isFinite(updatedAtMs) ||
    nowMs == null
  )
    return null;

  return (
    <span {...stylex.props(styles.updatedAt)}>
      Updated {formatRelativeTime(updatedAtMs, nowMs, { short: true })}
    </span>
  );
}

function reviewDiffStats(diff: {
  files?: { additions?: number; deletions?: number }[];
}): ReviewDiffStats | null {
  if (!diff.files?.length) return null;

  return summarizeReviewDiffFiles(diff.files);
}

const styles = stylex.create({
  header: {
    width: `min(100%, ${tokens.reviewProseMaxWidth})`,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    paddingBottom: space.s28,
    font: `${fontSize.body}/${leading.px18} ${tokens.chromeFont}`,
    color: tokens.inkFaint,
  },
  // One line: branch names give way; the rest never does.
  facts: {
    display: "flex",
    alignItems: "center",
    gap: space.s8,
    minWidth: 0,
    paddingTop: space.s4,
    whiteSpace: "nowrap",
  },
  fixed: { flexShrink: 0 },
  updatedAt: {
    flexShrink: 0,
    paddingInlineStart: space.s4,
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    lineHeight: leading.px18,
    whiteSpace: "nowrap",
  },
  failed: { color: tokens.changeRemoved },
  retry: { color: "inherit", textDecorationLine: "underline" },
});
