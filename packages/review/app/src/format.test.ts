import { expect, it } from "vitest";

import { formatRelativeTime } from "./format";

const now = Date.parse("2026-10-15T12:00:00Z");

it("reads ISO timestamps and epoch milliseconds alike", () => {
  const then = now - 5 * 60_000;

  expect(formatRelativeTime(then, now)).toBe("5 min ago");
  expect(formatRelativeTime(new Date(then).toISOString(), now)).toBe(
    "5 min ago",
  );
});

it("says unknown for a missing or unreadable time", () => {
  expect(formatRelativeTime(null, now)).toBe("unknown");
  expect(formatRelativeTime("not a date", now)).toBe("unknown");
  expect(formatRelativeTime(Number.NaN, now)).toBe("unknown");
});

it("writes hours and days in short for a narrow row", () => {
  expect(formatRelativeTime(now - 3 * 3_600_000, now, { short: true })).toBe(
    "3h ago",
  );
  expect(formatRelativeTime(now - 2 * 86_400_000, now, { short: true })).toBe(
    "2d ago",
  );
});
