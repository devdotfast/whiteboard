import { fontSize, fontWeight, space } from "@canvas/scale.stylex";
import { Button } from "@canvas/ui/button";
import { TrashIcon } from "@canvas/ui/icons";
import { Popover } from "@canvas/ui/popover";
import { textStyles } from "@canvas/ui/text";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useRef, useState } from "react";

import { useReviewSession } from "./host/review-session";
import { useReviewActions, useReviewState } from "./review-context";
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";

export function ReviewCornerAction(): ReactElement | null {
  const { dismissReview } = useReviewActions();
  const { submissionOutcome } = useReviewState();
  const session = useReviewSession();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const control = useRef<HTMLDivElement>(null);

  // A finished review has nothing left to submit or dismiss.
  if (submissionOutcome === "dismissed" || session.review?.trashedAt)
    return null;

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);

    try {
      await dismissReview();
    } catch (error) {
      console.error("Review action failed", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={control} {...stylex.props(shellStyles.topbarItem, styles.action)}>
      <Button aria-busy={busy || undefined} onClick={() => void dismiss()}>
        <TrashIcon />
        <span>Move to Trash</span>
      </Button>
      {failed && (
        <Popover
          anchor={control}
          xstyle={[shellStyles.topbarPopover, textStyles.error, styles.error]}
          role="alert"
        >
          Could not move the whiteboard to Trash. Try again.
        </Popover>
      )}
    </div>
  );
}

// The single end-of-review control, sized to fit inside the topbar.
// Dismissal is terminal but reversible, so it reads as a quiet outline rather
// than a destructive fill. It never uses a bare X: that reads as "close".
const styles = stylex.create({
  action: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
  },
  // Only rendered in the topbar, where the popover placement positions it.
  error: {
    padding: `${space.s8} ${space.s12}`,
    font: `${fontWeight.regular} ${fontSize.small} ${tokens.chromeFont}`,
    whiteSpace: "nowrap",
  },
});
