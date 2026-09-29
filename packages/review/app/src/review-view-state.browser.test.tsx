import type { AnchorRef } from "@review/authoring";
import {
  type ReactNode,
  type RefObject,
  act,
  createElement,
  useRef,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewSessionProvider } from "./host/review-session";
import { createReviewPanelStore } from "./review-panel-store";
import { testReviewSession } from "./review-session-test-utils";
import { writeReviewUiState } from "./review-ui-state";
import {
  clearPersistedReviewViewState,
  readPersistedReviewViewState,
  readReviewNavigationRestore,
  reviewViewStateKey,
  useReviewViewStateSync,
} from "./review-view-state";

type TestReviewSession = ReturnType<typeof testReviewSession>;

let root: ReturnType<typeof createRoot> | undefined;

let nextFrame = 1;

let frames = new Map<number, FrameRequestCallback>();

let resizeObservers = new Set<{ trigger(): void; disconnect(): void }>();

let observedElements = new Set<Element>();

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  nextFrame = 1;
  frames = new Map();
  resizeObservers = new Set();
  observedElements = new Set();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const frame = nextFrame;
    nextFrame += 1;
    frames.set(frame, callback);

    return frame;
  });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => {
    frames.delete(frame);
  });

  class TestResizeObserver implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {
      resizeObservers.add(this);
    }
    observe(target: Element): void {
      observedElements.add(target);
    }
    unobserve(): void {}
    disconnect(): void {
      resizeObservers.delete(this);
    }
    trigger(): void {
      this.callback([], this);
    }
  }

  vi.stubGlobal("ResizeObserver", TestResizeObserver);
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }

  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("review view state", () => {
  it("restores a selected commit and file using current commit metadata", () => {
    const session = testReviewSession();
    const store = createReviewPanelStore();

    const commit = {
      commit: "a".repeat(40),
      parentCommit: "b".repeat(40),
      subject: "Original title",
      author: "Author",
      authoredAt: "2026-09-29",
      fileCount: 1,
      additions: 2,
      deletions: 0,
    };

    renderViewState({ session, store });
    act(() => store.getState().openCommitDiff({ commit, file: "file.ts" }));
    unmount();

    const restored = createReviewPanelStore(
      readReviewNavigationRestore(session.config, {
        ...canvas,
        commits: [{ ...commit, subject: "Current metadata" }],
      }),
    );

    expect(restored.getState().view).toBe("diff");
    expect(restored.getState().diffScope).toEqual({
      commit: { ...commit, subject: "Current metadata" },
      file: "file.ts",
      restoreFile: true,
    });
    expect(
      readReviewNavigationRestore(session.config, { ...canvas, commits: [] })
        .diffScope,
    ).toBeNull();
  });

  it("restores trace identity and event without saving trace content", () => {
    const session = testReviewSession();
    const store = createReviewPanelStore();
    renderViewState({ session, store });
    act(() =>
      store
        .getState()
        .openTrace({ sessionId: "agent-a", trace: "subagent", eventIndex: 7 }),
    );
    unmount();

    const restored = createReviewPanelStore(
      readReviewNavigationRestore(session.config, canvas),
    );

    expect(restored.getState().view).toBe("trace");
    expect(restored.getState().traceSelection).toEqual({
      sessionId: "agent-a",
      trace: "subagent",
      eventIndex: 7,
    });
    restored.getState().setAvailableViews(["review", "diff"]);
    expect(restored.getState().view).toBe("review");
  });

  it("rejects malformed navigation identifiers", () => {
    const session = testReviewSession();
    storeState(session, {
      diffScope: { commit: "invalid", file: "file.ts" },
      trace: { sessionId: "agent", eventIndex: -5 },
    });
    expect(
      readPersistedReviewViewState(session.config).diffScope,
    ).toBeUndefined();
    expect(
      readPersistedReviewViewState(session.config).trace?.eventIndex,
    ).toBeUndefined();
  });

  it("does not restart scroll restoration when live session data changes", () => {
    const session = testReviewSession();
    storeState(session, { scrollTop: 100 });
    const harness = renderViewState({ session });

    act(() => {
      harness.element.scrollTop = 300;
      harness.element.dispatchEvent(new Event("scroll"));
    });
    flushNextFrame();
    expect(readPersistedReviewViewState(session.config).scrollTop).toBe(300);

    // The next scroll frame has not persisted yet when a live edit arrives.
    act(() => {
      harness.element.scrollTop = 350;
      harness.element.dispatchEvent(new Event("scroll"));
    });
    harness.renderSession({ ...session });
    expect(harness.element.scrollTop).toBe(350);
    flushNextFrame();
    expect(readPersistedReviewViewState(session.config).scrollTop).toBe(350);
  });

  it("clears transient state when a review input is recreated", () => {
    const session = testReviewSession();
    storeState(session, {
      scrollTop: 320,
      panel: { kind: "tour", tourId: "flow", activeAnchor: "second" },
    });

    clearPersistedReviewViewState(session.config);

    expect(readPersistedReviewViewState(session.config)).toEqual({});
  });

  it("flushes the final scroll position when cleanup cancels a pending frame", () => {
    const session = testReviewSession();
    const harness = renderViewState({ session });

    act(() => {
      harness.element.scrollTop = 180;
      harness.element.dispatchEvent(new Event("scroll"));
    });
    expect(frames.size).toBe(1);

    unmount();

    expect(readPersistedReviewViewState(session.config)).toEqual({
      scrollTop: 180,
      scrollView: "review",
    });
    expect(frames.size).toBe(0);
  });

  it("retries restoration while content grows, then restores the target", () => {
    const session = testReviewSession();
    const metrics = { scrollHeight: 200, clientHeight: 200 };
    storeState(session, { scrollTop: 320 });
    const harness = renderViewState({ session, metrics });

    expect(harness.element.scrollTop).toBe(0);
    expect(frames.size).toBe(0);
    expect(resizeObservers.size).toBe(1);

    metrics.scrollHeight = 700;
    triggerResize();

    expect(harness.element.scrollTop).toBe(320);
    expect(frames.size).toBe(0);
  });

  it("restores the scroll only on the view it was taken on", () => {
    const session = testReviewSession();
    // Older records carry no view: their scroll belongs to the whiteboard.
    storeState(session, { scrollTop: 320 });

    const diff = renderViewState({
      session,
      store: createReviewPanelStore({ view: "diff" }),
    });

    expect(diff.element.scrollTop).toBe(0);
    unmount();

    storeState(session, { scrollTop: 320, scrollView: "diff" });

    const resumed = renderViewState({
      session,
      store: createReviewPanelStore({ view: "diff" }),
    });

    expect(resumed.element.scrollTop).toBe(320);
  });

  it("stops restoring the scroll once the reader switches view", () => {
    const session = testReviewSession();
    const metrics = { scrollHeight: 200, clientHeight: 200 };
    storeState(session, { scrollTop: 320 });
    const harness = renderViewState({ session, metrics });

    act(() => harness.store.getState().showView("commits"));
    metrics.scrollHeight = 700;
    triggerResize();

    expect(harness.element.scrollTop).toBe(0);
  });

  it("keeps restoring after the old animation-frame retry window", () => {
    const session = testReviewSession();
    const metrics = { scrollHeight: 200, clientHeight: 200 };
    storeState(session, { scrollTop: 320 });
    const harness = renderViewState({ session, metrics });

    expect(frames.size).toBe(0);
    expect(resizeObservers.size).toBe(1);
    metrics.scrollHeight = 700;
    triggerResize();

    expect(harness.element.scrollTop).toBe(320);
    expect(resizeObservers.size).toBe(0);
  });

  it("watches the region's laid-out children for growth, not every descendant", () => {
    const session = testReviewSession();
    storeState(session, { scrollTop: 320 });

    const harness = renderViewState({
      session,
      metrics: { scrollHeight: 200, clientHeight: 200 },
      children: [
        createElement(
          "div",
          { key: "view", style: { display: "contents" } },
          createElement("nav", null, "toc"),
          createElement(
            "article",
            null,
            createElement("section", null, createElement("p", null, "peek")),
          ),
        ),
        createElement("aside", { key: "aside" }, "panel"),
      ],
    });

    const region = harness.element;

    expect(observedElements).toEqual(
      new Set([
        region,
        region.querySelector("nav")!,
        region.querySelector("article")!,
        region.querySelector("aside")!,
      ]),
    );
  });

  it("does not persist an intermediate programmatic scroll during restoration", () => {
    const session = testReviewSession();
    const metrics = { scrollHeight: 200, clientHeight: 200 };
    storeState(session, { scrollTop: 320 });
    const harness = renderViewState({ session, metrics });

    act(() => {
      harness.element.scrollTop = 0;
      harness.element.dispatchEvent(new Event("scroll"));
    });
    flushNextFrame();

    expect(readPersistedReviewViewState(session.config).scrollTop).toBe(320);
  });

  it.each(["wheel", "pointerdown", "touchstart"])(
    "permanently aborts pending restoration on %s input",
    (eventType) => {
      const session = testReviewSession();
      const metrics = { scrollHeight: 200, clientHeight: 200 };
      storeState(session, { scrollTop: 320 });
      const harness = renderViewState({ session, metrics });

      act(() => harness.element.dispatchEvent(new Event(eventType)));
      metrics.scrollHeight = 700;
      triggerResize();

      expect(harness.element.scrollTop).toBe(0);
    },
  );

  it("cancels pending restoration on navigation keys", () => {
    const session = testReviewSession();
    const metrics = { scrollHeight: 200, clientHeight: 200 };
    storeState(session, { scrollTop: 320 });
    const harness = renderViewState({ session, metrics });

    act(() =>
      harness.element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "PageDown" }),
      ),
    );
    metrics.scrollHeight = 700;
    triggerResize();

    expect(harness.element.scrollTop).toBe(0);
  });

  it("ignores layout scroll events while restoration is pending", () => {
    const session = testReviewSession();
    const metrics = { scrollHeight: 200, clientHeight: 200 };
    storeState(session, { scrollTop: 320 });
    const harness = renderViewState({ session, metrics });

    act(() => harness.element.dispatchEvent(new Event("scroll")));
    metrics.scrollHeight = 700;
    triggerResize();

    expect(harness.element.scrollTop).toBe(320);
  });

  it("does not write fallback state on a fresh mount", () => {
    const session = testReviewSession();
    renderViewState({ session });

    unmount();

    expect(
      window.localStorage.getItem(reviewViewStateKey(session.config)),
    ).toBe(null);
  });

  it("persists only resumable panel modes", () => {
    const session = testReviewSession();
    const store = createReviewPanelStore();
    renderViewState({ session, store });

    act(() =>
      store.getState().openPeek({
        kind: "peek",
        content: { kind: "inline-code", text: "start();" },
      }),
    );
    expect(readPersistedReviewViewState(session.config)).toEqual({});

    act(() =>
      store
        .getState()
        .openOverlayTour({ tourId: "flow", kind: "sequence" }, "second"),
    );
    expect(readPersistedReviewViewState(session.config)).toEqual({
      overlayTour: { tourId: "flow", activeAnchor: "second", kind: "sequence" },
    });
  });

  it("persists navigation without discarding a stored view the canvas could not offer", () => {
    const session = testReviewSession();
    storeState(session, { activeView: "map" });
    // The canvas opened without a map, so it started on the whiteboard.
    const store = createReviewPanelStore({ view: "review" });
    renderViewState({ session, store });

    act(() =>
      store
        .getState()
        .openOverlayTour({ tourId: "flow", kind: "sequence" }, "second"),
    );
    expect(readPersistedReviewViewState(session.config)).toMatchObject({
      activeView: "map",
      overlayTour: { tourId: "flow", activeAnchor: "second" },
    });

    act(() => store.getState().showView("diff"));
    expect(readPersistedReviewViewState(session.config)).toEqual({
      activeView: "diff",
    });
  });

  it("ignores a persisted Threads panel from an older build", () => {
    const legacySession = testReviewSession({ reviewId: "legacy-threads" });
    const legacyStore = createReviewPanelStore();
    storeState(legacySession, {
      panel: { kind: "threads" },
    });
    renderViewState({ session: legacySession, store: legacyStore });

    expect(legacyStore.getState().active).toBeNull();
    expect(readPersistedReviewViewState(legacySession.config).panel).toBe(
      undefined,
    );
  });

  it("restores the fullscreen tour a reader left open", () => {
    const session = testReviewSession();
    storeState(session, {
      activeView: "review",
      overlayTour: { tourId: "flow", activeAnchor: "second", kind: "sequence" },
    });

    expect(
      readReviewNavigationRestore(session.config, canvas).overlayTour,
    ).toEqual({
      tourId: "flow",
      kind: "sequence",
      anchor: "second",
      revealRequest: 0,
    });
  });

  it("restores a tour an older build stored as a panel", () => {
    const session = testReviewSession();
    storeState(session, {
      panel: { kind: "tour", tourId: "flow", activeAnchor: "second" },
    });

    expect(
      readReviewNavigationRestore(session.config, canvas).overlayTour,
    ).toEqual({
      tourId: "flow",
      kind: undefined,
      anchor: "second",
      revealRequest: 0,
    });
  });

  it("restores every view the switcher offers, and nothing else", () => {
    const session = testReviewSession();

    for (const view of ["review", "commits", "map", "diff", "trace"] as const) {
      storeState(session, { activeView: view });
      expect(readPersistedReviewViewState(session.config).activeView).toBe(
        view,
      );
    }

    storeState(session, { activeView: "files" });
    expect(
      readPersistedReviewViewState(session.config).activeView,
    ).toBeUndefined();
  });

  it("keys state by review identity", () => {
    const first = testReviewSession({ reviewId: "session-a" });

    const second = testReviewSession({ reviewId: "session-b" });

    expect(reviewViewStateKey(first.config)).not.toBe(
      reviewViewStateKey(second.config),
    );
    expect(reviewViewStateKey(first.config)).toContain("session-a");
    expect(reviewViewStateKey(second.config)).toContain("session-b");
  });
});

