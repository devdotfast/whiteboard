// Aliased: review stacks call their entries layers.
import {
  fontSize,
  fontWeight,
  motion,
  radius,
  layer as stackingLayer,
  tracking,
} from "@canvas/scale.stylex";
import { surfaceStyles } from "@canvas/ui/surface";
import {
  type ReviewDiffStats,
  type ReviewStackLayer,
  summarizeReviewDiffFiles,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import {
  Fragment,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { canvasQueryKeys } from "./canvas-query";
import { DiffCount } from "./diff-count";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { drawStyles } from "./draw-styles";
import { useReviewSession } from "./host/review-session";
import { ReviewBranchRange, WORKING_TREE } from "./review-branch-range";
import { useReviewDiffFiles } from "./review-diff-files-context";
import { tokens } from "./tokens.stylex";

interface ReviewDocumentMetaState {
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  updatedAtMs: number | null;
}

/**
 * Automatic document header: repository and PR identity above the title,
 * with one row of facts below it: saved branch, diff statistics and the
 * commit range, separated by dots.
 */
export function ReviewDocumentMetaLine({
  children,
}: {
  children?: ReactNode;
}): ReactElement {
  const session = useReviewSession();
  const displayedVersion = useContext(DisplayedReviewVersionContext);
  const diffFiles = useReviewDiffFiles();

  const review = session.review!;
  const meta = documentMetaState(review);

  const [relativeTimeNowMs, setRelativeTimeNowMs] = useState<number | null>(
    null,
  );

  useEffect(() => {
    setRelativeTimeNowMs(Date.now());
  }, [displayedVersion]);

  // The pull request stack is optional context; a failed read is not shown.
  const stackLayers =
    useQuery({
      queryKey: canvasQueryKeys.reviewStack(
        displayedVersion,
        meta.pullRequestNumber,
        meta.pullRequestUrl,
      ),
      queryFn: ({ signal }) => review.stack(signal),
      enabled: Boolean(meta.pullRequestNumber),
      staleTime: 0,
    }).data ?? [];

  const diff =
    diffFiles.status === "loaded" ? reviewDiffStats(diffFiles) : null;

  const updatedLabel =
    meta?.updatedAtMs != null && relativeTimeNowMs != null
      ? relativeTimeLabel(meta.updatedAtMs, relativeTimeNowMs)
      : null;

  const repository = meta.pullRequestUrl?.match(
    /^https:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\//,
  );

  const branch = review.headBranch?.trim() ? review.headBranch : null;

  const facts: { key: string; node: ReactNode }[] = [];

  if (branch) {
    facts.push({
      key: "branch",
      node: (
        <span {...stylex.props(styles.branch)} title={`Head branch: ${branch}`}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 20 20"
            aria-hidden="true"
            {...stylex.props(styles.icon, styles.branchIcon)}
          >
            <circle cx="5" cy="4.5" r="2" />
            <circle cx="5" cy="15.5" r="2" />
            <circle cx="15" cy="6.5" r="2" />
            <path d="M5 6.5v7M15 8.5c0 3-10 2-10 5" />
          </svg>
          <span {...stylex.props(styles.branchName)}>{branch}</span>
        </span>
      ),
    });
  }

  if (diff && review.pins) {
    facts.push({
      key: "files",
      node: (
        <span>
          {diff.fileCount === 1 ? "1 file" : `${diff.fileCount} files`}
        </span>
      ),
    });
    facts.push({
      key: "changes",
      node: (
        <span {...stylex.props(styles.row, styles.stats)}>
          <DiffCount
            additions={diff.additions}
            deletions={diff.deletions}
            large
          />
          {diff.additions + diff.deletions > 0 ? (
            <span {...stylex.props(styles.changeBar)} aria-hidden="true">
              {diff.additions > 0 ? (
                <span
                  {...stylex.props(styles.change)}
                  style={{ flexGrow: diff.additions }}
                />
              ) : null}
              {diff.deletions > 0 ? (
                <span
                  {...stylex.props(styles.change, styles.removed)}
                  style={{ flexGrow: diff.deletions }}
                />
              ) : null}
            </span>
          ) : null}
        </span>
      ),
    });
  }

  if (review.pins) {
    facts.push({
      key: "range",
      node: (
        <ReviewBranchRange
          baseRef={review.pins.base}
          headRef={
            review.targetKind === "worktree" ? WORKING_TREE : review.pins.head
          }
        />
      ),
    });
  }

  return (
    // The attribute is a marker: the document and the contents read whether
    // the document has a header.
    <header
      {...stylex.props(styles.header, drawStyles.blockChild)}
      data-review-document-header
    >
      <div {...stylex.props(styles.row, styles.top)} data-review-copy-ignore>
        <div {...stylex.props(styles.row, styles.identity)}>
          {repository ? (
            <span>
              {repository[1]} / {repository[2]}
            </span>
          ) : null}
          {repository && meta.pullRequestNumber != null ? (
            <span {...stylex.props(styles.separator)} aria-hidden="true">
              ·
            </span>
          ) : null}
          {meta.pullRequestNumber != null &&
            (meta.pullRequestUrl ? (
              <a
                href={meta.pullRequestUrl}
                target="_blank"
                rel="noopener noreferrer"
                {...stylex.props(styles.pullRequest, styles.pullRequestLink)}
              >
                PR #{meta.pullRequestNumber}
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  {...stylex.props(styles.icon)}
                >
                  <path d="M7 4h9v9M16 4 5 15" />
                </svg>
              </a>
            ) : (
              <span {...stylex.props(styles.pullRequest)}>
                PR #{meta.pullRequestNumber}
              </span>
            ))}
          {stackLayers.length > 1 ? (
            <>
              <span {...stylex.props(styles.separator)} aria-hidden="true">
                ·
              </span>
              <ReviewStackSelector layers={stackLayers} />
            </>
          ) : null}
        </div>
        {updatedLabel && (
          <span {...stylex.props(styles.updated)}>Updated {updatedLabel}</span>
        )}
      </div>
      {children}
      <div
        {...stylex.props(styles.row, styles.details)}
        data-review-copy-ignore
      >
        {withFactDots(facts)}
      </div>
    </header>
  );
}

/** Lay out header facts with a small dot between each present pair. */
function withFactDots(
  facts: readonly { key: string; node: ReactNode }[],
): ReactNode {
  return facts.map(({ key, node }, index) => (
    <Fragment key={key}>
      {index > 0 ? (
        <span {...stylex.props(styles.dot)} aria-hidden="true" />
      ) : null}
      {node}
    </Fragment>
  ));
}

function ReviewStackSelector({
  layers,
}: {
  layers: readonly ReviewStackLayer[];
}): ReactElement {
  const session = useReviewSession();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const currentIndex = layers.findIndex(
    (layer) => layer.relation === "current",
  );

  const position = currentIndex < 0 ? 1 : currentIndex + 1;

  const openLayer = (
    layer: ReviewStackLayer,
    event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey" | "button">,
  ) => {
    if (!layer.reviewUuid) return;
    detailsRef.current?.removeAttribute("open");
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
    <details {...stylex.props(styles.stack)} ref={detailsRef}>
      <summary {...stylex.props(styles.stackSummary)}>
        <span {...stylex.props(styles.stackPosition)}>
          {position} of {layers.length}
        </span>
        <span {...stylex.props(styles.stackLabel)}>stack</span>
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          {...stylex.props(styles.icon, styles.stackChevron)}
        >
          <path d="m3 4.5 3 3 3-3" {...stylex.props(styles.stackChevronPath)} />
        </svg>
      </summary>
      <div {...stylex.props(surfaceStyles.popover, styles.stackMenu)}>
        {layers.map((layer, index) => (
          <ReviewStackLayerRow
            key={layer.pullRequestNumber}
            layer={layer}
            position={index + 1}
            onOpen={openLayer}
          />
        ))}
      </div>
    </details>
  );
}

function ReviewStackLayerRow({
  layer,
  position,
  onOpen,
}: {
  layer: ReviewStackLayer;
  position: number;
  onOpen: (
    layer: ReviewStackLayer,
    event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey" | "button">,
  ) => void;
}): ReactElement {
  const current = layer.relation === "current";
  const disabled = !current && !layer.reviewUuid;

  const content = (
    <>
      <span {...stylex.props(styles.stackIndicator)}>
        <span
          {...stylex.props(
            styles.stackMarker,
            current && styles.stackMarkerCurrent,
            disabled && styles.stackFaint,
          )}
        >
          {position}
        </span>
      </span>
      <span {...stylex.props(styles.stackCopy)}>
        <span
          {...stylex.props(
            styles.stackEllipsis,
            styles.stackTitle,
            current && styles.stackTitleCurrent,
            disabled && styles.stackFaint,
          )}
        >
          PR #{layer.pullRequestNumber}
          {layer.reviewTitle ? ` · ${layer.reviewTitle}` : ""}
        </span>
        <span
          {...stylex.props(
            styles.stackEllipsis,
            styles.stackBranch,
            current && styles.stackBranchCurrent,
          )}
        >
          {layer.branch}
        </span>
      </span>
      <span
        {...stylex.props(
          styles.stackRelation,
          current && styles.stackRelationCurrent,
        )}
      >
        {!layer.reviewUuid && !current ? "No session" : layer.relation}
      </span>
    </>
  );

  if (current) {
    return (
      <div
        {...stylex.props(styles.stackRow, styles.stackRowCurrent)}
        aria-current="true"
      >
        {content}
      </div>
    );
  }

  return (
    <button
      {...stylex.props(styles.stackRow, styles.stackButton)}
      type="button"
      data-relation={layer.relation}
      disabled={!layer.reviewUuid}
      title={
        layer.reviewUuid
          ? "Open session (Cmd/Ctrl-click to open in the background)"
          : "No generated session exists for this pull request"
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

function documentMetaState(meta: {
  updatedAtMs?: number;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
}): ReviewDocumentMetaState {
  return {
    pullRequestNumber: meta.pullRequestNumber ?? null,
    pullRequestUrl: meta.pullRequestUrl ?? null,
    updatedAtMs: meta.updatedAtMs ?? null,
  };
}

function reviewDiffStats(diff: {
  files?: { additions?: number; deletions?: number }[];
}): ReviewDiffStats | null {
  if (!diff.files?.length) return null;

  return summarizeReviewDiffFiles(diff.files);
}

function relativeTimeLabel(timeMs: number, nowMs: number): string | null {
  if (!Number.isFinite(timeMs)) return null;
  const seconds = Math.max(0, Math.round((nowMs - timeMs) / 1000));

  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);

  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);

  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);

  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;

  return new Date(timeMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Paper's review header: identity, title, then source and diff metadata.
const styles = stylex.create({
  header: {
    width: `min(100%, ${tokens.reviewProseMaxWidth})`,
    margin: "28px auto 0",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    paddingBottom: "28px",
    font: `${fontSize.ui}/18px ${tokens.fontMono}`,
    color: tokens.inkFaint,
  },
  row: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
  },
  top: {
    justifyContent: "space-between",
    gap: "10px 24px",
  },
  identity: {
    gap: "10px",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  separator: {
    color: tokens.inkFaint,
  },
  updated: {
    marginLeft: "auto",
  },
  icon: {
    flexShrink: 0,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  pullRequest: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    color: tokens.accent,
    fontWeight: fontWeight.medium,
    textDecoration: "none",
  },
  pullRequestLink: {
    textDecoration: { default: "none", ":hover": "underline" },
  },
  // Facts in the details row are divided by small ink-faint dots.
  details: {
    gap: "8px 10px",
    paddingTop: "12px",
  },
  dot: {
    flex: "0 0 3px",
    width: "3px",
    height: "3px",
    borderRadius: radius.round,
    backgroundColor: tokens.inkFaint,
  },
  branch: {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    boxSizing: "border-box",
    minWidth: 0,
    minHeight: "26px",
    maxWidth: "100%",
    padding: "3px 10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.control,
    backgroundColor: tokens.well,
    color: tokens.ink,
    overflowWrap: "anywhere",
  },
  branchIcon: {
    color: tokens.inkFaint,
  },
  branchName: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  stats: {
    gap: "10px",
  },
  changeBar: {
    display: "flex",
    flex: "0 0 42px",
    gap: "2px",
    height: "8px",
  },
  change: {
    minWidth: "1px",
    borderRadius: radius.hairline,
    backgroundColor: tokens.changeAdded,
  },
  removed: {
    backgroundColor: tokens.changeRemoved,
  },
  stack: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "center",
    color: tokens.inkFaint,
  },
  stackSummary: {
    display: "flex",
    alignItems: "center",
    gap: "7px",
    height: "20px",
    padding: "0 8px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: tokens.rule,
      ":hover": `color-mix(in srgb, ${tokens.accent} 45%, ${tokens.ruleSoft})`,
    },
    borderRadius: radius.small,
    backgroundColor: { default: "transparent", ":hover": tokens.controlBg },
    color: tokens.ink,
    cursor: "pointer",
    fontSize: fontSize.small,
    listStyle: "none",
    "::-webkit-details-marker": {
      display: "none",
    },
  },
  stackPosition: {
    color: tokens.ink,
    fontSize: fontSize.small,
    fontWeight: fontWeight.semibold,
  },
  stackLabel: {
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    fontWeight: fontWeight.regular,
  },
  stackChevron: {
    width: "12px",
    height: "12px",
    color: tokens.inkFaint,
    transform: { default: null, ":is([open] > summary > *)": "rotate(180deg)" },
    transition: `transform ${motion.fast} ease-out`,
  },
  stackChevronPath: {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.25",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  stackMenu: {
    position: "absolute",
    zIndex: stackingLayer.popover,
    top: "calc(100% + 6px)",
    left: 0,
    display: "flex",
    flexDirection: "column",
    minWidth: "340px",
    padding: "7px",
  },
  stackRow: {
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
  stackRowCurrent: {
    backgroundColor: `color-mix(in srgb, ${tokens.accent} 8%, ${tokens.surfaceRaised})`,
  },
  stackButton: {
    backgroundColor: {
      default: "transparent",
      ":hover:not(:disabled)": tokens.tray,
    },
    cursor: { default: "pointer", ":disabled": "default" },
  },
  stackIndicator: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 24px",
    width: "24px",
  },
  stackMarker: {
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    width: "18px",
    height: "18px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.inkFaint,
    borderRadius: radius.round,
    color: tokens.inkMuted,
    fontSize: fontSize.micro,
    fontWeight: fontWeight.medium,
  },
  stackMarkerCurrent: {
    borderColor: `color-mix(in srgb, ${tokens.accent} 64%, ${tokens.ruleSoft})`,
    backgroundColor: `color-mix(in srgb, ${tokens.accent} 12%, transparent)`,
    color: tokens.accent,
    fontWeight: fontWeight.semibold,
  },
  stackCopy: {
    display: "flex",
    flex: "1 1 0",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  stackEllipsis: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  stackTitle: {
    color: tokens.ink,
    fontSize: fontSize.small,
    lineHeight: "15px",
  },
  stackTitleCurrent: {
    fontWeight: fontWeight.semibold,
  },
  stackBranch: {
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    lineHeight: "14px",
  },
  stackBranchCurrent: {
    color: tokens.inkMuted,
  },
  stackRelation: {
    flex: "0 0 64px",
    width: "64px",
    color: tokens.inkFaint,
    fontSize: fontSize.micro,
    letterSpacing: tracking.chrome,
    lineHeight: "13px",
    textAlign: "right",
    textTransform: "uppercase",
  },
  stackRelationCurrent: {
    color: tokens.accent,
  },
  stackFaint: {
    color: tokens.inkFaint,
  },
});
