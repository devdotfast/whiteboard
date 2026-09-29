import type { ReviewCommitSummary } from "@dev.fast/review-protocol";
import type { AnchorRef } from "@review/authoring";
import { describe, expect, it } from "vitest";

import type { GuidedTour, ReviewPeekContent } from "./review-panel-model";
import { createReviewPanelStore } from "./review-panel-store";

const anchor = {
  id: "startup",
  title: "Startup",
} as AnchorRef;

const content: ReviewPeekContent = {
  kind: "inline-code",
  text: "start();",
};

const tour: GuidedTour = {
  id: "flow",
  stops: [{ anchor, label: "Startup", content }],
};

describe("Review panel store", () => {
  it("replaces the active panel instead of layering panels", () => {
    const store = createReviewPanelStore();

    store.getState().openPeek({ kind: "peek", anchor, content });
    expect(store.getState().active).toEqual({
      kind: "peek",
      anchor,
      content,
    });

    store.getState().openTour(tour, anchor.id);
    expect(store.getState().active).toMatchObject({
      kind: "tour",
      tour,
      activeAnchor: anchor.id,
    });
  });

  it("closes the active panel without revealing an earlier panel", () => {
    const store = createReviewPanelStore();

    store.getState().openTour(tour, anchor.id);
    store.getState().openPeek({ kind: "peek", anchor, content });
    expect(store.getState().active?.kind).toBe("peek");

    store.getState().close();
    expect(store.getState().active).toBeNull();
  });

  it("distinguishes explicit tour reveals from focus-only activation", () => {
    const store = createReviewPanelStore();
    store.getState().openTour(tour, anchor.id);
    const initial = store.getState().active;
    expect(initial?.kind).toBe("tour");
    const initialReveal = initial?.kind === "tour" ? initial.revealRequest : -1;

    store
      .getState()
      .activateTourAnchor("focused-without-reveal", { reveal: false });
    expect(store.getState().active).toMatchObject({
      activeAnchor: "focused-without-reveal",
      revealRequest: initialReveal,
    });

    store.getState().activateTourAnchor("explicit-next", { reveal: true });
    expect(store.getState().active).toMatchObject({
      activeAnchor: "explicit-next",
      revealRequest: initialReveal + 1,
    });
  });

  it("suppresses restored panel motion until the next live interaction", () => {
    const store = createReviewPanelStore();

    store.getState().restoreTour(tour, anchor.id);
    expect(store.getState().motion).toBe("restored");

    store.getState().activateTourAnchor("explicit-next", { reveal: true });
    expect(store.getState().motion).toBe("live");
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

  it("ignores a map focus on a canvas without a map", () => {
    const store = createReviewPanelStore({ availableViews: ["review"] });

    store.getState().focusMapElement("review.app");
    expect(store.getState()).toMatchObject({ view: "review", mapFocus: null });
  });
});
