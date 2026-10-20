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

const commit = "a".repeat(40);

const selection = {
  title: "Startup",
  target: { kind: "text", quote: "start();" },
} as const;

const presence = { agentName: "Claude Code" } as const;

const saved = (threadId: string) =>
  ({ type: "saved", threadId, selection, agent: "claude" }) as const;

function working(store: ReviewPanelStore, key: number, threadId = "thread") {
  store.getState().reportAsk(key, { threadId, busy: true, presence });
}

/** The thread each place shows, by its conversation. */
function placed(store: ReviewPanelStore) {
  const { asks, askColumn, askWindow, active } = store.getState();

  const thread = (key: number | null) =>
    asks.find((ask) => ask.key === key)?.threadId ?? null;

  return {
    column: active ? "peek" : thread(askColumn),
    window: thread(askWindow),
    onScreen: asks.length,
  };
}

describe("Ask", () => {
  it("leaves the column to whatever opens last; a working thread floats", () => {
    const store = createReviewPanelStore();
    store.getState().openAskView(saved("idle"));

    store.getState().openPeek({ kind: "peek", anchor, content });
    expect(placed(store)).toEqual({
      column: "peek",
      window: null,
      onScreen: 0,
    });

    store.getState().openAskView(saved("working"));
    working(store, store.getState().askColumn!, "working");
    store.getState().openPeek({ kind: "peek", anchor, content });
    expect(placed(store)).toEqual({
      column: "peek",
      window: "working",
      onScreen: 1,
    });

    // Closing the peek brings nothing back.
    store.getState().close();
    expect(placed(store)).toEqual({
      column: null,
      window: "working",
      onScreen: 1,
    });
  });

  it("floats one thread at a time: the newer takes the window", () => {
    const store = createReviewPanelStore();

    for (const threadId of ["first", "second"]) {
      store.getState().openAskView(saved(threadId));
      working(store, store.getState().askColumn!, threadId);
    }

    expect(placed(store)).toEqual({
      column: "second",
      window: "first",
      onScreen: 2,
    });

    store.getState().openAskView(saved("third"));
    expect(placed(store)).toEqual({
      column: "third",
      window: "second",
      onScreen: 2,
    });
  });

  it("keeps a working thread afloat when it opens another view", () => {
    const store = createReviewPanelStore();
    store.getState().openAskView(saved("floating"));
    const key = store.getState().askColumn!;
    working(store, key, "floating");
    store.getState().popOutAsk(key);
    store.getState().openAskView(saved("docked"));

    store.getState().openAskView(saved("other"), { from: key });
    expect(placed(store)).toEqual({
      column: "other",
      window: "floating",
      onScreen: 2,
    });

    // An idle one gives the window to what it opened.
    store
      .getState()
      .reportAsk(key, { threadId: "floating", busy: false, presence });
    store.getState().openAskView(saved("next"), { from: key });
    expect(placed(store)).toEqual({
      column: "other",
      window: "next",
      onScreen: 2,
    });
  });

  it("leaves a thread on screen where it is rather than opening it twice", () => {
    const store = createReviewPanelStore();
    store.getState().openAskView(saved("first"));
    const key = store.getState().askColumn!;
    working(store, key, "first");
    store.getState().popOutAsk(key);

    store.getState().openAskView(saved("first"));
    expect(placed(store)).toEqual({
      column: null,
      window: "first",
      onScreen: 1,
    });

    // Asked from itself, as to reconnect, it opens afresh in its place.
    store.getState().dockAsk(key);
    store.getState().openAskView(saved("first"), { from: key, replace: true });
    expect(store.getState().askColumn).not.toBe(key);
    expect(askShown(store.getState(), key)).toBeNull();
    expect(placed(store)).toEqual({
      column: "first",
      window: null,
      onScreen: 1,
    });
  });
});

