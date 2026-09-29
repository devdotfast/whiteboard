import { fontSize, radius } from "@canvas/scale.stylex";
import type { FlowDiagramBlock } from "@review/review-api/blocks/flow_diagram";
import type { Snapshot } from "@review/review-api/store";
import * as stylex from "@stylexjs/stylex";
import { useMemo } from "react";
import { createPortal } from "react-dom";

import { CopyDiagramButton } from "./copy-diagram-button";
import { DiagramHeader } from "./diagram-header";
import { diagramStyles } from "./diagram-styles";
import { DiagramTourOverlay, useDiagramTourShell } from "./diagram-tour";
import { drawStyles } from "./draw-styles";
import { FlowGraph } from "./flow-graph";
import { documentMarker } from "./markers.stylex";
import { useReviewPanel, useReviewPanelStore } from "./review-panel";
import type { GuidedTour, GuidedTourStop } from "./review-panel-model";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";

/** Each attachment is a tour stop; selection still belongs to its graph node. */
export function flowTourStops(
  block: FlowDiagramBlock,
): (GuidedTourStop & { nodeKey: string })[] {
  return block.nodes.flatMap<GuidedTourStop & { nodeKey: string }>((node) => {
    const sources = node.attachments.flatMap((attachment) =>
      attachment.sources.map((source) => ({ label: attachment.label, source })),
    );

    return sources.length
      ? sources.map(({ label, source }, index) => ({
          nodeKey: node.key,
          anchor: {
            id: `${block.id}:${node.key}:${index}`,
            title: node.label,
            peek: source,
          },
          label: node.label,
          detail: label,
          content: { kind: "source" as const, source: source },
        }))
      : [
          {
            nodeKey: node.key,
            anchor: { id: `${block.id}:${node.key}`, title: node.label },
            label: node.label,
            content: {
              kind: "explanation" as const,
              text: node.description ?? "This node has no code attachments.",
            },
          },
        ];
  });
}

export function FlowDiagram({
  node,
}: {
  node: FlowDiagramBlock & { id: string };
  snapshot: Snapshot;
}) {
  const stops = useMemo(() => flowTourStops(node), [node]);

  const tour = useMemo<GuidedTour>(
    () => ({ id: node.id, title: node.title, stops }),
    [node.id, node.title, stops],
  );

  const panelStore = useReviewPanelStore();

  const selection = useReviewPanel((state) =>
    state.overlayTour?.tourId === tour.id &&
    stops.some((stop) => stop.anchor.id === state.overlayTour!.anchor)
      ? state.overlayTour
      : null,
  );

  const { closeOverlayTour: close, moveOverlayTour } = panelStore.getState();

  const { portalTarget } = useDiagramTourShell(selection !== null, close);

  const selectedKey = stops.find(
    (stop) => stop.anchor.id === selection?.anchor,
  )?.nodeKey;

  const open = (nodeKey?: string) => {
    const anchor = (
      nodeKey ? stops.find((stop) => stop.nodeKey === nodeKey) : stops[0]
    )?.anchor.id;

    if (anchor)
      panelStore
        .getState()
        .openOverlayTour({ tourId: tour.id, kind: "flow" }, anchor);
  };

  const figure = (fullscreen: boolean) => (
    // The class is how document-embed-scroll.ts recognizes the embed.
    <figure
      {...withClass(
        "flow-diagram",
        styles.figure,
        fullscreen && styles.stage,
        drawStyles.blockChild,
      )}
      aria-label={node.title}
    >
      <DiagramHeader
        kind="FLOW"
        title={node.title}
        meta={`${node.nodes.length} ${node.nodes.length === 1 ? "node" : "nodes"}`}
        action={
          <>
            <CopyDiagramButton />
            <button
              {...withClass("diagram-tour-button", diagramStyles.control)}
              onClick={() => (fullscreen ? close() : open())}
              aria-label={
                fullscreen ? "Close expanded diagram" : "Expand diagram"
              }
            >
              {fullscreen ? "Close" : "Expand"}
            </button>
          </>
        }
      />
      {node.description && (
        <p {...stylex.props(styles.description)}>{node.description}</p>
      )}
      <div {...stylex.props(styles.body, fullscreen && styles.stageBody)}>
        <div {...stylex.props(styles.canvas)}>
          <FlowGraph
            block={node}
            selectedKey={fullscreen ? selectedKey : undefined}
            onSelect={(item) => open(item.key)}
            interactive={fullscreen}
            // Inline, a top-to-bottom flow stacks its layers and wants the
            // room; a left-to-right one reads fine shorter.
            height={
              fullscreen ? "100%" : node.direction === "right" ? 420 : 560
            }
          />
        </div>
      </div>
      <footer {...stylex.props(styles.footer)}>
        <span>
          Select a node to explore its code
          {!fullscreen && " · pinch or ⌘/Ctrl + scroll to zoom"}
        </span>
        <span {...stylex.props(styles.legend)}>
          <i {...stylex.props(styles.swatch, styles.added)} />
          Added
          <i {...stylex.props(styles.swatch, styles.removed)} />
          Removed
          <i {...stylex.props(styles.swatch, styles.modified)} />
          Modified
        </span>
      </footer>
    </figure>
  );

  return (
    <>
      {figure(false)}
      {selection && portalTarget
        ? createPortal(
            <DiagramTourOverlay
              flow
              tour={tour}
              activeAnchor={selection.anchor}
              revealRequest={selection.revealRequest}
              onClose={close}
              onActiveAnchorChange={moveOverlayTour}
            >
              {figure(true)}
            </DiagramTourOverlay>,
            portalTarget,
          )
        : null}
    </>
  );
}

const inDocument = () => stylex.when.ancestor(":is(*)", documentMarker);

const styles = stylex.create({
  figure: {
    overflow: "hidden",
    margin: "18px 0 4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.surface,
    color: tokens.ink,
    font: `${fontSize.body}/1.5 ${tokens.fontMono}`,
  },
  // The tour stage: the figure fills the overlay without its card chrome.
  stage: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    minHeight: 0,
    margin: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: 0,
  },
  // Keeps its caption type among document paragraphs.
  description: {
    margin: 0,
    padding: "0 16px 12px",
    color: tokens.inkMuted,
    font: `${fontSize.small}/1.6 ${tokens.fontMono}`,
    textAlign: { default: null, [inDocument()]: "left" },
  },
  body: {
    display: "flex",
    borderTopWidth: 0,
    borderTopStyle: "none",
  },
  stageBody: {
    flex: "1",
    minHeight: 0,
    maxHeight: "none",
  },
  canvas: {
    position: "relative",
    flex: "1",
    minWidth: 0,
    backgroundColor: tokens.surface,
    backgroundImage: tokens.boardGrid,
    backgroundRepeat: "repeat",
  },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "12px",
    padding: "9px 16px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
    backgroundColor: tokens.tray,
    color: tokens.inkMuted,
    font: `${fontSize.micro}/1.5 ${tokens.fontMono}`,
    fontSize: fontSize.small,
  },
  legend: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  swatch: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    marginLeft: "7px",
    borderRadius: radius.round,
  },
  added: {
    backgroundColor: tokens.changeAdded,
  },
  removed: {
    backgroundColor: tokens.changeRemoved,
  },
  modified: {
    backgroundColor: tokens.changeModified,
  },
});
