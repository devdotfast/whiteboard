import { z } from "zod";

import { ReviewInputError } from "../input-error.js";
import {
  type DiffSelection,
  anchorSchema,
  anchorSelection,
} from "../lens-selection.js";
import {
  type BlockDefinition,
  defineBlock,
  elementPins,
  identity,
  label,
} from "./definition.js";

/** What a node stands for; each kind draws as its own shape, and a diagram
 * that mixes kinds gets a legend. `process` is the default. */
export const flowNodeKinds = [
  "process",
  "decision",
  "terminal",
  "client",
  "service",
  "external",
  "database",
  "queue",
  "cache",
] as const;

export const flowNodeKindSchema = z.enum(flowNodeKinds);

export type FlowNodeKind = z.infer<typeof flowNodeKindSchema>;

/** Nodes and edges are the diagram's children: each is its own edit target,
 * so an agent can draw a diagram one unit at a time. Edges still name nodes
 * by their diagram-local key. */
export const flowNodeSchema = z.strictObject({
  ...identity,
  type: z.literal("flow_node").default("flow_node"),
  key: label,
  label,
  description: z.string().optional(),
  kind: flowNodeKindSchema.optional(),
  attachments: z
    .array(
      z.strictObject({
        label,
        sources: z.array(anchorSchema).min(1),
        pins: elementPins,
      }),
    )
    .default([])
    .describe(
      "Code evidence for this node. Omit for nodes no code backs, such as start or exit states.",
    ),
});

export const flowEdgeSchema = z.strictObject({
  ...identity,
  type: z.literal("flow_edge").default("flow_edge"),
  from: label,
  to: label,
  label: z.string().optional(),
  style: z.enum(["solid", "dashed"]).optional(),
});

/** The edge a new node arrives with: `from` a node already drawn to this
 * one, or from this one `to` a node already drawn. Insert-time only; the
 * server stores it as an ordinary edge. */
export const flowLinkSchema = z.strictObject({
  from: label.optional(),
  to: label.optional(),
  label: z.string().optional(),
  style: z.enum(["solid", "dashed"]).optional(),
});

export const flowNodeInsertSchema = flowNodeSchema.extend({
  link: flowLinkSchema.optional(),
});

export const flowDiagramSchema = defineBlock("flow_diagram", {
  title: label,
  description: z.string().optional(),
  direction: z.enum(["right", "down"]).optional(),
  nodes: z.array(flowNodeSchema).min(1).max(100),
  edges: z.array(flowEdgeSchema).max(300),
  pins: elementPins,
});

export type FlowDiagramBlock = z.infer<typeof flowDiagramSchema>;

export type FlowDiagramNode = z.infer<typeof flowNodeSchema>;

/** A node's evidence, each anchor read at its attachment's pins, else the
 * diagram's. */
export function nodeSources(
  node: FlowDiagramNode,
  diagramPins: FlowDiagramBlock["pins"],
): { label: string; source: DiffSelection }[] {
  return node.attachments.flatMap((attachment) =>
    attachment.sources.map((anchor) => ({
      label: attachment.label,
      source: anchorSelection(anchor, attachment.pins ?? diagramPins),
    })),
  );
}

export type FlowDiagramEdge = z.infer<typeof flowEdgeSchema>;

export const flow_diagram = {
  type: "flow_diagram",
  reference: [
    "- flow_diagram {title, nodes: flow_node[] (1 to 100), edges: flow_edge[], description?, direction?: right|down, pins?}",
    "- flow_node {key, label, description?, kind?: process|decision|terminal|client|service|external|database|queue|cache, attachments?: {label, sources: anchor[], pins?}[], link?: {from or to, label?, style?}}",
    "A node's kind sets its shape, so a reader tells the parts apart at a glance: process (the default) is a step, decision a branch, terminal a start or end; client is a user-facing app or browser, service one of this codebase's own servers or workers, external a third-party service or API, database a durable store, queue a message queue or topic, cache an in-memory store. A diagram that mixes kinds draws a legend.",
    "- flow_edge {from, to (node keys), label?, style?: solid|dashed}",
  ],
  schema: flowDiagramSchema,
  check(block: FlowDiagramBlock) {
    const keys = new Set(block.nodes.map((node) => node.key));

    if (keys.size !== block.nodes.length)
      throw new ReviewInputError(
        "Flow node keys must be unique within the diagram.",
      );

    for (const edge of block.edges) {
      if (!keys.has(edge.from) || !keys.has(edge.to))
        throw new ReviewInputError(
          `Unknown flow endpoint: ${edge.from} → ${edge.to}`,
        );
    }
  },
} satisfies BlockDefinition<FlowDiagramBlock>;
