import { PullRequestStateIcon } from "@canvas/ui/board-icons";
import type {
  ReviewBoardPlace,
  ReviewDiffStats,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { DiffCountHalves, diffCountStyles } from "./diff-count";
import type { ReviewSessionData } from "./host/review-session-data";
import { tokens } from "./tokens.stylex";

/** A branch name as written, else the commit's short hash. A ref that
 * starts the commit is that commit's hash, not a name. */
const side = (ref: string | undefined, commit: string | undefined) =>
  ref && !commit?.startsWith(ref.toLowerCase()) ? ref : commit?.slice(0, 7);

/** The board's compared sides by branch name, with a short hash only for a
 * side that has none. */
function comparedSides(
  review: Pick<
    ReviewSessionData,
    "pins" | "targetKind" | "headBranch" | "baseRef" | "headRef"
  >,
  pullRequest: Pick<ReviewBoardPlace, "baseBranch" | "headBranch">,
) {
  return {
    base: pullRequest.baseBranch ?? side(review.baseRef, review.pins?.base),
    head:
      pullRequest.headBranch ??
      (review.headBranch?.trim() ||
        (review.targetKind === "worktree"
          ? "working copy"
          : side(review.headRef, review.pins?.head))),
  };
}

/** "[state] #612", a link to the PR on GitHub. */
export function PullRequestLink({
  review,
  place,
}: {
  review: ReviewSessionData;
  place: ReviewBoardPlace;
}): ReactElement | null {
  const number = review.pullRequestNumber;

  if (!number) return null;

  const content = (
    <>
      <PullRequestStateIcon
        number={number}
        state={place.pullRequestState}
        xstyle={styles.smallIcon}
      />
      #{number}
    </>
  );

  return review.pullRequestUrl ? (
    <a
      href={review.pullRequestUrl}
      target="_blank"
      rel="noopener noreferrer"
      {...stylex.props(styles.pullRequest, styles.link)}
    >
      {content}
    </a>
  ) : (
    <span {...stylex.props(styles.pullRequest)}>{content}</span>
  );
}

/**
 * "base ← head" by branch name, or the head alone when they match. Boards
 * without a PR lead with the commit icon.
 */
export function ComparedSides({
  review,
  place,
}: {
  review: ReviewSessionData;
  place: ReviewBoardPlace;
}): ReactElement | null {
  if (!review.pins) return null;
  const { base, head } = comparedSides(review, place);

  return (
    <span {...stylex.props(styles.compare)}>
      {review.pullRequestNumber ? null : (
        <svg
          aria-hidden="true"
          viewBox="0 0 14 14"
          {...stylex.props(styles.smallIcon, styles.commitIcon)}
        >
          <circle cx="7" cy="7" r="2.3" />
          <path d="M1.5 7 H4.7 M9.3 7 H12.5" />
        </svg>
      )}
      {base === head ? null : (
        <>
          <span title={base} {...stylex.props(styles.branch, styles.base)}>
            {base}
          </span>
          <span aria-label="against" {...stylex.props(styles.arrow)}>
            ←
          </span>
        </>
      )}
      <span title={head} {...stylex.props(styles.branch, styles.head)}>
        {head}
      </span>
    </span>
  );
}

export function DiffChanges({ diff }: { diff: ReviewDiffStats }): ReactElement {
  return (
    <span {...stylex.props(diffCountStyles.counts, styles.changes)}>
      <DiffCountHalves additions={diff.additions} deletions={diff.deletions} />
    </span>
  );
}

const styles = stylex.create({
  smallIcon: { flexShrink: 0, width: "12px", height: "12px" },
  // "#123", as a terminal would print it.
  pullRequest: {
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    gap: "4px",
    color: tokens.ink,
    fontFamily: tokens.fontMono,
  },
  // The app's link: the link color, underlined on hover.
  link: {
    color: tokens.accent,
    textDecoration: { default: "none", ":hover": "underline" },
  },
  compare: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    overflow: "hidden",
    color: tokens.inkMuted,
  },
  commitIcon: {
    fill: "none",
    stroke: tokens.inkMuted,
    strokeWidth: 1.2,
    strokeLinecap: "round",
  },
  // Each name keeps a few characters, so a squeezed side still reads.
  branch: {
    minWidth: "4ch",
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontFamily: tokens.fontMono,
  },
  // Shrink weights: the head's name gives way well before the base's.
  base: { flex: "0 1 auto" },
  head: { flex: "0 100 auto" },
  arrow: { flexShrink: 0, color: tokens.inkFaint },
  changes: { display: "inline-flex", flexShrink: 0, gap: "8px" },
});
