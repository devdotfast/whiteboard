import { fontSize } from "@canvas/scale.stylex";
import {
  type ReviewBoardPlace,
  type ReviewDiffStats,
  summarizeReviewDiffFiles,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { drawStyles } from "./draw-styles";
import { useReviewSession } from "./host/review-session";
import { ReviewBreadcrumb } from "./review-breadcrumb";
import { useReviewDiffFiles } from "./review-diff-files-context";
import { ComparedSides, DiffChanges, PullRequestLink } from "./review-source";
import { ReviewStackSelector } from "./review-stack-selector";
import { tokens } from "./tokens.stylex";

/** Where the board sits and its source's facts; empty until read. */
function useBoardPlace(): ReviewBoardPlace {
  const session = useReviewSession();
  const displayedVersion = useContext(DisplayedReviewVersionContext);
  const review = session.review;
  const [place, setPlace] = useState<ReviewBoardPlace>(NO_PLACE);

  useEffect(() => {
    if (!review) return;

    const abort = new AbortController();

    // Optional context: a failed read shows none.
    review
      .place()
      .then((read) => {
        if (!abort.signal.aborted) setPlace(read);
      })
      .catch(() => {});

    return () => abort.abort();
  }, [review, displayedVersion]);

  return place;
}

const NO_PLACE: ReviewBoardPlace = { siblings: [] };

/**
 * The board's header: for a child, its parent and its place among the
 * parent's children; the title; then one faint line with the PR, the
 * compared branches, the diff and when the board was updated.
 */
export function ReviewDocumentMetaLine({
  children,
}: {
  children?: ReactNode;
}): ReactElement {
  const session = useReviewSession();
  const displayedVersion = useContext(DisplayedReviewVersionContext);
  const diffFiles = useReviewDiffFiles();
  const place = useBoardPlace();

  const review = session.review!;

  const [relativeTimeNowMs, setRelativeTimeNowMs] = useState<number | null>(
    null,
  );

  useEffect(() => {
    setRelativeTimeNowMs(Date.now());
  }, [displayedVersion]);

  const diff =
    review.pins && diffFiles.status === "loaded"
      ? reviewDiffStats(diffFiles)
      : null;

  const updatedLabel =
    Number.isFinite(review.updatedAtMs) && relativeTimeNowMs != null
      ? relativeTimeLabel(review.updatedAtMs, relativeTimeNowMs)
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

  if (updatedLabel)
    facts.push({
      key: "updated",
      node: <span {...stylex.props(styles.fixed)}>updated {updatedLabel}</span>,
    });

  return (
    // The attribute is a marker for tests.
    <header
      {...stylex.props(styles.header, drawStyles.blockChild)}
      data-review-document-header
    >
      <ReviewBreadcrumb place={place} reviewId={review.reviewId} />
      {children}
      {facts.length ? (
        <div {...stylex.props(styles.facts)} data-review-copy-ignore>
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

function reviewDiffStats(diff: {
  files?: { additions?: number; deletions?: number }[];
}): ReviewDiffStats | null {
  if (!diff.files?.length) return null;

  return summarizeReviewDiffFiles(diff.files);
}

function relativeTimeLabel(timeMs: number, nowMs: number): string | null {
  if (!Number.isFinite(timeMs)) return null;
  const minutes = Math.floor(Math.max(0, nowMs - timeMs) / 60_000);

  if (minutes < 1) return "just now";

  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);

  if (days < 7) return `${days}d ago`;

  return new Date(timeMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const styles = stylex.create({
  header: {
    width: `min(100%, ${tokens.reviewProseMaxWidth})`,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    paddingBottom: "28px",
    font: `${fontSize.body}/18px ${tokens.chromeFont}`,
    color: tokens.inkFaint,
  },
  // One line: branch names give way; the rest never does.
  facts: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
    paddingTop: "4px",
    whiteSpace: "nowrap",
  },
  fixed: { flexShrink: 0 },
});
