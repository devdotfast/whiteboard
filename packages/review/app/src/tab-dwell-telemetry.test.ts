import { describe, expect, it } from "vitest";

import {
  MAX_REVIEW_TAB_DWELL_MS,
  type ReviewTabDwellPayload,
  createReviewTabDwellTracker,
} from "./tab-dwell-telemetry";

describe("createReviewTabDwellTracker", () => {
  it("flushes visible dwell time on tab change", () => {
    let now = 1_000;

    const sent: Array<{
      payload: ReviewTabDwellPayload;
      pageExit: boolean;
    }> = [];

    const tracker = createReviewTabDwellTracker({
      initialTab: "review",
      appSessionId: "session-1234567890",
      now: () => now,
      isVisible: () => true,
      send: (payload, options) =>
        sent.push({ payload, pageExit: options.pageExit }),
    });

    now = 1_350;
    tracker.setActiveTab("map");

    expect(sent).toEqual([
      {
        payload: {
          tab: "review",
          duration_ms: 350,
          reason: "tab_change",
          app_session_id: "session-1234567890",
        },
        pageExit: false,
      },
    ]);
  });

  it("flushes and pauses when the page becomes hidden", () => {
    let now = 0;
    let visible = true;
    const sent: ReviewTabDwellPayload[] = [];

    const tracker = createReviewTabDwellTracker({
      initialTab: "review",
      appSessionId: "session-1234567890",
      now: () => now,
      isVisible: () => visible,
      send: (payload) => sent.push(payload),
    });

    now = 500;
    visible = false;
    tracker.handleVisibilityChange(false);
    now = 800;
    tracker.setActiveTab("map");
    now = 1_000;
    visible = true;
    tracker.handleVisibilityChange(true);
    now = 1_300;
    tracker.setActiveTab("files");

    expect(sent).toEqual([
      {
        tab: "review",
        duration_ms: 500,
        reason: "visibility_hidden",
        app_session_id: "session-1234567890",
      },
      {
        tab: "map",
        duration_ms: 300,
        reason: "tab_change",
        app_session_id: "session-1234567890",
      },
    ]);
  });

  it("drops invalid and sub-threshold durations", () => {
    let now = 0;
    const sent: ReviewTabDwellPayload[] = [];

    const tracker = createReviewTabDwellTracker({
      initialTab: "review",
      appSessionId: "session-1234567890",
      now: () => now,
      isVisible: () => true,
      send: (payload) => sent.push(payload),
    });

    now = 100;
    tracker.setActiveTab("map");
    now = Number.NaN;
    tracker.setActiveTab("files");

    expect(sent).toHaveLength(0);
  });

  it("caps stale visible segments at four hours", () => {
    let now = 0;
    const sent: ReviewTabDwellPayload[] = [];

    const tracker = createReviewTabDwellTracker({
      initialTab: "review",
      appSessionId: "session-1234567890",
      now: () => now,
      isVisible: () => true,
      send: (payload) => sent.push(payload),
    });

    now = MAX_REVIEW_TAB_DWELL_MS + 1_000;
    tracker.unmount();

    expect(sent[0]?.duration_ms).toBe(MAX_REVIEW_TAB_DWELL_MS);
    expect(sent[0]?.reason).toBe("unmount");
  });
});
