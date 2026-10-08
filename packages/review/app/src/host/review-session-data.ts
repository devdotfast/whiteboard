import type { LoadedAgentTrace } from "@canvas/use-agent-trace";
import type {
  ReviewApiSummary,
  ReviewRemoteHostActions,
  ReviewStackLayer,
} from "@dev.fast/review-protocol";

export interface ReviewSessionData {
  /** Absent for a review. The scratchpad hides review-only chrome. */
  kind?: "scratchpad";
  host?: string;
  hostState?: ReviewApiSummary["hostState"];
  hosts?: ReviewRemoteHostActions;
  available?: ReviewApiSummary["available"];
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
  dismiss(): Promise<void>;
}
