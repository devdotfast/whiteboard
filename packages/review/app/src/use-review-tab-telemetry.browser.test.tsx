import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { TestCanvasQuery } from "./canvas-query-test-utils";
import {
  type ReviewSession,
  ReviewSessionProvider,
} from "./host/review-session";
import type { ReviewSessionData } from "./host/review-session-data";
import { testReviewSession } from "./review-session-test-utils";
import { useReviewTabTelemetry } from "./use-review-tab-telemetry";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function Telemetry() {
  useReviewTabTelemetry("review");

  return null;
}

it("keeps dwell continuous through live review updates and beacons it through the host", () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const beacon = vi.fn<NonNullable<ReviewSession["bridge"]["beacon"]>>();
  const base = testReviewSession({}, { beacon });

  const review: ReviewSessionData = {
    reviewId: "test-review",
    pins: { base: "base", head: "head" },
    historicalRevision: null,
    updatedAtMs: 0,
    traces: new Map(),
    place: async () => ({ siblings: [] }),
    stack: async () => ({ layers: [] }),
    createBranchReview: async () => "",
    dismiss: async () => true,
  };

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  const render = (session: ReviewSession) =>
    act(() => {
      root!.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
            <Telemetry />
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      );
    });

  render({ ...base, review });
  now = 1000;
  render({ ...base, review: { ...review, updatedAtMs: 1000 } });

  expect(beacon).not.toHaveBeenCalled();
  now = 2500;
  act(() => window.dispatchEvent(new Event("pagehide")));

  expect(beacon).toHaveBeenCalledTimes(1);
  expect(beacon.mock.calls[0]?.[0]).toBe("/telemetry/tab");
  expect(JSON.parse(String(beacon.mock.calls[0]?.[1]))).toEqual({
    tab: "review",
    duration_ms: 2500,
    reason: "pagehide",
    app_session_id: base.appSessionId,
  });
});
