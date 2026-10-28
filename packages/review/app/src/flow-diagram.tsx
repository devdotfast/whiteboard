import { fontSize, leading, radius, space } from "@canvas/scale.stylex";
import { Button } from "@canvas/ui/button";
import { surfaceStyles } from "@canvas/ui/surface";
import {
  type FlowDiagramBlock,
  nodeSources,
} from "@dev.fast/whiteboard-document";
import type { Snapshot } from "@review/review-api/store";
import * as stylex from "@stylexjs/stylex";
import { useMemo } from "react";
import { createPortal } from "react-dom";

import { DiagramHeader } from "./diagram-header";
import { diagramStyles } from "./diagram-styles";
import { DiagramTourOverlay, useDiagramTourShell } from "./diagram-tour";
import { drawStyles } from "./draw-styles";
import { FlowGraph } from "./flow-graph";
import { countLabel } from "./format";
import { documentMarker } from "./markers.stylex";
import { useReviewLenses } from "./review-lenses";
import { useReviewPanel, useReviewPanelStore } from "./review-panel";
import type { GuidedTour, GuidedTourStop } from "./review-panel-model";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { useDiagramSelection } from "./use-diagram-selection";

/** Each attachment is a tour stop; selection still belongs to its graph node. */
export function flowTourStops(
  block: FlowDiagramBlock,
): (GuidedTourStop & { nodeKey: string })[] {
  return block.nodes.flatMap<GuidedTourStop & { nodeKey: string }>((node) => {
    const sources = nodeSources(node, block.pins);

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
              text: node.description,
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

  const sources = stops.flatMap((stop) =>
    stop.content.kind === "source" ? [stop.content.source] : [],
  );

  const lenses = useReviewLenses();
  const total = lenses?.stats(lenses.resolve(sources)).total;
  const changed = !!total && total.additions + total.deletions > 0;

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

  const {
    anchor: inlineAnchor,
    selectInline,
    figureRef,
  } = useDiagramSelection(tour, selection !== null);

  const selectedKey = stops.find(
    (stop) => stop.anchor.id === (selection?.anchor ?? inlineAnchor),
  )?.nodeKey;

  const open = (nodeKey?: string) => {
    const anchor = (
      nodeKey ? stops.find((stop) => stop.nodeKey === nodeKey) : stops[0]
    )?.anchor.id;

    if (nodeKey && anchor && selectInline(anchor)) return;

    if (anchor)
      panelStore
        .getState()
        .openOverlayTour({ tourId: tour.id, kind: "flow" }, anchor);
  };

  const figure = (fullscreen: boolean) => (
    // The class is how document-embed-scroll.ts recognizes the embed.
    <figure
      ref={fullscreen ? undefined : figureRef}
      {...withClass(
        "flow-diagram",
        surfaceStyles.card,
        styles.figure,
        fullscreen && styles.stage,
        drawStyles.blockChild,
      )}
      aria-label={node.title}
    >
      <DiagramHeader
        kind="FLOW"
        title={node.title}
        meta={countLabel(node.nodes.length, "node")}
        action={
          <Button
            className="diagram-tour-button"
            xstyle={diagramStyles.button}
            onClick={() => (fullscreen ? close() : open())}
            aria-label={
              fullscreen ? "Close expanded diagram" : "Expand diagram"
            }
          >
            {fullscreen ? "Close" : "Expand"}
          </Button>
        }
      />
      {node.description && (
        <p {...stylex.props(styles.description)}>{node.description}</p>
      )}
      <div {...stylex.props(styles.body, fullscreen && styles.stageBody)}>
        <div {...stylex.props(styles.canvas)}>
          <FlowGraph
            block={node}
            selectedKey={selectedKey}
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
      {(footerHint(sources.length > 0, fullscreen) || changed) && (
        <footer {...stylex.props(styles.footer)}>
          <span>{footerHint(sources.length > 0, fullscreen)}</span>
          {changed && (
            <span {...stylex.props(styles.legend)}>
              <i {...stylex.props(styles.swatch, styles.added)} />
              Added
              <i {...stylex.props(styles.swatch, styles.removed)} />
              Removed
              <i {...stylex.props(styles.swatch, styles.modified)} />
              Modified
            </span>
          )}
        </footer>
      )}
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

const footerHint = (hasCode: boolean, fullscreen: boolean) =>
  [
    hasCode && "Select a node to explore its code",
    !fullscreen && "Pinch or ⌘/Ctrl + scroll to zoom",
  ]
    .filter(Boolean)
    .join(" · ");

const inDocument = () => stylex.when.ancestor(":is(*)", documentMarker);

const styles = stylex.create({
  figure: {
    margin: `${space.s18} 0 ${space.s4}`,
    color: tokens.ink,
    font: `${fontSize.body}/${leading.normal} ${tokens.fontMono}`,
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
    padding: `0 ${space.s16} ${space.s12}`,
    color: tokens.inkMuted,
    font: `${fontSize.small}/${leading.relaxed} ${tokens.chromeFont}`,
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
    gap: space.s12,
    padding: `${space.s8} ${space.s16}`,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
    backgroundColor: tokens.tray,
    color: tokens.inkMuted,
    font: `${fontSize.micro}/${leading.normal} ${tokens.chromeFont}`,
    fontSize: fontSize.small,
  },
  legend: {
    display: "flex",
    alignItems: "center",
    gap: space.s6,
  },
  swatch: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    marginLeft: space.s8,
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
