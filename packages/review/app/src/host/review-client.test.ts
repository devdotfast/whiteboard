import { expect, it } from "vitest";

import { reviewApiPath } from "./review-client";

it("routes JSON reports without legacy document parameters", () => {
  const report = new URL(
    reviewApiPath("review/id", "/telemetry/bug-report", { version: 0 }),
    "http://localhost",
  );

  expect(report.pathname).toBe("/reviews-api/review%2Fid/telemetry/bug-report");
  expect([...report.searchParams]).toEqual([["version", "0"]]);
});
