import {
  BaseEdge,
  type CoordinateExtent,
  type Edge,
  type EdgeProps,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
} from "@xyflow/react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

import type {
  FlowDiagramBlock,
  FlowDiagramNode,
} from "../../src/review-api/blocks/flow_diagram";
import {
  type CoverageProgress,
  coverageProgress,
} from "../../src/viewed-coverage";
import { useReviewDebugSettings } from "./debug-settings";
import { useMotionPhase } from "./draw-queue-provider";
import { ElementCountsText } from "./lens-counts";
import { useReviewLenses } from "./review-lenses";

/**
 * Every flow surface: the document block, the Diff sidebar lens and the
 * fullscreen tour. ELK lays the graph out; React Flow draws it in a box that
 * fits the whole drawing to itself, so a node landing at the bottom of a
 * tall layout is still inside the box the reader is looking at. Nodes are
 * DOM, edges are paths, so the draw queue's phases apply as they do to a
 * sequence diagram. A decision is a dashed box, a terminal a pill.
 */
export function FlowGraph({
  block,
  direction = block.direction,
  selectedKey,
  onSelect,
  requireReady = false,
  interactive = false,
  height = 340,
}: {
  block: FlowDiagramBlock;
  direction?: "down" | "right";
  selectedKey?: string | null;
  requireReady?: boolean;
  /** Pan and zoom by hand, for the fullscreen tour. */
  interactive?: boolean;
  height?: number | string;
  onSelect(node: FlowDiagramNode): void;
}) {
  const { theme } = useReviewDebugSettings();
  const [error, setError] = useState<string>();

  const [computed, setLayout] = useState<{
    block: FlowDiagramBlock;
    direction: typeof direction;
    layout: Layout;
  }>();

  const layout =
    computed?.block === block && computed.direction === direction
      ? computed.layout
      : cachedLayouts.get(block)?.get(direction);

  const frame = useRef<HTMLDivElement>(null);

  // The layout the reader has zoomed or panned by hand. A new layout is a
  // new drawing, so it starts from its fit again.
  const [movedLayout, setMovedLayout] = useState<Layout>();
  const moved = layout !== undefined && movedLayout === layout;

  useEffect(() => {
    let cancelled = false;
    setError(undefined);

    if (cachedLayouts.get(block)?.has(direction)) return;

    void layoutFlow(block, direction)
      .then((result) => {
        const byDirection = cachedLayouts.get(block) ?? new Map();
        cachedLayouts.set(block, byDirection.set(direction, result));

        if (!cancelled) setLayout({ block, direction, layout: result });
      })
      .catch((error) => {
        if (!cancelled) setError(String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [block, direction]);

  const nodes = useMemo<FlowNodeType[]>(
    () =>
      layout
        ? block.nodes.flatMap((node) => {
            const position = layout.nodes.get(node.key);

            if (!position) return [];

            return [
              {
                id: node.key,
                type: "flowNode",
                position,
                ...SIZE,
                draggable: false,
                selectable: false,
                data: {
                  node,
                  requireReady,
                  selected: selectedKey === node.key,
                  select: () => onSelect(node),
                },
              },
            ];
          })
        : [],
    [block, layout, requireReady, selectedKey, onSelect],
  );

  const edges = useMemo<FlowEdgeType[]>(
    () =>
      layout
        ? layout.edges.map((edge) => ({
            id: `${edge.index}:${edge.section}`,
            source: block.edges[edge.index]!.from,
            target: block.edges[edge.index]!.to,
            type: "flowEdge",
            selectable: false,
            markerEnd: ARROW,
            data: {
              unitId: block.edges[edge.index]!.id,
              label: edge.label,
              dashed: block.edges[edge.index]!.style === "dashed",
              points: edge.points,
            },
          }))
        : [],
    [block, layout],
  );

  // Inline, the drawing cannot be panned out of its frame: the view stops at
  // the drawing's padded edge, and centres it along an axis it fits within.
  const extent = useMemo<CoordinateExtent | undefined>(
    () =>
      layout && !interactive
        ? [
            [-PADDING, -PADDING],
            [layout.width + PADDING, layout.height + PADDING],
          ]
        : undefined,
    [layout, interactive],
  );

  if (error) return <p role="alert">Could not lay out diagram: {error}</p>;

  if (!layout) return <p className="lens-diagram-note">Laying out flow…</p>;

  return (
    <div
      ref={frame}
      className="lens-flow"
      style={{ height }}
      aria-label={block.title}
    >
      <ReactFlowProvider>
        <ReactFlow
          colorMode={theme}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          translateExtent={extent}
          onNodeClick={(_, node) => {
            if (node.type === "flowNode") node.data.select();
          }}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          panActivationKeyCode={null}
          // Inline, a drag pans only a flow the reader has already zoomed.
          panOnDrag={interactive || moved}
          // A hand-made move carries its event; the fit's own does not.
          onMove={(event) => {
            if (event) setMovedLayout(layout);
          }}
          // Inline, a plain wheel belongs to the document: React Flow then
          // zooms only on a pinch or Ctrl+wheel, and MetaWheelZoom adds Cmd.
          preventScrolling={interactive}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          {moved ? (
            <Panel position="top-right">
              <button
                className="diagram-tour-button"
                onClick={() => setMovedLayout(undefined)}
              >
                Reset view
              </button>
            </Panel>
          ) : (
            <FitToLayout layout={layout} frame={frame} />
          )}
          {!interactive && (
            <MetaWheelZoom
              frame={frame}
              onZoom={() => setMovedLayout(layout)}
            />
          )}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

const PADDING = 24;

// The fit never enlarges past 1:1; a reader zooming by hand may.
const MIN_ZOOM = 0.1;

const MAX_ZOOM = 2;

const ARROW = {
  type: MarkerType.ArrowClosed,
  width: 14,
  height: 14,
  color: "var(--ink-muted)",
};

/**
 * Fits the box to the layout: ELK reports the drawing's size, the frame
 * reports its own, so the viewport is set outright instead of asking React
 * Flow to measure nodes first. Refits on every layout and every resize,
 * animated once the first fit has landed. Never enlarges past 1:1. Mounted
 * only while the reader has not moved the view, so a zoom made by hand
 * survives a resize and Reset view brings the fit back.
 */
function FitToLayout({
  layout,
  frame,
}: {
  layout: Layout;
  frame: RefObject<HTMLDivElement | null>;
}) {
  const flow = useReactFlow();
  const fitted = useRef(false);

  useEffect(() => {
    const element = frame.current;

    if (!element) return;

    const fit = () => {
      const { width, height } = element.getBoundingClientRect();

      if (!width || !height) return;

      const zoom = Math.min(
        1,
        (width - PADDING * 2) / Math.max(1, layout.width),
        (height - PADDING * 2) / Math.max(1, layout.height),
      );

      void flow.setViewport(
        {
          x: (width - layout.width * zoom) / 2,
          y: (height - layout.height * zoom) / 2,
          zoom,
        },
        { duration: fitted.current ? 300 : 0 },
      );
      fitted.current = true;
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);

    return () => observer.disconnect();
  }, [flow, frame, layout]);

  return null;
}

/**
 * Cmd+wheel zooms about the pointer, as Ctrl+wheel does. React Flow reads a
 * wheel as a zoom only when it carries Ctrl, which is also how a pinch
 * arrives, so Cmd is handled here.
 */
function MetaWheelZoom({
  frame,
  onZoom,
}: {
  frame: RefObject<HTMLDivElement | null>;
  onZoom(): void;
}) {
  const store = useStoreApi();
  const zoomed = useRef(onZoom);
  zoomed.current = onZoom;

  useEffect(() => {
    const element = frame.current;

    if (!element) return;

    const zoom = (event: WheelEvent) => {
      if (!event.metaKey || event.ctrlKey) return;

      event.preventDefault();

      const {
        panZoom,
        transform: [x, y, from],
        width,
        height,
        translateExtent,
      } = store.getState();

      const box = element.getBoundingClientRect();

      const pointer = {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      };

      const to = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, from * 2 ** (-event.deltaY * 0.002)),
      );

      void panZoom?.setViewportConstrained(
        {
          x: pointer.x - ((pointer.x - x) * to) / from,
          y: pointer.y - ((pointer.y - y) * to) / from,
          zoom: to,
        },
        [
          [0, 0],
          [width, height],
        ],
        translateExtent,
      );
      zoomed.current();
    };

    element.addEventListener("wheel", zoom, { passive: false });

    return () => element.removeEventListener("wheel", zoom);
  }, [store, frame]);

  return null;
}

interface Layout {
  width: number;
  height: number;
  nodes: Map<string, { x: number; y: number }>;
  edges: {
    index: number;
    section: number;
    points: { x: number; y: number }[];
    label?: { text: string; x: number; y: number };
  }[];
}

const SIZE = { width: 210, height: 62 };

// So the tour's fullscreen copy draws on its first render.
const cachedLayouts = new WeakMap<
  FlowDiagramBlock,
  Map<"down" | "right" | undefined, Layout>
>();

// The label's 9px mono font, so ELK leaves room for it between layers.
const LABEL = { charWidth: 5.4, height: 12, maxLength: 28 };

const labelText = (label: string) =>
  label.length > LABEL.maxLength
    ? `${label.slice(0, LABEL.maxLength - 1)}…`
    : label;

async function layoutFlow(
  block: FlowDiagramBlock,
  direction: "down" | "right" | undefined,
): Promise<Layout> {
  const result = await new ELK().layout<ElkNode>({
    id: "flow",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction === "right" ? "RIGHT" : "DOWN",
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "44",
    },
    children: block.nodes.map((node) => ({ id: node.key, ...SIZE })),
    edges: block.edges.map((edge, index) => {
      const text = edge.label && labelText(edge.label);

      return {
        id: String(index),
        sources: [edge.from],
        targets: [edge.to],
        labels: text
          ? [
              {
                text,
                width: text.length * LABEL.charWidth,
                height: LABEL.height,
                // Beside the source, so the label widens its own gap
                // instead of getting a layer of its own.
                layoutOptions: { "elk.edgeLabels.placement": "TAIL" },
              },
            ]
          : [],
      };
    }),
  });

  return {
    width: result.width ?? 240,
    height: result.height ?? 100,
    nodes: new Map(
      result.children?.map((node) => [
        node.id,
        { x: node.x ?? 0, y: node.y ?? 0 },
      ]),
    ),
    edges: (result.edges ?? []).flatMap((edge) =>
      (edge.sections ?? []).map((section, index) => {
        const label = index ? undefined : edge.labels?.[0];

        return {
          index: Number(edge.id),
          section: index,
          points: [
            section.startPoint,
            ...(section.bendPoints ?? []),
            section.endPoint,
          ],
          label: label && {
            text: label.text ?? "",
            x: label.x ?? 0,
            y: (label.y ?? 0) + LABEL.height - 3,
          },
        };
      }),
    ),
  };
}

interface FlowNodeData extends Record<string, unknown> {
  node: FlowDiagramNode;
  requireReady: boolean;
  selected: boolean;
  select(): void;
}

type FlowNodeType = Node<FlowNodeData, "flowNode">;

interface FlowEdgeData extends Record<string, unknown> {
  unitId: string | undefined;
  label: { text: string; x: number; y: number } | undefined;
  dashed: boolean;
  points: { x: number; y: number }[];
}

type FlowEdgeType = Edge<FlowEdgeData, "flowEdge">;

const change = (progress: CoverageProgress) =>
  progress.total.additions && progress.total.deletions
    ? "modified"
    : progress.total.additions
      ? "added"
      : progress.total.deletions
        ? "removed"
        : "unchanged";

function FlowNode({ data }: NodeProps<FlowNodeType>) {
  const { node, requireReady, selected } = data;
  const lenses = useReviewLenses();
  const motion = useMotionPhase(node.id);

  const sources = node.attachments.flatMap((attachment) => attachment.sources);

  const availability = requireReady ? lenses?.availability(sources) : "ready";
  const unavailable = availability !== "ready";

  const progress =
    lenses?.stats(lenses.resolve(sources)) ?? coverageProgress([]);

  // The flow's onNodeClick handles the mouse; the keyboard lands here.
  const select = () => {
    if (!unavailable) data.select();
  };

  return (
    <div
      className={[
        "flow-node",
        "lens-flow-node",
        `lens-flow-node--${change(progress)}`,
        `lens-flow-node--${node.kind ?? "process"}`,
        selected ? "is-selected" : "",
        progress.state === "viewed" ? "is-viewed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ width: SIZE.width, height: SIZE.height }}
      role="button"
      tabIndex={unavailable ? -1 : 0}
      aria-disabled={unavailable}
      aria-pressed={selected}
      aria-label={node.label}
      data-review-unit-id={node.id}
      data-motion={motion}
      title={
        unavailable
          ? availability === "pending"
            ? "Waiting for diff…"
            : "Source unavailable at these pins"
          : `${node.label} · Total +${progress.total.additions} −${progress.total.deletions}`
      }
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="flow-node-handle"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="flow-node-handle"
      />
      <svg
        className="flow-node-shape"
        viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect
          pathLength={1}
          x={0.5}
          y={0.5}
          width={SIZE.width - 1}
          height={SIZE.height - 1}
          rx={node.kind === "terminal" ? SIZE.height / 2 : 6}
        />
      </svg>
      <div className="flow-node-text">
        <span className="flow-node-label">
          {node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label}
        </span>
        <span className="flow-node-caption lens-flow-caption">
          {unavailable ? (
            availability === "pending" ? (
              "…"
            ) : (
              "Unavailable"
            )
          ) : sources.length ? (
            <ElementCountsText progress={progress} />
          ) : (
            "Concept"
          )}
        </span>
      </div>
    </div>
  );
}

function FlowEdge({ id, data, markerEnd }: EdgeProps<FlowEdgeType>) {
  const motion = useMotionPhase(data?.unitId);

  if (!data) return null;

  const path = data.points
    .map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`)
    .join(" ");

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className="lens-flow-edge"
        // The arrowhead is the last stroke.
        markerEnd={
          motion === "outline" || motion === "stroke" ? undefined : markerEnd
        }
        strokeDasharray={data.dashed ? "6 4" : undefined}
        pathLength={1}
        interactionWidth={0}
        data-review-unit-id={data.unitId}
        data-motion={motion}
      />
      {data.label && (
        <text
          className="lens-flow-edge-label"
          x={data.label.x}
          y={data.label.y}
          data-motion={motion}
        >
          {data.label.text}
        </text>
      )}
    </>
  );
}

const nodeTypes = { flowNode: FlowNode };

const edgeTypes = { flowEdge: FlowEdge };
