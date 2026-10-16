import {
  fontSize,
  fontWeight,
  leading,
  motion,
  radius,
  space,
} from "@canvas/scale.stylex";
import { Button, buttonStyles } from "@canvas/ui/button";
import { iconStyles } from "@canvas/ui/icon-styles";
import { ChevronDownIcon, StackIcon } from "@canvas/ui/icons";
import { Popover } from "@canvas/ui/popover";
import { textStyles } from "@canvas/ui/text";
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
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";

type OpenEvent = Pick<
  MouseEvent,
  "metaKey" | "ctrlKey" | "shiftKey" | "button"
>;

/** The stack this review belongs to, shown in every view. */
export function ReviewStackSelector(): ReactElement | null {
  const session = useReviewSession();
  const displayedVersion = useContext(DisplayedReviewVersionContext);
  const review = session.review!;
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  // The stack is optional context; a failed read is not shown.
  const layers =
    useQuery({
      queryKey: canvasQueryKeys.reviewStack(
        displayedVersion,
        review.pullRequestNumber ?? null,
        review.pullRequestUrl ?? null,
        review.headBranch ?? null,
      ),
      queryFn: ({ signal }) => review.stack(signal),
      enabled: Boolean(review.pullRequestNumber || review.headBranch),
      staleTime: 0,
    }).data ?? [];

  if (layers.length < 2) return null;

  const index = Math.max(
    0,
    layers.findIndex((layer) => layer.relation === "current"),
  );

  const openLayer = async (layer: ReviewStackLayer, event: OpenEvent) => {
    if (!openable(layer)) return;
    setOpen(false);

    const active = !(
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.button === 1
    );

    const reviewUuid =
      layer.reviewUuid ??
      (await review.createBranchReview(
        layer.branch,
        layer.base!,
        layer.subject ?? layer.branch,
      ));

    void session.surface.post({
      name: "openReview",
      args: { reviewUuid, active },
    });
  };

  return (
    <div ref={container} {...stylex.props(shellStyles.topbarItem)}>
      <Button
        xstyle={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Stack, ${index + 1} of ${layers.length}`}
        onClick={() => setOpen(!open)}
      >
        <StackIcon xstyle={[iconStyles.chrome, styles.triggerIcon]} />
        <span {...stylex.props(styles.triggerNumber, textStyles.truncate)}>
          {label(layers[index]!)}
        </span>
        <span {...stylex.props(styles.triggerPosition)}>
          {index + 1}/{layers.length}
        </span>
        <ChevronDownIcon xstyle={[styles.chevron, open && iconStyles.flip]} />
      </Button>
      {open && (
        <Popover
          anchor={container}
          onDismiss={() => setOpen(false)}
          role="menu"
          aria-label="Stack"
          xstyle={[shellStyles.topbarPopover, styles.menu]}
        >
          <div
            {...stylex.props(buttonStyles.reset, styles.row, styles.baseRow)}
          >
            <span {...stylex.props(styles.branch)}>main</span>
          </div>
          {layers.map((layer) => (
            <LayerRow
              key={layer.branch}
              layer={layer}
              onOpen={(layer, event) => void openLayer(layer, event)}
            />
          ))}
        </Popover>
      )}
    </div>
  );
}

const label = (layer: ReviewStackLayer) =>
  layer.pullRequestNumber ? `PR #${layer.pullRequestNumber}` : layer.branch;

/** A pull request opens only its existing review; a local branch can get one. */
const openable = (layer: ReviewStackLayer) =>
  Boolean(layer.reviewUuid || layer.base);

function LayerRow({
  layer,
  onOpen,
}: {
  layer: ReviewStackLayer;
  onOpen: (layer: ReviewStackLayer, event: OpenEvent) => void;
}): ReactElement {
  const current = layer.relation === "current";
  const disabled = !current && !openable(layer);
  const empty = !current && !layer.reviewUuid;

  const title = layer.pullRequestNumber
    ? `PR #${layer.pullRequestNumber}${layer.reviewTitle ? ` · ${layer.reviewTitle}` : ""}`
    : (layer.reviewTitle ?? layer.subject ?? layer.branch);

  const detail = [title !== layer.branch && layer.branch, empty && "No session"]
    .filter(Boolean)
    .join(" · ");

  const content = (
    <>
      <span {...stylex.props(styles.copy)}>
        <span
          {...stylex.props(
            textStyles.truncate,
            styles.title,
            current && styles.titleCurrent,
            disabled && styles.faint,
          )}
        >
          {title}
        </span>
        {detail && (
          <span
            {...stylex.props(
              textStyles.truncate,
              styles.branch,
              current && styles.branchCurrent,
            )}
          >
            {detail}
          </span>
        )}
      </span>
    </>
  );

  if (current) {
    return (
      <div
        {...stylex.props(buttonStyles.reset, styles.row, styles.rowCurrent)}
        aria-current="true"
      >
        {content}
      </div>
    );
  }

  return (
    <button
      {...stylex.props(buttonStyles.reset, styles.row, styles.rowButton)}
      type="button"
      data-relation={layer.relation}
      disabled={disabled}
      title={
        disabled
          ? "No generated session exists for this pull request"
          : empty
            ? "Create a session for this branch (Cmd/Ctrl-click to open in the background)"
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
    gap: space.s8,
    padding: `0 ${space.s8}`,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  triggerIcon: {
    color: tokens.inkMuted,
  },
  triggerNumber: {
    maxWidth: "200px",
    fontWeight: fontWeight.semibold,
  },
  triggerPosition: {
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    fontWeight: fontWeight.regular,
  },
  chevron: {
    color: tokens.inkFaint,
    transition: `transform ${motion.fast} ease-out`,
  },
  menu: {
    display: "flex",
    flexDirection: "column",
    minWidth: "280px",
    padding: space.s4,
    font: `${fontSize.ui}/${leading.px18} ${tokens.fontMono}`,
  },
  row: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    minHeight: "40px",
    padding: `${space.s4} ${space.s8}`,
    borderRadius: radius.control,
    color: tokens.ink,
    font: "inherit",
    textAlign: "left",
  },
  baseRow: {
    minHeight: "26px",
  },
  rowCurrent: {
    backgroundColor: `color-mix(in srgb, ${tokens.accent} 8%, ${tokens.surfaceRaised})`,
  },
  rowButton: {
    backgroundColor: {
      default: tokens.transparent,
      ":hover:not(:disabled)": tokens.tray,
    },
    cursor: { default: "pointer", ":disabled": "default" },
  },
  copy: {
    display: "flex",
    flex: "1 1 0",
    flexDirection: "column",
    gap: space.s2,
    minWidth: 0,
  },
  title: {
    fontSize: fontSize.small,
    lineHeight: leading.px16,
  },
  titleCurrent: {
    fontWeight: fontWeight.semibold,
  },
  branch: {
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    lineHeight: leading.px14,
  },
  branchCurrent: {
    color: tokens.inkMuted,
  },
  faint: {
    color: tokens.inkFaint,
  },
});
