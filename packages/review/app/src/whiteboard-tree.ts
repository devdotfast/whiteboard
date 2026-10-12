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

/** Whether a row shows the changed dot: it changed and isn't open, or, for
 * a collapsed parent, so did any of its children. */
export function showsChanged(
  branch: WhiteboardBranch,
  current: string,
  collapsed: boolean,
): boolean {
  const changed = (board: ReviewApiSummary) =>
    Boolean(board.changed) && board.reviewId !== current;

  return changed(branch.board) || (collapsed && branch.children.some(changed));
}

/** The open board's family: its parent and the parent's children in
 * order, or, for a top-level board, itself and its own children. */
export function boardFamily(
  boards: readonly ReviewApiSummary[],
  current: string,
): WhiteboardBranch | null {
  const byId = new Map(boards.map((board) => [board.reviewId, board]));
  const open = byId.get(current);

  if (!open) return null;
  const head = (open.parentId && byId.get(open.parentId)) || open;

  return {
    board: head,
    children: (head.children ?? []).flatMap((id) => {
      const child = byId.get(id);

      return child ? [child] : [];
    }),
  };
}

/** How many boards Recent lists before "Show N more". */
export const RECENT_SHOWN = 5;

/** The boards opened last in any project, newest first, without the open
 * one or any in Trash. */
export function recentBoards(
  boards: readonly ReviewApiSummary[],
  current: string,
): ReviewApiSummary[] {
  return boards
    .filter(
      (board) =>
        board.reviewId !== current && board.viewedAt && !board.trashedAt,
    )
    .sort(
      (left, right) => Date.parse(right.viewedAt!) - Date.parse(left.viewedAt!),
    );
}
