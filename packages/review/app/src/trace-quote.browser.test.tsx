import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuoteMark } from "./highlighted-text";
import { ReviewPanelProvider, useReviewPanelStore } from "./review-panel";
import type { ReviewPanelStore } from "./review-panel-store";
import { TraceQuote } from "./trace-quote";

interface PanelStoreRef {
  current: ReviewPanelStore | null;
}

describe("TraceQuote", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }

    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("renders inert span when outside ReviewPanelProvider without breaking rules of hooks", () => {
    const html = renderToStaticMarkup(
      <TraceQuote sessionId="72b3d130-1234-5678-abcd-0123456789ab">
        Optimize database queries
      </TraceQuote>,
    );

    expect(html).toMatch(/^<span [^>]*><span [^>]*>Optimize/);
    expect(html).toContain("Optimize database queries");
  });

  it("renders active link when inside ReviewPanelProvider", () => {
    const html = renderToStaticMarkup(
      <ReviewPanelProvider>
        <TraceQuote sessionId="72b3d130-1234-5678-abcd-0123456789ab">
          Optimize database queries
        </TraceQuote>
      </ReviewPanelProvider>,
    );

    expect(html).toContain('<a href="#trace-');
    expect(html).toContain("Optimize database queries");
  });

  it("replaces the active panel when opened", async () => {
    const storeRef: PanelStoreRef = { current: null };

    function TestConsumer() {
      storeRef.current = useReviewPanelStore();

      return <TraceQuote sessionId="session-1">Inspect this trace</TraceQuote>;
    }

    await act(async () => {
      root?.render(
        <ReviewPanelProvider>
          <TestConsumer />
        </ReviewPanelProvider>,
      );
    });
    act(() =>
      storeRef.current?.getState().openPeek({
        kind: "peek",
        content: { kind: "inline-code", text: "start();" },
      }),
    );

    await act(async () => {
      container
        .querySelector<HTMLElement>('a[href^="#trace-"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(storeRef.current?.getState().active).toMatchObject({
      kind: "peek",
      content: {
        kind: "trace-quote",
        sessionId: "session-1",
        quote: "Inspect this trace",
      },
    });
  });

  it("scrolls to the target quote mark when already open", async () => {
    const scrollCalls: Element[] = [];
    Element.prototype.scrollIntoView = vi
      .fn<typeof Element.prototype.scrollIntoView>()
      .mockImplementation(function (this: Element) {
        scrollCalls.push(this);
      });

    const targetTurn = document.createElement("div");
    targetTurn.id = "review-trace-target-event";
    document.body.append(targetTurn);
    const markRoot = createRoot(targetTurn);
    await act(async () => markRoot.render(<QuoteMark>{null}</QuoteMark>));
    const quoteMark = targetTurn.firstElementChild!;

    let storeRef: ReturnType<typeof useReviewPanelStore> | null = null;

    function TestConsumer() {
      storeRef = useReviewPanelStore();

      return (
        <TraceQuote sessionId="session-1">Optimize database queries</TraceQuote>
      );
    }

    await act(async () => {
      root?.render(
        <ReviewPanelProvider>
          <TestConsumer />
        </ReviewPanelProvider>,
      );
    });

    // Manually open the quote so isOpen becomes true
    act(() => {
      storeRef?.getState().openPeek({
        kind: "peek",
        content: {
          kind: "trace-quote",
          sessionId: "session-1",
          quote: "Optimize database queries",
        },
      });
    });

    const link = container.querySelector('a[href^="#trace-"]') as HTMLElement;
    expect(link).not.toBeNull();

    // Click while already open
    await act(async () => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(scrollCalls).toContain(quoteMark);
  });
});
