import type { ShareBundle } from "@dev.fast/review-share-protocol";

const head = "a".repeat(40);

/** A shared board with a block of each kind a server renders, and a flow
 * diagram, which it leaves to the client. */
export const shareFixture: ShareBundle = {
  format: "review-share/2",
  reviewId: "ssr-board",
  version: 1,
  title: "Order status",
  snapshot: {
    reviewId: "ssr-board",
    version: 1,
    title: "Order status",
    pins: { repositoryId: "repo", base: head, head },
    createdAt: "2026-10-22T00:00:00.000Z",
    document: [
      {
        id: "intro",
        type: "markdown",
        markdown: "# Order status\n\n## Queueing\n\nOrders now queue.",
      },
      {
        id: "note",
        type: "callout",
        tone: "warning",
        title: "Careful",
        children: [
          { id: "note-body", type: "markdown", markdown: "Sent only once." },
        ],
      },
      { id: "peek", type: "code_peek", source: "head/order.ts#L1-L2" },
      { id: "shot", type: "image", assetId: "shot", alt: "The queue" },
      {
        id: "quote",
        type: "trace_quote",
        traceId: "trace",
        eventId: "said",
        text: "Queue it first",
      },
      {
        id: "flow",
        type: "flow_diagram",
        title: "Order flow",
        nodes: [
          { key: "write", label: "Write order" },
          { key: "send", label: "Send once" },
        ],
        edges: [{ from: "write", to: "send" }],
      },
    ],
  },
  images: {},
  traces: {
    trace: {
      label: "Planning",
      events: [{ id: "said", role: "assistant", text: "Queue it first." }],
    },
  },
  maps: {},
  commits: [],
  // Keyed as lens-selection's selectionKey keys a head range.
  selections: {
    [JSON.stringify(["order.ts", "head", 1, "head", 2])]: [
      { side: "head", file: "order.ts", fromLine: 1, toLine: 2 },
    ],
  },
  sources: [
    {
      kind: "excerpt",
      file: "order.ts",
      commit: head,
      fromLine: 1,
      lines: ['export const status = "<queued>";', "// sent once written"],
    },
  ],
};
