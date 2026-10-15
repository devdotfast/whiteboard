import { fontSize, fontWeight } from "@canvas/scale.stylex";
import { Button } from "@canvas/ui/button";
import { surfaceStyles } from "@canvas/ui/surface";
import { textStyles } from "@canvas/ui/text";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useRef, useState } from "react";

import { useReviewSession } from "./host/review-session";
import { type IconProps, TrashIcon } from "./icons";
import { useReviewActions, useReviewState } from "./review-context";
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";
import { useAnchoredPopover } from "./use-anchored-popover";

export function ReviewCornerAction(): ReactElement | null {
  const { dismissReview } = useReviewActions();
  const { submissionOutcome } = useReviewState();
  const session = useReviewSession();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const control = useRef<HTMLDivElement>(null);
  const errorPopover = useAnchoredPopover<HTMLSpanElement>(failed, control);

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
      <Button disabled={busy} onClick={() => void dismiss()}>
        <TrashIcon xstyle={styles.icon} />
        <span>Move to Trash</span>
      </Button>
      {failed && (
        <span
          ref={errorPopover}
          popover="manual"
          {...stylex.props(
            shellStyles.topbarPopover,
            surfaceStyles.popover,
            textStyles.error,
            styles.error,
          )}
          role="alert"
        >
          Could not move the whiteboard to Trash. Try again.
        </span>
      )}
    </div>
  );
}

export function ArchiveIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <svg
      {...stylex.props(xstyle)}
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
    >
      <rect x="1.6" y="2.6" width="12.8" height="3.4" rx="1" />
      <path d="M3 6v6.2a1.2 1.2 0 0 0 1.2 1.2h7.6A1.2 1.2 0 0 0 13 12.2V6" />
      <path d="M6.4 9h3.2" />
    </svg>
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
  icon: {
    fill: "none",
    stroke: "currentcolor",
    strokeWidth: "1.3",
    strokeLinejoin: "round",
  },
  // Only rendered in the topbar, where the popover placement positions it.
  error: {
    padding: "8px 12px",
    font: `${fontWeight.regular} ${fontSize.small} ${tokens.chromeFont}`,
    whiteSpace: "nowrap",
  },
});
