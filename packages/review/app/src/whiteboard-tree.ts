import type { ReviewApiSummary } from "@dev.fast/review-protocol";

/** A top-level row: a board and, for a parent, its children in order. */
export interface WhiteboardBranch {
  board: ReviewApiSummary;
  children: ReviewApiSummary[];
}

/** How many top-level boards show before "Show N more". */
export const WHITEBOARDS_SHOWN = 5;

const updated = (board: ReviewApiSummary) => Date.parse(board.createdAt);

const recency = ({ board, children }: WhiteboardBranch) =>
  Math.max(updated(board), ...children.map(updated));

/**
 * The project's boards as a tree: top-level boards by recency, a parent
 * ranking by its most recently updated member. Children
 * keep the server's sibling order. A child whose parent isn't listed shows
 * at top level.
 */
export function whiteboardTree(
  boards: readonly ReviewApiSummary[],
): WhiteboardBranch[] {
  const byId = new Map(boards.map((board) => [board.reviewId, board]));

  const branches = boards.flatMap((board) =>
    board.parentId && byId.has(board.parentId)
      ? []
      : [
          {
            board,
            children: (board.children ?? []).flatMap((id) => {
              const child = byId.get(id);

              return child ? [child] : [];
            }),
          },
        ],
  );

  return branches.sort((left, right) => recency(right) - recency(left));
}

/** The first WHITEBOARDS_SHOWN branches, and the branch holding the open
 * board wherever it falls. */
export function cappedTree(
  tree: readonly WhiteboardBranch[],
  current: string,
): WhiteboardBranch[] {
  return tree.filter(
    (branch, index) =>
      index < WHITEBOARDS_SHOWN ||
      branch.board.reviewId === current ||
      branch.children.some((child) => child.reviewId === current),
  );
}
