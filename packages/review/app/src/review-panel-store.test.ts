import type { ReviewCommitSummary } from "@dev.fast/review-protocol";
import { describe, expect, it } from "vitest";

import type { PeekAnchor } from "./review-panel-model";
import type { ReviewPeekContent } from "./review-panel-model";
import {
  type ReviewPanelStore,
  askShown,
  createReviewPanelStore,
} from "./review-panel-store";

const anchor = {
  id: "startup",
  title: "Startup",
} as PeekAnchor;

const content: ReviewPeekContent = {
  kind: "inline-code",
  text: "start();",
};

const commit = {
  commit: "abc123",
  subject: "Add startup",
  fileCount: 2,
} as ReviewCommitSummary;

const selection = {
  title: "Startup",
  target: { kind: "text", quote: "start();" },
} as const;

const presence = {
  agentName: "Claude Code",
  status: "",
  tone: "quiet",
} as const;

/** The key of the Ask shown in that place. */
function shownAt(store: ReviewPanelStore, place: "docked" | "window") {
  const state = store.getState();

  return place === "docked" ? state.askDocked : state.askWindow;
}

function working(store: ReviewPanelStore, key: number, threadId = "thread") {
  store.getState().reportAsk(key, { threadId, busy: true, presence });
}

describe("Ask", () => {
  it("shrinks to a pill under a peek or a diagram, and comes back after", () => {
    const store = createReviewPanelStore();
    store.getState().openAsk(selection);
    const key = shownAt(store, "docked")!;
    expect(askShown(store.getState(), key)).toBe("panel");

    store.getState().openPeek({ kind: "peek", anchor, content });
    expect(askShown(store.getState(), key)).toBe("pill");
    store.getState().close();
    expect(askShown(store.getState(), key)).toBe("panel");

    store
      .getState()
      .openOverlayTour({ tourId: "flow", kind: "sequence" }, "step-1");
    expect(askShown(store.getState(), key)).toBe("pill");
    store.getState().closeOverlayTour();
    expect(askShown(store.getState(), key)).toBe("panel");
  });

  it("stays open in every view", () => {
    const store = createReviewPanelStore();
    store.getState().openAsk(selection);

    store.getState().showView("diff");
    expect(askShown(store.getState(), shownAt(store, "docked")!)).toBe("panel");
  });

  it("opens its window from the pill, and docks in place of a peek", () => {
    const store = createReviewPanelStore();
    store.getState().openAsk(selection);
    const key = shownAt(store, "docked")!;
    store.getState().openPeek({ kind: "peek", anchor, content });

    store.getState().restoreAsk(key);
    expect(askShown(store.getState(), key)).toBe("window");
    expect(store.getState().active).toMatchObject({ kind: "peek" });

    store.getState().minimizeAsk(key);
    expect(askShown(store.getState(), key)).toBe("pill");

    store.getState().dockAsk(key);
    expect(askShown(store.getState(), key)).toBe("panel");
    expect(store.getState().active).toBeNull();
  });

  it("asks in place of an idle Ask, and beside one whose agent is working", () => {
    const store = createReviewPanelStore();
    store.getState().openAsk(selection);
    const idle = shownAt(store, "docked")!;

    store.getState().openAsk(selection);
    const first = shownAt(store, "docked")!;
    expect(askShown(store.getState(), idle)).toBeNull();
    expect(store.getState().asks).toHaveLength(1);

    working(store, first);
    store.getState().openAsk(selection);
    const second = shownAt(store, "docked")!;
    expect(second).not.toBe(first);
    expect(askShown(store.getState(), first)).toBe("pill");
    expect(askShown(store.getState(), second)).toBe("panel");

    // From the pill, the working one opens in the window beside the dock.
    store.getState().restoreAsk(first);
    expect(askShown(store.getState(), first)).toBe("window");
    expect(askShown(store.getState(), second)).toBe("panel");

    store.getState().closeAsk(second);
    expect(store.getState().asks.map((ask) => ask.key)).toEqual([first]);
    expect(askShown(store.getState(), first)).toBe("window");
  });

  it("shows one Ask docked and one in the window; another there minimizes it", () => {
    const store = createReviewPanelStore();
    store.getState().openAsk(selection);
    const first = shownAt(store, "docked")!;
    working(store, first, "first");
    store.getState().openAsk(selection);
    const second = shownAt(store, "docked")!;
    working(store, second, "second");
    store.getState().openAsk(selection);
    const third = shownAt(store, "docked")!;

    store.getState().popOutAsk(third);
    store.getState().dockAsk(first);
    expect(askShown(store.getState(), first)).toBe("panel");
    expect(askShown(store.getState(), third)).toBe("window");
    expect(askShown(store.getState(), second)).toBe("pill");

    store.getState().restoreAsk(second);
    expect(askShown(store.getState(), second)).toBe("window");
    expect(askShown(store.getState(), third)).toBe("pill");

    store.getState().dockAsk(third);
    expect(askShown(store.getState(), third)).toBe("panel");
    expect(askShown(store.getState(), first)).toBe("pill");
    expect(askShown(store.getState(), second)).toBe("window");
  });

  it("brings an open conversation forward rather than opening it twice", () => {
    const store = createReviewPanelStore();

    const saved = {
      type: "saved",
      threadId: "first",
      selection,
      agent: "claude",
    } as const;

    store.getState().openAskView(saved);
    const key = shownAt(store, "docked")!;
    working(store, key, "first");
    store.getState().minimizeAsk(key);

    store.getState().openAskView({ type: "history" });
    store.getState().openAskView(saved);
    expect(shownAt(store, "docked")).toBe(key);
    expect(store.getState().asks).toHaveLength(2);

    // Asked from itself, as to reconnect, it opens afresh in its place.
    store.getState().openAskView(saved, { from: key, replace: true });
    expect(shownAt(store, "docked")).not.toBe(key);
    expect(askShown(store.getState(), key)).toBeNull();
    expect(store.getState().asks).toHaveLength(2);
  });
});

