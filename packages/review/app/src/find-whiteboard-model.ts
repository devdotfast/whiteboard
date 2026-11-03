import { type ReviewApiSummary, boardTitle } from "@dev.fast/review-protocol";
import { fuzzyRank } from "@review/fuzzy-match";

import { repositoryLabel, worktreeLabel } from "./review-home-model";

/** How many boards the finder lists before a query narrows them. */
export const FINDER_RECENT_SHOWN = 60;

/** The boards the finder lists for `query`: without one, the active boards
 * touched last; with one, those the query hits, best first, ties by
 * recency. Fields the query can hit: title, PR title and number, branch,
 * worktree and repository. */
export function finderBoards(
  boards: readonly ReviewApiSummary[],
  query: string,
): ReviewApiSummary[] {
  const touched = (board: ReviewApiSummary) =>
    Math.max(
      Date.parse(board.createdAt) || 0,
      board.viewedAt ? Date.parse(board.viewedAt) || 0 : 0,
    );

  const recent = boards
    .filter((board) => !board.trashedAt)
    .sort((left, right) => touched(right) - touched(left));

  if (!query.trim()) return recent.slice(0, FINDER_RECENT_SHOWN);

  return fuzzyRank(query, recent, finderLabels);
}

/** What the query is matched against, title first. */
export function finderLabels(board: ReviewApiSummary): string[] {
  const { pullRequestNumber, pullRequestTitle, branch } = board.origin ?? {};

  return [
    boardTitle(board.title),
    pullRequestTitle ?? "",
    pullRequestNumber ? `#${pullRequestNumber}` : "",
    branch ?? "",
    worktreeLabel(board),
    repositoryLabel(board),
  ].filter(Boolean);
}

/** The row's second line: where the board is, then its branch and PR. */
export function finderDetails(board: ReviewApiSummary): string[] {
  const { pullRequestNumber, branch } = board.origin ?? {};
  const place = worktreeLabel(board) || repositoryLabel(board);

  return [
    ...(place ? [place] : []),
    ...(branch ? [branch] : []),
    ...(pullRequestNumber ? [`#${pullRequestNumber}`] : []),
  ];
}
