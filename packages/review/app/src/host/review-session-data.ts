import type { LoadedAgentTrace } from "@canvas/use-agent-trace";
import type {
  ReviewApiSummary,
  ReviewRemoteHostActions,
  ReviewStackLayer,
} from "@dev.fast/review-protocol";

export interface ReviewSessionData {
  trashedAt?: string | null;
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
  /** Moves the board to Trash, asking first when other boards need it.
   * False when the person kept it. */
  dismiss(): Promise<boolean>;
}
