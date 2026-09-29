import type { ReviewCommitSummary } from "@dev.fast/review-protocol";
import type { AnchorRef } from "@review/authoring";
import { describe, expect, it } from "vitest";

import type { ReviewPeekContent } from "./review-panel-model";
import { createReviewPanelStore } from "./review-panel-store";

const anchor = {
  id: "startup",
  title: "Startup",
} as AnchorRef;

const content: ReviewPeekContent = {
  kind: "inline-code",
  text: "start();",
};

describe("Review panel store", () => {
  it("replaces the open peek instead of layering peeks", () => {
    const store = createReviewPanelStore();
    const next = { kind: "peek", content: { kind: "explanation" } } as const;

    store.getState().openPeek({ kind: "peek", anchor, content });
    store.getState().openPeek(next);
    expect(store.getState().active).toEqual(next);

    store.getState().close();
    expect(store.getState().active).toBeNull();
  });

  it("suppresses a live panel when its cached canvas resumes", () => {
    const store = createReviewPanelStore();

    store.getState().openPeek({ kind: "peek", anchor, content });
    expect(store.getState().motion).toBe("live");

    store.getState().suppressMotion();
    expect(store.getState().motion).toBe("restored");

    store.getState().close();
    expect(store.getState().motion).toBe("live");
  });
});

const commit = {
  commit: "abc123",
  subject: "Add startup",
  fileCount: 2,
} as ReviewCommitSummary;

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

  it("drops a map focus the map never applied when a lens leaves Map, keeping the peek", () => {
    const store = createReviewPanelStore();

    store.getState().focusMapElement("review.missing");
    store.getState().openPeek({ kind: "peek", anchor, content });
    store.getState().selectLens({ id: "api", version: 3, mode: "structural" });
    expect(store.getState()).toMatchObject({
      view: "diff",
      active: { kind: "peek" },
    });

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
