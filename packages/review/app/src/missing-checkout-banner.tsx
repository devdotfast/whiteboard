import { Button } from "@canvas/ui/button";
import { StatusBanner } from "@canvas/ui/status-banner";
import { type ReactElement, useState } from "react";

import { useReviewSession } from "./host/review-session";
import { useReviewActions, useReviewState } from "./review-context";

export const checkoutUnavailable = (host?: string) =>
  host
    ? `The checkout on ${host} is unavailable.`
    : "Local checkout unavailable.";

export function MissingCheckoutBanner({
  worktree,
}: {
  worktree: boolean;
}): ReactElement {
  const { dismissReview } = useReviewActions();
  const { submissionOutcome } = useReviewState();
  const host = useReviewSession().review?.host;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <StatusBanner
      action={
        !submissionOutcome && (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(undefined);

              try {
                await dismissReview();
              } catch (failure) {
                setError(
                  `Could not dismiss: ${failure instanceof Error ? failure.message : String(failure)}`,
                );
                setBusy(false);
              }
            }}
          >
            Dismiss review
          </Button>
        )
      }
    >
      {worktree
        ? "This review's worktree was removed."
        : checkoutUnavailable(host)}{" "}
      Showing the source saved with the review.
      {error && <span role="alert"> {error}</span>}
    </StatusBanner>
  );
}
