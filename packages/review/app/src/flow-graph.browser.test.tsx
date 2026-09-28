import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

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

it("draws a second copy of a laid-out flow without laying it out again", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const session = testReviewSession();

  const block = flowDiagramSchema.parse({
    type: "flow_diagram",
    title: "Flow",
    nodes: ["a", "b"].map((key) => ({ key, label: key, attachments: [] })),
    edges: [{ from: "a", to: "b" }],
  });

  const render = (copies: number) =>
    act(async () => {
      root.render(
        <ReviewSessionProvider session={session}>
          <ReviewDebugSettingsProvider>
            {Array.from({ length: copies }, (_, index) => (
              <FlowGraph key={index} block={block} onSelect={() => {}} />
            ))}
          </ReviewDebugSettingsProvider>
        </ReviewSessionProvider>,
      );
    });

  try {
    await render(1);
    expect(
      await settled(
        () => container.querySelectorAll(".flow-node").length === 2,
      ),
    ).toBe(true);
    await render(2);
    expect(container.textContent).not.toContain("Laying out flow");
    expect(container.querySelectorAll(".flow-node")).toHaveLength(4);
  } finally {
    await act(async () => root.unmount());
  }
});

describe("zooming a flow by hand", () => {
  const unmounts: (() => Promise<void>)[] = [];

  afterEach(async () => {
    // Release any modifier a failed test left held.
    await userEvent.keyboard("{/Control}{/Meta}");

    for (const unmount of unmounts.splice(0)) await unmount();
  });

  /** A flow inside a short scrolling document, as a review lays it out. */
  async function mountFlow({ interactive = false } = {}) {
    const scroller = document.createElement("div");
    scroller.style.cssText = "width: 900px; height: 500px; overflow: auto;";
    const host = document.createElement("div");
    const tail = document.createElement("div");
    tail.style.height = "2000px";
    scroller.append(host, tail);
    document.body.append(scroller);
    const root = createRoot(host);
    const onSelect = vi.fn<() => void>();

    const block = flowDiagramSchema.parse({
      type: "flow_diagram",
      title: "Flow",
      nodes: ["a", "b", "c"].map((key) => ({
        key,
        label: key,
        attachments: [],
      })),
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });

    await act(async () =>
      root.render(
        <ReviewSessionProvider session={testReviewSession()}>
          <ReviewDebugSettingsProvider>
            <FlowGraph
              block={block}
              interactive={interactive}
              height={460}
              onSelect={onSelect}
            />
          </ReviewDebugSettingsProvider>
        </ReviewSessionProvider>,
      ),
    );
    unmounts.push(() => act(async () => root.unmount()));

    const viewport = () => {
      const element = host.querySelector(".react-flow__viewport");

      if (!element) return { x: 0, y: 0, zoom: 0 };

      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);

      return { x: matrix.e, y: matrix.f, zoom: matrix.a };
    };

    // Three nodes stacked in a 900 by 460 frame fit at 1:1, centred.
    expect(await settled(() => viewport().x > 0)).toBe(true);
    expect(viewport().zoom).toBe(1);

    const flow = host.querySelector<HTMLElement>(".lens-flow")!;

    return { scroller, flow, viewport, onSelect };
  }

  const wheel = (flow: HTMLElement, y: number) =>
    act(async () => userEvent.wheel(flow, { delta: { y } }));

  /**
   * Zooms to the 2:1 limit. React Flow reads a Ctrl wheel ten times faster on
   * macOS, so a smaller turn would land on a different zoom per platform.
   */
  const zoomIn = async (flow: HTMLElement) => {
    await userEvent.keyboard("{Control>}");
    await wheel(flow, -2000);
    await userEvent.keyboard("{/Control}");
  };

  /** Drags across the empty left edge of the frame, clear of the nodes. */
  const drag = (flow: HTMLElement, by: { x: number; y: number }) =>
    act(async () =>
      userEvent.dragAndDrop(flow, flow, {
        sourcePosition: { x: 40, y: 150 },
        targetPosition: { x: 40 + by.x, y: 150 + by.y },
      }),
    );

  it.each(["Control", "Meta"])(
    "zooms an inline flow on %s+wheel and leaves the document where it was",
    async (modifier) => {
      const { scroller, flow, viewport } = await mountFlow();

      await userEvent.keyboard(`{${modifier}>}`);
      await wheel(flow, -300);
      await userEvent.keyboard(`{/${modifier}}`);

      expect(await settled(() => viewport().zoom > 1)).toBe(true);
      expect(scroller.scrollTop).toBe(0);
    },
  );

  it("scrolls the document on a plain wheel over an inline flow", async () => {
    const { scroller, flow, viewport } = await mountFlow();
    const before = viewport();

    await wheel(flow, 300);

    expect(await settled(() => scroller.scrollTop > 0)).toBe(true);
    expect(viewport()).toEqual(before);
  });

  it("zooms the fullscreen flow on a plain wheel", async () => {
    const { scroller, flow, viewport } = await mountFlow({ interactive: true });

    await wheel(flow, 300);

    expect(await settled(() => viewport().zoom < 1)).toBe(true);
    expect(scroller.scrollTop).toBe(0);
  });

  it("does not pan an inline flow nobody has zoomed", async () => {
    const { flow, viewport } = await mountFlow();
    const before = viewport();

    await drag(flow, { x: 60, y: 40 });

    expect(viewport()).toEqual(before);
  });

  it("pans a zoomed inline flow by drag", async () => {
    const { flow, viewport } = await mountFlow();
    await zoomIn(flow);
    expect(await settled(() => viewport().zoom === 2)).toBe(true);
    const before = viewport();

    await drag(flow, { x: 0, y: 40 });

    expect(await settled(() => viewport().y !== before.y)).toBe(true);
    expect(viewport().y - before.y).toBeCloseTo(40, 0);
    expect(viewport().zoom).toBe(before.zoom);
  });

  it("keeps part of a zoomed flow in its frame however far it is dragged", async () => {
    const { flow, viewport } = await mountFlow();
    await zoomIn(flow);
    expect(await settled(() => viewport().zoom > 1)).toBe(true);

    for (let index = 0; index < 4; index++)
      await drag(flow, { x: 800, y: 300 });

    const frame = flow.getBoundingClientRect();

    const visible = [...flow.querySelectorAll(".flow-node")].some((node) => {
      const box = node.getBoundingClientRect();

      return (
        box.right > frame.left &&
        box.left < frame.right &&
        box.bottom > frame.top &&
        box.top < frame.bottom
      );
    });

    expect(visible).toBe(true);
  });

  it("keeps a zoom made by hand when the frame resizes", async () => {
    const { scroller, flow, viewport } = await mountFlow();
    await zoomIn(flow);
    expect(await settled(() => viewport().zoom > 1)).toBe(true);
    const before = viewport();

    scroller.style.width = "700px";
    // Longer than the 300ms a refit animates for.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await act(async () => {});

    expect(flow.getBoundingClientRect().width).toBe(700);
    expect(viewport()).toEqual(before);
  });

  it("returns a zoomed flow to its fit on Reset view", async () => {
    const { flow, viewport } = await mountFlow();
    const fit = viewport();
    expect(flow.querySelector("button")).toBeNull();
    await zoomIn(flow);
    expect(await settled(() => viewport().zoom > 1)).toBe(true);

    const reset = await settled(() =>
      [...flow.querySelectorAll("button")].find(
        (button) => button.textContent === "Reset view",
      ),
    );

    expect(reset).toBeDefined();
    // d3-zoom holds a wheel gesture open for 150ms after its last event and
    // credits any transform in that window to the wheel. Nobody clicks that
    // fast, so wait it out.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await act(async () => userEvent.click(reset!));

    expect(await settled(() => viewport().zoom === 1)).toBe(true);
    expect(viewport().x).toBeCloseTo(fit.x, 0);
    expect(viewport().y).toBeCloseTo(fit.y, 0);
    expect(flow.querySelector("button")).toBeNull();
  });

  it("still selects a node clicked in a zoomed inline flow", async () => {
    const { flow, viewport, onSelect } = await mountFlow();
    await zoomIn(flow);
    expect(await settled(() => viewport().zoom > 1)).toBe(true);

    await act(async () => userEvent.click(flow.querySelector(".flow-node")!));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
