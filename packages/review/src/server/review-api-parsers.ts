import {
  type JsonValue,
  ReviewBugReportRequestSchema,
  parseZod,
} from "@dev.fast/review-protocol";
import type { ReviewTabTelemetryEvent } from "@review/telemetry";
import { REVIEW_TELEMETRY_TABS } from "@review/ui-telemetry-events";
import { z } from "zod";

import { HttpJsonError } from "./http-json";

const MIN_REVIEW_TAB_DWELL_MS = 250;

const MAX_REVIEW_TAB_DWELL_MS = 4 * 60 * 60 * 1_000;

const APP_SESSION_ID_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{15,127}$/;

const MAX_BUG_REPORT_DESCRIPTION_BYTES = 64 * 1024;

const MAX_BUG_REPORT_SCREENSHOT_BYTES = 3 * 1024 * 1024;

export function parseReviewBugReportInput(value: JsonValue) {
  const parsed = ReviewBugReportRequestSchema.parse(value);

  if (
    Buffer.byteLength(parsed.description, "utf8") >
    MAX_BUG_REPORT_DESCRIPTION_BYTES
  ) {
    throw new HttpJsonError(
      `description must not exceed ${MAX_BUG_REPORT_DESCRIPTION_BYTES} UTF-8 bytes`,
      413,
    );
  }

  if (parsed.screenshot) {
    const screenshot = Buffer.from(parsed.screenshot.base64, "base64");

    if (screenshot.toString("base64") !== parsed.screenshot.base64) {
      throw new HttpJsonError("screenshot.base64 must be valid base64", 400);
    }

    if (screenshot.byteLength > MAX_BUG_REPORT_SCREENSHOT_BYTES) {
      throw new HttpJsonError(
        `screenshot must not exceed ${MAX_BUG_REPORT_SCREENSHOT_BYTES} decoded bytes`,
        413,
      );
    }
  }

  return parsed;
}

export const ReviewTabTelemetryInputSchema = z
  .strictObject({
    tab: z.enum(REVIEW_TELEMETRY_TABS, {
      error: "must be review, commits, map, files, or trace",
    }),
    reason: z.enum(["tab_change", "visibility_hidden", "pagehide", "unmount"], {
      error: "must be tab_change, visibility_hidden, pagehide, or unmount",
    }),
    duration_ms: z
      .number()
      .int("must be an integer from 250ms to 4h")
      .min(MIN_REVIEW_TAB_DWELL_MS, "must be an integer from 250ms to 4h")
      .max(MAX_REVIEW_TAB_DWELL_MS, "must be an integer from 250ms to 4h"),
    app_session_id: z
      .string()
      .regex(APP_SESSION_ID_PATTERN, "must be a valid session id"),
    document: z.unknown().optional(),
  })
  .transform((event) => ({
    tab: event.tab,
    reason: event.reason,
    durationMs: event.duration_ms,
    appSessionId: event.app_session_id,
  }));

export function requestJsonErrorStatus(cause: unknown): number {
  return cause instanceof HttpJsonError ? cause.statusCode : 400;
}

export function parseReviewTabTelemetryInput(
  value: JsonValue,
): ReviewTabTelemetryEvent {
  return parseZod(
    ReviewTabTelemetryInputSchema,
    value,
    "Review tab telemetry event",
  );
}
