import {
  fontSize,
  fontWeight,
  motion,
  radius,
  tracking,
} from "@canvas/scale.stylex";
import { Button } from "@canvas/ui/button";
import { surfaceStyles } from "@canvas/ui/surface";
import type { ReviewStackLayer } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import {
  type MouseEvent,
  type ReactElement,
  useContext,
  useRef,
  useState,
} from "react";

import { canvasQueryKeys } from "./canvas-query";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { useReviewSession } from "./host/review-session";
import { StackIcon } from "./icons";
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";
import { useAnchoredPopover } from "./use-anchored-popover";
import { useDismissOnOutside } from "./use-dismiss-on-outside";

type OpenEvent = Pick<
  MouseEvent,
  "metaKey" | "ctrlKey" | "shiftKey" | "button"
>;

/** The pull request stack this review belongs to, shown in every view. */
export function ReviewStackSelector(): ReactElement | null {
  const session = useReviewSession();
  const displayedVersion = useContext(DisplayedReviewVersionContext);
  const review = session.review!;
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const popoverRef = useAnchoredPopover(open, container);

  useDismissOnOutside(container, open, setOpen);

  // The pull request stack is optional context; a failed read is not shown.
  const layers =
    useQuery({
      queryKey: canvasQueryKeys.reviewStack(
        displayedVersion,
        review.pullRequestNumber ?? null,
        review.pullRequestUrl ?? null,
      ),
      queryFn: ({ signal }) => review.stack(signal),
      enabled: Boolean(review.pullRequestNumber),
      staleTime: 0,
    }).data ?? [];

  if (layers.length < 2) return null;

  const index = Math.max(
    0,
    layers.findIndex((layer) => layer.relation === "current"),
  );

  const openLayer = (layer: ReviewStackLayer, event: OpenEvent) => {
    if (!layer.reviewUuid) return;
    setOpen(false);
    void session.surface.post({
      name: "openReview",
      args: {
        reviewUuid: layer.reviewUuid,
        active: !(
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.button === 1
        ),
      },
    });
  };

  return (
    <div ref={container} {...stylex.props(shellStyles.topbarItem)}>
      <Button
        xstyle={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Pull request stack, ${index + 1} of ${layers.length}`}
        onClick={() => setOpen(!open)}
      >
        <StackIcon xstyle={styles.triggerIcon} />
        <span {...stylex.props(styles.triggerNumber)}>
          PR #{layers[index]!.pullRequestNumber}
        </span>
        <span {...stylex.props(styles.triggerPosition)}>
          {index + 1}/{layers.length}
        </span>
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          {...stylex.props(styles.chevron, open && styles.chevronOpen)}
        >
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </Button>
      {open && (
        <div
          ref={popoverRef}
          popover="manual"
          role="menu"
          aria-label="Pull request stack"
          {...stylex.props(
            shellStyles.topbarPopover,
            surfaceStyles.popover,
            styles.menu,
          )}
        >
          {layers.map((layer) => (
            <LayerRow
              key={layer.pullRequestNumber}
              layer={layer}
              onOpen={openLayer}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LayerRow({
  layer,
  onOpen,
}: {
  layer: ReviewStackLayer;
  onOpen: (layer: ReviewStackLayer, event: OpenEvent) => void;
}): ReactElement {
  const current = layer.relation === "current";
  const disabled = !current && !layer.reviewUuid;

  const content = (
    <>
      <span {...stylex.props(styles.copy)}>
        <span
          {...stylex.props(
            styles.ellipsis,
            styles.title,
            current && styles.titleCurrent,
            disabled && styles.faint,
          )}
        >
          PR #{layer.pullRequestNumber}
          {layer.reviewTitle ? ` · ${layer.reviewTitle}` : ""}
        </span>
        <span
          {...stylex.props(
            styles.ellipsis,
            styles.branch,
            current && styles.branchCurrent,
          )}
        >
          {layer.branch}
        </span>
      </span>
      <span {...stylex.props(styles.relation, current && styles.accent)}>
        {disabled ? "No session" : layer.relation}
      </span>
    </>
  );

  if (current) {
    return (
      <div {...stylex.props(styles.row, styles.rowCurrent)} aria-current="true">
        {content}
      </div>
    );
  }

  return (
    <button
      {...stylex.props(styles.row, styles.rowButton)}
      type="button"
      data-relation={layer.relation}
      disabled={disabled}
      title={
        disabled
          ? "No generated session exists for this pull request"
          : "Open session (Cmd/Ctrl-click to open in the background)"
      }
      onClick={(event) => onOpen(layer, event)}
      onAuxClick={(event) => {
        if (event.button === 1) onOpen(layer, event);
      }}
    >
      {content}
    </button>
  );
}

const styles = stylex.create({
  trigger: {
    gap: "7px",
    padding: "0 8px",
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  triggerIcon: {
    width: "14px",
    height: "14px",
    color: tokens.inkMuted,
  },
  triggerNumber: {
    fontWeight: fontWeight.semibold,
  },
  triggerPosition: {
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    fontWeight: fontWeight.regular,
  },
  chevron: {
    width: "12px",
    height: "12px",
    fill: "none",
    stroke: tokens.inkFaint,
    strokeWidth: "1.25",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    transition: `transform ${motion.fast} ease-out`,
  },
  chevronOpen: {
    transform: "rotate(180deg)",
  },
  menu: {
    display: "flex",
    flexDirection: "column",
    minWidth: "340px",
    padding: "7px",
    font: `${fontSize.ui}/18px ${tokens.fontMono}`,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    minHeight: "48px",
    padding: "7px 9px",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: radius.control,
    backgroundColor: "transparent",
    color: tokens.ink,
    font: "inherit",
    textAlign: "left",
  },
  rowCurrent: {
    backgroundColor: `color-mix(in srgb, ${tokens.accent} 8%, ${tokens.surfaceRaised})`,
  },
  rowButton: {
    backgroundColor: {
      default: "transparent",
      ":hover:not(:disabled)": tokens.tray,
    },
    cursor: { default: "pointer", ":disabled": "default" },
  },
  copy: {
    display: "flex",
    flex: "1 1 0",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  ellipsis: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  title: {
    fontSize: fontSize.small,
    lineHeight: "15px",
  },
  titleCurrent: {
    fontWeight: fontWeight.semibold,
  },
  branch: {
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    lineHeight: "14px",
  },
  branchCurrent: {
    color: tokens.inkMuted,
  },
  relation: {
    flex: "0 0 64px",
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    letterSpacing: tracking.chrome,
    lineHeight: "13px",
    textAlign: "right",
    textTransform: "uppercase",
  },
  accent: {
    color: tokens.accent,
  },
  faint: {
    color: tokens.inkFaint,
  },
});
