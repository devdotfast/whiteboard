import type { LoadedAgentTrace } from "@canvas/use-agent-trace";
import type { ReviewStackLayer } from "@dev.fast/review-protocol";

export interface ReviewSessionData {
  trashedAt?: string | null;
  /** Absent for a review. The scratchpad hides review-only chrome. */
  kind?: "scratchpad";
  /** Absent for a document whose references all carry their own pins. */
  pins?: { base: string; head: string };
  /** `worktree` when the head side is the checkout's working files rather
   * than the pinned head commit. */
  targetKind?: "worktree" | "commits";
  historicalRevision: string | null;
  updatedAtMs: number;
  /** Head branch captured with the displayed snapshot. */
  headBranch?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  traces: ReadonlyMap<string, LoadedAgentTrace>;
  stack(signal: AbortSignal): Promise<ReviewStackLayer[]>;
  /** Creates an empty review of `branch` against `base` and returns its id. */
  createBranchReview(
    branch: string,
    base: string,
    title: string,
  ): Promise<string>;
  dismiss(): Promise<void>;
}
