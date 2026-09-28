import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import {
  type FlowDiagramBlock,
  flowDiagramSchema,
} from "../../src/review-api/blocks/flow_diagram";
import { BlockErrorBoundary } from "./blocks";
import { ReviewDebugSettingsProvider } from "./debug-settings";
import { settled } from "./fixture-review-bridge";
import { FlowGraph } from "./flow-graph";
import { ReviewSessionProvider } from "./host/review-session";
import { testReviewSession } from "./review-session-test-utils";

it.each([0, 1, 2, "all"])("renders after removing edge %s", async (removed) => {
  const container = document.createElement("div");
  document.body.append(container);
  const onError = vi.fn<() => void>();
  const root = createRoot(container, { onRecoverableError: onError });
  const session = testReviewSession();

  const block = flowDiagramSchema.parse({
    type: "flow_diagram",
    title: "Flow",
    nodes: ["a", "b", "c"].map((key) => ({ key, label: key, attachments: [] })),
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "c" },
    ],
  });

  const render = (block: FlowDiagramBlock) =>
    act(async () => {
      root.render(
        <ReviewSessionProvider session={session}>
          <ReviewDebugSettingsProvider>
            <BlockErrorBoundary
              block={{ ...block, id: "flow" }}
              onError={onError}
            >
              <FlowGraph block={block} onSelect={() => {}} />
            </BlockErrorBoundary>
          </ReviewDebugSettingsProvider>
        </ReviewSessionProvider>,
      );
    });

  try {
    await render(block);
    expect(
      await settled(
        () => container.querySelectorAll(".react-flow__edge").length === 3,
      ),
    ).toBe(true);
    await render({
      ...block,
      edges: block.edges.filter((_, i) => removed !== "all" && i !== removed),
    });
    expect(
      await settled(
        () =>
          container.querySelectorAll(".flow-node").length === 3 &&
          container.querySelectorAll(".react-flow__edge").length ===
            (removed === "all" ? 0 : 2),
      ),
    ).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
