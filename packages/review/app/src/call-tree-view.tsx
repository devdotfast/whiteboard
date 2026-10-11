import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import type { DiffSelection } from "@review/lens-selection";
import type { CallStackDiffBlock } from "@review/review-api/blocks/call_stack_diff";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { type CallTreeStop, callTreeStops } from "./call-tree";
import { CopyDiagramButton } from "./copy-diagram-button";
import { DiagramHeader } from "./diagram-header";
import { compactDiffCount as compact, diffCountStyles } from "./diff-count";
import { drawStyles } from "./draw-styles";
import { useReviewSession } from "./host/review-session";
import { callEdgeMarker } from "./markers.stylex";
import { useReviewLenses } from "./review-lenses";
import { useReviewPanel } from "./review-panel";
import { tokens } from "./tokens.stylex";
import { captureUiEvent } from "./ui-telemetry";

// Presentation retained from review-experimental's DiffWorkspace.
export function CallTree({
  block,
  onReveal,
  requireReady = false,
  currentStopId = null,
}: {
  block: CallStackDiffBlock;
  requireReady?: boolean;
  onReveal(source: DiffSelection, sectionId?: string, anchorId?: string): void;
  /** Set by a scroll-tracking host; otherwise the last clicked stop is current. */
  currentStopId?: string | null;
}) {
  const lenses = useReviewLenses();
  const stops = callTreeStops(block);
  const [clicked, setClicked] = useState<string>();
  const active = currentStopId ?? clicked;

  return (
    <nav aria-label="Call tree">
      <div {...stylex.props(styles.tree)}>
        {stops.map((stop, index) => {
          const availability = requireReady
            ? lenses?.availability(stop.sources)
            : "ready";

          const unavailable = availability !== "ready";
          const stats = lenses?.stats(lenses.resolve(stop.sources));

          const change =
            stats?.total.additions && stats?.total.deletions
              ? "modified"
              : stats?.total.additions
                ? "added"
                : stats?.total.deletions
                  ? "removed"
                  : "unchanged";

          return (
            <div {...stylex.props(styles.entry)} key={stop.id}>
              <TreeConnectors
                stop={stop}
                parentDistance={
                  index -
                  stops.findIndex((candidate) => candidate.id === stop.parentId)
                }
                onCallSite={() => {
                  if (
                    stop.callSite &&
                    (!requireReady ||
                      lenses?.availability([stop.callSite]) === "ready")
                  )
                    onReveal(stop.callSite, stop.id, stop.anchorId);
                }}
              />
              <button
                type="button"
                disabled={unavailable}
                style={{
                  paddingLeft: 14 + (stop.depth + 1) * 16,
                  opacity: unavailable ? 0.45 : undefined,
                }}
                {...stylex.props(
                  styles.row,
                  stop.id === active && styles.rowCurrent,
                )}
                data-review-anchor-id={stop.anchorId}
                aria-current={stop.id === active ? "true" : undefined}
                aria-label={`${stop.label}, ${change}`}
                title={
                  unavailable
                    ? availability === "pending"
                      ? "Waiting for diff…"
                      : "Source unavailable at these pins"
                    : [stop.label, stop.via].filter(Boolean).join(" · ")
                }
                onClick={() => {
                  setClicked(stop.id);
                  onReveal(stop.source, stop.id, stop.anchorId);
                }}
              >
                <span
                  {...stylex.props(
                    styles.name,
                    change !== "unchanged" && styles[change],
                  )}
                >
                  {stop.label}
                </span>
                {unavailable && (
                  <span {...stylex.props(styles.stats)}>
                    {availability === "pending" ? "…" : "Unavailable"}
                  </span>
                )}
                {!unavailable && stats && change !== "unchanged" && (
                  <span
                    {...stylex.props(styles.stats)}
                    title={`Remaining +${stats.remaining.additions} −${stats.remaining.deletions} · Total +${stats.total.additions} −${stats.total.deletions}`}
                  >
                    {stats.state === "viewed" ? (
                      "✓"
                    ) : stats.state === "folded" ? (
                      "Folded"
                    ) : (
                      <>
                        <span {...stylex.props(diffCountStyles.added)}>
                          +{compact(stats.remaining.additions)}
                        </span>
                        <span {...stylex.props(diffCountStyles.removed)}>
                          −{compact(stats.remaining.deletions)}
                        </span>
                      </>
                    )}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function TreeConnectors({
  stop,
  parentDistance,
  onCallSite,
}: {
  stop: CallTreeStop;
  parentDistance: number;
  onCallSite: () => void;
}) {
  // The section title is the visual parent of every top-level call.
  const width = (stop.depth + 1) * 16;
  const branchX = stop.depth === 0 ? 0.5 : width - 10;

  return (
    <svg
      {...stylex.props(styles.connectors)}
      width={width}
      height="26"
      viewBox={`0 0 ${width} 26`}
    >
      {stop.branches.map((continues, index) =>
        continues ? (
          <path
            key={index}
            {...stylex.props(styles.path)}
            d={`M ${index === 0 ? 0.5 : index * 16 + 6} 0 V 26`}
          />
        ) : null,
      )}
      {!stop.last ? (
        <path {...stylex.props(styles.path)} d={`M ${branchX} 13 V 26`} />
      ) : null}
      <g
        role={stop.callSite ? "button" : undefined}
        tabIndex={stop.callSite ? 0 : undefined}
        aria-label={
          stop.callSite ? `Go to call site of ${stop.label}` : undefined
        }
        {...(stop.callSite
          ? stylex.props(callEdgeMarker, styles.edge)
          : undefined)}
        onClick={stop.callSite ? onCallSite : undefined}
        onKeyDown={
          stop.callSite
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onCallSite();
                }
              }
            : undefined
        }
      >
        <title>
          {stop.callSite
            ? `Go to call site of ${stop.label}`
            : "No call-site location recorded"}
        </title>
        <path
          {...stylex.props(styles.path)}
          d={`M ${branchX} 0 V 13 H ${width}`}
        />
        {stop.callSite ? (
          <>
            <path
              {...stylex.props(styles.path, styles.edgeHighlight)}
              d={`M ${branchX} ${-(parentDistance - 1) * 26} V 13 H ${width}`}
            />
            <path
              {...stylex.props(styles.path, styles.edgeHit)}
              d={`M ${branchX} 0 V 13 H ${width}`}
            />
          </>
        ) : null}
      </g>
    </svg>
  );
}

/** Document host: the same tree, with source peeks instead of diff navigation. */
export function DocumentCallTree({ block }: { block: CallStackDiffBlock }) {
  const session = useReviewSession();
  const openPeek = useReviewPanel((state) => state.openPeek);

  return (
    <figure
      {...stylex.props(styles.figure, drawStyles.blockChild)}
      data-review-call-stack="ready"
    >
      <DiagramHeader
        kind="Call tree"
        title={block.title ?? "Call tree"}
        action={<CopyDiagramButton />}
      />
      <CallTree
        block={block}
        onReveal={(source, sectionId, anchorId) => {
          captureUiEvent(session, "peek_opened", { via: "call_stack_frame" });

          const stop = callTreeStops(block).find(
            (stop) => stop.id === sectionId,
          )!;

          openPeek({
            kind: "peek",
            anchor: {
              id: anchorId ?? sectionId!,
              title: stop.label,
              peek: source,
            },
            content: { kind: "source", source },
          });
        }}
      />
    </figure>
  );
}

const styles = stylex.create({
  figure: {
    margin: "14px 0",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    overflow: "hidden",
    backgroundColor: tokens.surface,
  },
  tree: {
    minWidth: "100%",
    width: "100%",
    padding: "6px 0 12px",
  },
  // A hovered or focused call-site edge paints over the rows below it.
  entry: {
    position: "relative",
    zIndex: {
      default: null,
      [stylex.when.descendant(":hover", callEdgeMarker)]: 1,
      [stylex.when.descendant(":focus-visible", callEdgeMarker)]: 1,
    },
  },
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    width: "100%",
    height: "26px",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    padding: "0 12px 0 14px",
    backgroundColor: {
      default: "transparent",
      ":hover:not(:disabled)": `color-mix(in srgb, ${tokens.ink} 3%, transparent)`,
    },
    font: `${fontSize.body}/26px ${tokens.fontMono}`,
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  rowCurrent: {
    backgroundColor: tokens.markerTint,
    fontWeight: fontWeight.semibold,
  },
  name: {
    flex: "0 1 auto",
    minWidth: "32px",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  added: {
    color: tokens.changeAdded,
  },
  removed: {
    color: tokens.changeRemoved,
    textDecorationLine: "line-through",
    textDecorationColor: `color-mix(in srgb, ${tokens.changeRemoved} 50%, transparent)`,
  },
  modified: {
    color: tokens.changeModified,
  },
  stats: {
    display: "inline-flex",
    gap: "5px",
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
    marginLeft: "auto",
    paddingLeft: "12px",
    fontSize: fontSize.micro,
  },
  connectors: {
    flexShrink: 0,
    alignSelf: "stretch",
    position: "absolute",
    left: "14px",
    top: 0,
    zIndex: 1,
    pointerEvents: "none",
    overflow: "visible",
  },
  path: {
    stroke: tokens.ruleSoft,
    fill: "none",
    strokeWidth: "1",
  },
  edge: {
    pointerEvents: "auto",
    cursor: "pointer",
  },
  edgeHit: {
    stroke: "transparent",
    strokeWidth: "10px",
  },
  edgeHighlight: {
    visibility: {
      default: "hidden",
      [stylex.when.ancestor(":hover", callEdgeMarker)]: "visible",
      [stylex.when.ancestor(":focus-visible", callEdgeMarker)]: "visible",
    },
    pointerEvents: "none",
    stroke: {
      default: tokens.ruleSoft,
      [stylex.when.ancestor(":hover", callEdgeMarker)]: tokens.ink,
      [stylex.when.ancestor(":focus-visible", callEdgeMarker)]: tokens.ink,
    },
    strokeWidth: {
      default: "1",
      [stylex.when.ancestor(":hover", callEdgeMarker)]: "2px",
      [stylex.when.ancestor(":focus-visible", callEdgeMarker)]: "2px",
    },
  },
});