const canvas = {
  softwareMapEnabled: true,
  hasChangeRange: true,
  version: 1,
  lensMode: "structural",
  commits: [],
} as const;

function renderViewState({
  session,
  store = createReviewPanelStore(),
  metrics = { scrollHeight: 1_000, clientHeight: 200 },
  children,
}: {
  session: TestReviewSession;
  store?: ReturnType<typeof createReviewPanelStore>;
  metrics?: { scrollHeight: number; clientHeight: number };
  children?: ReactNode;
}) {
  const container = document.createElement("div");
  document.body.append(container);
  let element: HTMLDivElement | null = null;
  root = createRoot(container);

  const renderSession = (next: TestReviewSession) =>
    act(() => {
      root?.render(
        <ReviewSessionProvider session={next}>
          <ViewStateHarness
            store={store}
            metrics={metrics}
            captureElement={(value: HTMLDivElement) => {
              element = value;
            }}
          >
            {children}
          </ViewStateHarness>
        </ReviewSessionProvider>,
      );
    });

  renderSession(session);

  return { element: element!, store, renderSession };
}

function ViewStateHarness({
  store,
  metrics,
  captureElement,
  children,
}: {
  store: ReturnType<typeof createReviewPanelStore>;
  metrics: { scrollHeight: number; clientHeight: number };
  captureElement(element: HTMLDivElement): void;
  children?: ReactNode;
}) {
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const scrollTop = useRef(0);
  useReviewViewStateSync({
    scrollRegionRef: scrollRegionRef as RefObject<HTMLElement | null>,
    panelStore: store,
  });

  return createElement(
    "div",
    {
      ref: (element: HTMLDivElement | null) => {
        scrollRegionRef.current = element;

        if (!element) return;
        Object.defineProperties(element, {
          scrollTop: {
            configurable: true,
            get: () => scrollTop.current,
            set: (value: number) => {
              scrollTop.current = value;
            },
          },
          scrollHeight: {
            configurable: true,
            get: () => metrics.scrollHeight,
          },
          clientHeight: {
            configurable: true,
            get: () => metrics.clientHeight,
          },
        });
        captureElement(element);
      },
      tabIndex: -1,
    },
    children,
  );
}

function storeState(
  session: TestReviewSession,
  state: Parameters<typeof writeReviewUiState>[2],
) {
  writeReviewUiState("session", reviewViewStateKey(session.config), state);
}

function flushNextFrame(): void {
  const next = frames.entries().next().value as
    | [number, FrameRequestCallback]
    | undefined;

  if (!next) throw new Error("No animation frame is pending");
  const [frame, callback] = next;
  frames.delete(frame);
  act(() => callback(16));
}

function triggerResize(): void {
  act(() => {
    for (const observer of [...resizeObservers]) observer.trigger();
  });
}

function unmount(): void {
  act(() => root?.unmount());
  root = undefined;
}
