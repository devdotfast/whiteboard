import type { LoadedAgentTrace } from "@canvas/use-agent-trace";
import type {
  ReviewApiSummary,
  ReviewBoardPlace,
  ReviewRemoteHostActions,
  ReviewStackResponse,
} from "@dev.fast/review-protocol";

export interface ReviewSessionData {
  trashedAt?: string | null;
  reviewId: string;
  host?: string;
  hostState?: ReviewApiSummary["hostState"];
  hosts?: ReviewRemoteHostActions;
  available?: ReviewApiSummary["available"];
  /** Absent for a document whose references all carry their own pins. */
  pins?: { base: string; head: string };
  /** `worktree` when the head side is the checkout's working files rather
   * than the pinned head commit. */
  targetKind?: "worktree" | "commits" | "project";
  historicalRevision: string | null;
  updatedAtMs: number;
  /** Head branch captured with the displayed snapshot. */
  headBranch?: string;
  /** The target's base and head as written, a branch name or a commit. */
  baseRef?: string;
  headRef?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  traces: ReadonlyMap<string, LoadedAgentTrace>;
  /** Its parent, siblings and PR facts, read for its header. */
  place(): Promise<ReviewBoardPlace>;
  /** Changes whenever `place` would read something new. */
  placeRevision?: number;
  /** Its branch stack, apart from its place among boards. */
  stack(): Promise<ReviewStackResponse>;
  /** Creates an empty review of `branch` against `base` and returns its id:
   * a branch in the board's stack that has no whiteboard yet. */
  createBranchReview(
    branch: string,
    base: string,
    title: string,
  ): Promise<string>;
  /** Moves the board to Trash, asking first when other boards need it.
   * False when the person kept it. */
  dismiss(): Promise<boolean>;
}
