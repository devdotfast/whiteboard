import { PullRequestStateIcon } from "@canvas/ui/board-icons";
import { buttonLook } from "@canvas/ui/button";
import { iconStyles } from "@canvas/ui/icon-styles";
import { CommitIcon } from "@canvas/ui/icons";
import { textStyles } from "@canvas/ui/text";
import { useTooltip } from "@canvas/ui/tooltip";
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
      {...stylex.props(
        styles.pullRequest,
        buttonLook({ variant: "link", tone: "accent" }),
        styles.pullRequestLink,
      )}
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
  const { base, head } = comparedSides(review, place);
  const baseTooltip = useTooltip<HTMLSpanElement>(base ?? "");
  const headTooltip = useTooltip<HTMLSpanElement>(head ?? "");

  if (!review.pins) return null;

  return (
    <span {...stylex.props(styles.compare)}>
      {review.pullRequestNumber ? null : (
        <CommitIcon xstyle={iconStyles.inline} />
      )}
      {base === head ? null : (
        <>
          <span
            ref={baseTooltip}
            {...stylex.props(textStyles.truncate, styles.branch, styles.base)}
          >
            {base}
          </span>
          <span aria-label="against" {...stylex.props(styles.arrow)}>
            ←
          </span>
        </>
      )}
      <span
        ref={headTooltip}
        {...stylex.props(textStyles.truncate, styles.branch, styles.head)}
      >
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
  pullRequestLink: { gap: "4px" },
  compare: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    overflow: "hidden",
    color: tokens.inkMuted,
  },
  // Each name keeps a few characters, so a squeezed side still reads.
  branch: { minWidth: "4ch", fontFamily: tokens.fontMono },
  // Shrink weights: the head's name gives way well before the base's.
  base: { flex: "0 1 auto" },
  head: { flex: "0 100 auto" },
  arrow: { flexShrink: 0, color: tokens.inkFaint },
  changes: { display: "inline-flex", flexShrink: 0, gap: "8px" },
});
