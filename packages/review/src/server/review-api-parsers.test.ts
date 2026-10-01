import type { JsonValue } from "@dev.fast/review-protocol";
import { describe, expect, it } from "vitest";

import {
  parseReviewBugReportInput,
  parseReviewTabTelemetryInput,
} from "./review-api-parsers";

const bugReport = {
  description: "",
  include_review: true,
  include_map: true,
  include_diff: true,
  include_trace: false,
  app_session_id: "session-1234567890",
  app_version: "1.2.3",
};

describe("parseReviewBugReportInput", () => {
  it("accepts an empty description", () => {
    expect(parseReviewBugReportInput(bugReport).description).toBe("");
  });

  it("rejects a description over 64 KiB with 413", () => {
    expectBugReportStatus(
      { ...bugReport, description: "a".repeat(64 * 1024 + 1) },
      413,
    );
  });

  it("accepts a valid JPEG screenshot", () => {
    const screenshot = {
      mime: "image/jpeg" as const,
      base64: Buffer.from("jpeg bytes").toString("base64"),
    };

    expect(
      parseReviewBugReportInput({ ...bugReport, screenshot }),
    ).toMatchObject({ screenshot });
  });

  it("rejects a screenshot over 3 MiB with 413", () => {
    expectBugReportStatus(
      {
        ...bugReport,
        screenshot: {
          mime: "image/jpeg",
          base64: Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64"),
        },
      },
      413,
    );
  });

  it("rejects a screenshot with the wrong mime", () => {
    expect(() =>
      parseReviewBugReportInput({
        ...bugReport,
        screenshot: { mime: "image/png", base64: "cG5n" },
      }),
    ).toThrow(/image\/jpeg|Invalid input/i);
  });

  it("rejects malformed screenshot base64", () => {
    expectBugReportStatus(
      {
        ...bugReport,
        screenshot: { mime: "image/jpeg", base64: "not base64" },
      },
      400,
    );
  });
});

function expectBugReportStatus(value: JsonValue, statusCode: number) {
  let thrown: unknown;

  try {
    parseReviewBugReportInput(value);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toMatchObject({ statusCode });
}

describe("parseReviewTabTelemetryInput", () => {
  it("accepts the fixed tab dwell telemetry shape", () => {
    expect(
      parseReviewTabTelemetryInput({
        tab: "review",
        duration_ms: 250,
        reason: "visibility_hidden",
        app_session_id: "session-1234567890",
        document: "/pr/123",
      }),
    ).toEqual({
      tab: "review",
      durationMs: 250,
      reason: "visibility_hidden",
      appSessionId: "session-1234567890",
    });
  });

  it("rejects values outside the telemetry allowlist", () => {
    expect(() =>
      parseReviewTabTelemetryInput({
        tab: "timeline",
        duration_ms: 249,
        reason: "route_change",
        app_session_id: "../review",
      }),
    ).toThrow("tab must be review, commits, map, files, or trace");
  });
});
