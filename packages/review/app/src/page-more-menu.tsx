import { IconButton } from "@canvas/ui/button";
import type { ReviewView } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useRef, useState } from "react";

import { controlStyles } from "./controls-styles";
import { useCanvasMenu } from "./host/canvas-ui";
import { useReviewSession } from "./host/review-session";
import { MoreIcon } from "./icons";
import { useNotify } from "./notify";
import { useReviewActions, useReviewState } from "./review-context";
import { shellStyles } from "./shell-styles";
import { captureUiEvent } from "./ui-telemetry";
import { useTooltip } from "./use-tooltip";

/** A page bar icon folded into "⋯" where the bar is too narrow for it. */
export interface PageMoreFolded {
  id: string;
  label: string;
  onSelect(): void;
}

/**
 * The page bar's "⋯": the board's less frequent actions. The icons the bar
 * had no room for, Move to Trash, the views the sidebar
 * has no tab for, and the full source.
 */
export function PageMoreMenu({
  views,
  onShowView,
  folded = [],
}: {
  /** Offered views without a sidebar tab, such as Trace. */
  views: readonly { view: ReviewView; label: string }[];
  onShowView(view: ReviewView): void;
  folded?: readonly PageMoreFolded[];
}): ReactElement {
  const session = useReviewSession();
  const { dismissReview } = useReviewActions();
  const { submissionOutcome } = useReviewState();
  const tooltip = useTooltip("More");
  const notify = useNotify();
  // One move to Trash at a time; the menu can be reopened while one saves.
  const dismissing = useRef(false);
  const [busy, setBusy] = useState(false);

  const historical = Boolean(session.review?.historicalRevision);
  const finished = submissionOutcome !== null;

  const menu = useCanvasMenu({
    items: [
      ...folded.map(({ id, label }) => ({ id: `folded:${id}`, label })),
      ...(!historical && !finished
        ? [{ id: "trash", label: "Move to Trash", enabled: !busy }]
        : []),
      ...views.map(({ view, label }) => ({ id: `view:${view}`, label })),
      // A remote review keeps it, disabled while its host can't open one.
      {
        id: "source",
        label: "Source tree ↗",
        enabled: session.review?.available?.sourceWindows !== false,
      },
    ],
    onSelect: async (id) => {
      folded.find((item) => id === `folded:${item.id}`)?.onSelect();

      if (id === "trash" && !dismissing.current) {
        dismissing.current = true;
        setBusy(true);

        try {
          await dismissReview();
        } catch (error) {
          console.error("Review action failed", error);
          notify({
            kind: "error",
            text: "Could not move the whiteboard to Trash. Try again.",
          });
        } finally {
          dismissing.current = false;
          setBusy(false);
        }
      }

      if (id === "source") {
        captureUiEvent(session, "source_tree_opened", { via: "topbar" });
        // The desktop already showed why it failed.
        session.surface
          .post({ name: "openSourceTree", args: {} })
          .catch(() => undefined);
      }

      const view = views.find((each) => id === `view:${each.view}`);

      if (view) onShowView(view.view);
    },
  });

  return (
    <IconButton
      ref={tooltip}
      xstyle={shellStyles.topbarItem}
      aria-label="More"
      {...menu.triggerProps}
    >
      <MoreIcon xstyle={[controlStyles.chromeIcon, styles.dots]} />
    </IconButton>
  );
}

const styles = stylex.create({
  // The dots are points: a round cap on a zero-length stroke.
  dots: { strokeWidth: 2.6, strokeLinecap: "round" },
});
