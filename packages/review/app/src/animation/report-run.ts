import { useOptionalReviewSession } from "@canvas/host/review-session";
import { useMutation } from "@tanstack/react-query";

/**
 * Tells the server what the animation's script did when it ran here: null
 * for a clean boot, or the error it threw. The script runs only in a canvas,
 * so this is how session_get shows the agent that wrote it. The session's
 * request names the version the canvas shows; the block's own data can be
 * older, kept while nothing it reads changes.
 */
/** What a run reports: the error the script threw, or null, and for a
 * diagram what its stage found drawn wrong and how its claims stand. */
export interface StageRunReport {
  error: string | null;
  findings?: string[];
  claims?: {
    matches: number;
    changed: number;
    unlinked: number;
    changedLabels: string[];
    unlinkedLabels: string[];
  };
}

export function useReportAnimationRun(
  reviewId: string,
  blockId: string | undefined,
): (report: StageRunReport) => void {
  const session = useOptionalReviewSession();

  const { mutate } = useMutation({
    mutationFn: (report: StageRunReport) =>
      session!.fetch("/animation-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockId, ...report }),
      }),
  });

  return (report) => {
    // Only for the board this canvas serves, and a block saved with an id.
    if (session?.reviewId === reviewId && blockId !== undefined) mutate(report);
  };
}