describe("Review navigation", () => {
  it("keeps a commit filter across views until all commits are picked", () => {
    const store = createReviewPanelStore();
    store.getState().openPeek({ kind: "peek", anchor, content });

    store.getState().openCommitDiff({ commit, file: "src/start.ts" });
    expect(store.getState()).toMatchObject({
      view: "diff",
      diffScope: { commit, file: "src/start.ts" },
      active: null,
    });

    store.getState().showView("diff");
    expect(store.getState().diffScope).toMatchObject({ commit });

    // Picked in the sidebar's Commits, the filter changes in place.
    store.getState().pickCommit(null);
    expect(store.getState()).toMatchObject({ view: "diff", diffScope: null });
  });

  it("keeps a peek open beside a diff a lens opened", () => {
    const store = createReviewPanelStore();
    store.getState().openCommitDiff({ commit });
    store.getState().showView("review");
    store.getState().openPeek({ kind: "peek", anchor, content });

    const lens = { id: "api", version: 3 } as const;
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
    store.getState().setAvailableViews(["review", "diff"]);

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
      availableViews: ["review", "diff"],
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
    expect(store.getState().overlayTour).toMatchObject({
      ...sequence,
      anchor: "third",
    });

    store.getState().showView("diff");
    expect(store.getState().overlayTour).toBeNull();
  });

  it("closes when a lens moves the view to its diff", () => {
    const store = createReviewPanelStore();

    store.getState().openOverlayTour(sequence, "first");
    store.getState().selectLens({ id: "api", version: 3 });
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

  it("floats an Ask asked over a tour, keeping the tour", () => {
    const store = createReviewPanelStore();

    store.getState().openOverlayTour(sequence, "first");
    store.getState().openAsk(selection);
    expect(askShown(store.getState(), store.getState().askWindow!)).toBe(
      "window",
    );
    expect(store.getState().askColumn).toBeNull();
    expect(store.getState().overlayTour).not.toBeNull();
  });

  it("floats a thread whose pin is clicked on a tour, keeping the tour", () => {
    const store = createReviewPanelStore();

    store.getState().openOverlayTour(sequence, "first");
    // A pin opens its saved thread, or the list of several.
    store.getState().openAskView(saved("asked"));
    expect(askShown(store.getState(), store.getState().askWindow!)).toBe(
      "window",
    );

    store.getState().openAskView({ type: "history" });
    expect(askShown(store.getState(), store.getState().askWindow!)).toBe(
      "window",
    );
    expect(store.getState().askColumn).toBeNull();
    expect(store.getState().overlayTour?.anchor).toBe("first");
  });

  it("does not resume a tour over another view", () => {
    const store = createReviewPanelStore({
      view: "diff",
      overlayTour: { tourId: "flow", anchor: "first", revealRequest: 0 },
    });

    expect(store.getState().overlayTour).toBeNull();
  });
});

describe("the column right of the board", () => {
  const tour = { tourId: "startup-tour", kind: "sequence" } as const;

  it("gives a peek's place to a tour, and a tour's to a peek", () => {
    const store = createReviewPanelStore();

    store.getState().openPeek({ kind: "peek", anchor, content });
    store.getState().openOverlayTour(tour, "step-1");
    expect(store.getState().active).toBeNull();
    expect(store.getState().overlayTour?.tourId).toBe("startup-tour");

    store.getState().openPeek({ kind: "peek", anchor, content });
    expect(store.getState().overlayTour).toBeNull();
    expect(store.getState().active).not.toBeNull();
  });

  it("gives a thread's place to a tour, and floats a thread opened over it", () => {
    const store = createReviewPanelStore();

    store.getState().openAsk(selection);
    store.getState().openOverlayTour(tour, "step-1");
    expect(store.getState().askColumn).toBeNull();

    store.getState().openAskView(saved("other"));
    expect(store.getState().overlayTour?.tourId).toBe("startup-tour");
    expect(store.getState().askColumn).toBeNull();
    expect(askShown(store.getState(), store.getState().askWindow!)).toBe(
      "window",
    );
  });

  it("keeps the tour open as it moves from step to step", () => {
    const store = createReviewPanelStore();

    store.getState().openOverlayTour(tour, "step-1");
    store.getState().moveOverlayTour("step-2", { reveal: true });
    store.getState().openOverlayTour(tour, "step-3");
    expect(store.getState().overlayTour?.anchor).toBe("step-3");
  });
});