describe("Review navigation", () => {
  it("scopes a commit diff until the reader leaves the diff", () => {
    const store = createReviewPanelStore();
    store.getState().openPeek({ kind: "peek", anchor, content });

    store.getState().openCommitDiff({ commit, file: "src/start.ts" });
    expect(store.getState()).toMatchObject({
      view: "diff",
      diffScope: { commit, file: "src/start.ts" },
      active: null,
    });

    store.getState().showView("commits");
    store.getState().showView("diff");
    expect(store.getState().diffScope).toBeNull();
  });

  it("keeps a peek open beside a diff a lens opened", () => {
    const store = createReviewPanelStore();
    store.getState().openCommitDiff({ commit });
    store.getState().showView("review");
    store.getState().openPeek({ kind: "peek", anchor, content });

    const lens = { id: "api", version: 3, mode: "structural" } as const;
    store.getState().selectLens(lens);
    expect(store.getState()).toMatchObject({
      view: "diff",
      diffScope: null,
      lens,
      active: { kind: "peek" },
    });
  });

  it("opens a trace on the whiteboard when the canvas has no traces", () => {
    const store = createReviewPanelStore();
    store.getState().setAvailableViews(["review", "commits", "diff"]);

    store.getState().openTrace({ sessionId: "session-1" });
    expect(store.getState().view).toBe("review");

    store.getState().setAvailableViews(["review", "trace"]);
    store.getState().openTrace({ sessionId: "session-2" });
    expect(store.getState()).toMatchObject({
      view: "trace",
      traceSelection: { sessionId: "session-2" },
    });
  });

  it("resumes on the whiteboard when the stored view is not offered", () => {
    const store = createReviewPanelStore({
      view: "map",
      availableViews: ["review", "commits", "diff"],
    });

    expect(store.getState().view).toBe("review");
  });

  it("returns to the whiteboard when the current view stops being offered", () => {
    const store = createReviewPanelStore();
    store.getState().openCommitDiff({ commit });

    store.getState().setAvailableViews(["review", "map"]);
    expect(store.getState()).toMatchObject({ view: "review", diffScope: null });
  });

  it("opens the map on a focused element once", () => {
    const store = createReviewPanelStore();
    store.getState().openPeek({ kind: "peek", anchor, content });

    store.getState().focusMapElement("review.app");
    const focus = store.getState().mapFocus!;
    expect(store.getState()).toMatchObject({
      view: "map",
      active: null,
      mapFocus: { elementPath: "review.app", pending: true },
    });

    store.getState().consumeMapFocus(focus.requestId);
    store.getState().showView("review");
    store.getState().showView("map");
    // The map remounts here; the old request must not select its node again,
    // but the model choice still follows the focused element.
    expect(store.getState().mapFocus).toMatchObject({
      elementPath: "review.app",
      pending: false,
    });
  });

  it("drops a map focus the map never applied once the reader leaves Map", () => {
    const store = createReviewPanelStore();

    store.getState().focusMapElement("review.missing");
    store.getState().showView("review");
    store.getState().showView("map");
    expect(store.getState().mapFocus).toMatchObject({
      elementPath: "review.missing",
      pending: false,
    });
  });

  it("ignores a map focus on a canvas without a map", () => {
    const store = createReviewPanelStore({ availableViews: ["review"] });

    store.getState().focusMapElement("review.app");
    expect(store.getState()).toMatchObject({ view: "review", mapFocus: null });
  });
});

describe("Fullscreen tours", () => {
  const sequence = { tourId: "flow", kind: "sequence" } as const;

  it("reveals each explicit step and closes when the reader leaves the whiteboard", () => {
    const store = createReviewPanelStore();

    store.getState().openOverlayTour(sequence, "first");
    store.getState().moveOverlayTour("second", { reveal: false });
    store.getState().moveOverlayTour("third", { reveal: true });
    expect(store.getState().overlayTour).toEqual({
      ...sequence,
      anchor: "third",
      revealRequest: 2,
    });

    store.getState().showView("diff");
    expect(store.getState().overlayTour).toBeNull();
  });

  it("closes when a lens moves the view to its diff", () => {
    const store = createReviewPanelStore();

    store.getState().openOverlayTour(sequence, "first");
    store.getState().selectLens({ id: "api", version: 3, mode: "structural" });
    expect(store.getState()).toMatchObject({ view: "diff", overlayTour: null });
  });

  it("reveals the first stop when an open tour switches to another tour", () => {
    const store = createReviewPanelStore();

    const lens = (useCase: string) =>
      ({ tourId: `orders:${useCase}`, kind: "database" }) as const;

    store.getState().openOverlayTour(lens("create"), "insert");
    const shown = store.getState().overlayTour!.revealRequest;

    store.getState().openOverlayTour(lens("cancel"), "update");
    expect(store.getState().overlayTour).toMatchObject({
      tourId: "orders:cancel",
      anchor: "update",
    });
    // The panel stays mounted across the switch, so only a new request
    // scrolls it to the new tour's stop.
    expect(store.getState().overlayTour!.revealRequest).toBeGreaterThan(shown);
  });

  it("does not resume a tour over another view", () => {
    const store = createReviewPanelStore({
      view: "diff",
      overlayTour: { tourId: "flow", anchor: "first", revealRequest: 0 },
    });

    expect(store.getState().overlayTour).toBeNull();
  });
});
