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

/** Every board, touched last first, with what a query matches: Home's
 * search labels and the PR number. */
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

/** The boards `query` hits, best first; all of them without a query. */
export function finderRows(
  catalog: readonly FinderBoard[],
  query: string,
): ReviewApiSummary[] {
  return fuzzyRank(query, catalog, ({ labels }) => labels)
    .slice(0, FINDER_SHOWN)
    .map(({ board }) => board);
}

/** The row's second line: worktree or repository, branch, PR. */
export function finderDetails(board: ReviewApiSummary): string[] {
  const { pullRequestNumber, branch } = board.origin ?? {};

  return [
    worktreeLabel(board) || repositoryLabel(board),
    branch,
    pullRequestNumber && `#${pullRequestNumber}`,
  ].filter((detail): detail is string => Boolean(detail));
}
