import { useOptionalReviewSession } from "@canvas/host/review-session";
import { useMutation } from "@tanstack/react-query";

/**
 * Tells the server what the animation's script did when it ran here: null
 * for a clean boot, or the error it threw. The script runs only in a canvas,
 * so this is how session_get shows the agent that wrote it. The session's
 * request names the version the canvas shows; the block's own data can be
 * older, kept while nothing it reads changes.
 */
export function useReportAnimationRun(
  reviewId: string,
  blockId: string | undefined,
): (error: string | null) => void {
  const session = useOptionalReviewSession();

  const { mutate } = useMutation({
    mutationFn: (error: string | null) =>
      session!.fetch("/animation-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockId, error }),
      }),
  });

  return (error) => {
    // Only for the board this canvas serves, and a block saved with an id.
    if (session?.reviewId === reviewId && blockId !== undefined) mutate(error);
  };
}
