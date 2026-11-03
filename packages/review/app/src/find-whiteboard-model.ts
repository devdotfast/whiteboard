import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { fuzzyRank } from "@review/fuzzy-match";

import {
  boardSearchLabels,
  repositoryLabel,
  worktreeLabel,
} from "./review-home-model";

/** How many boards the finder lists at most. */
export const FINDER_SHOWN = 60;

export interface FinderBoard {
  board: ReviewApiSummary;
  labels: string[];
}

/** The boards in the order the finder lists them, touched last first,
 * with what a query is matched against: Home's search labels and the PR's
 * number. Computed once per catalog. */
export function finderCatalog(
  boards: readonly ReviewApiSummary[],
): FinderBoard[] {
  const touched = (board: ReviewApiSummary) =>
    Math.max(
      Date.parse(board.createdAt) || 0,
      board.viewedAt ? Date.parse(board.viewedAt) || 0 : 0,
    );

  const number = (board: ReviewApiSummary) =>
    board.origin?.pullRequestNumber
      ? [`#${board.origin.pullRequestNumber}`]
      : [];

  return boards
    .map((board) => ({
      board,
      labels: [...boardSearchLabels(board), ...number(board)],
      touched: touched(board),
    }))
    .sort((left, right) => right.touched - left.touched)
    .map(({ board, labels }) => ({ board, labels }));
}

/** The rows for `query`: the boards it hits, best first, ties by recency;
 * every board, touched last first, without one. */
export function finderRows(
  catalog: readonly FinderBoard[],
  query: string,
): ReviewApiSummary[] {
  return fuzzyRank(query, catalog, ({ labels }) => labels)
    .slice(0, FINDER_SHOWN)
    .map(({ board }) => board);
}

/** The row's second line: where the board is, then its branch and PR. */
export function finderDetails(board: ReviewApiSummary): string[] {
  const { pullRequestNumber, branch } = board.origin ?? {};

  return [
    worktreeLabel(board) || repositoryLabel(board),
    branch,
    pullRequestNumber && `#${pullRequestNumber}`,
  ].filter((detail): detail is string => Boolean(detail));
}
