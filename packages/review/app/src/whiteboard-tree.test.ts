import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { expect, it } from "vitest";

import { recentBoards } from "./whiteboard-tree";

const board = (
  reviewId: string,
  project: string,
  viewedAt: string | null,
  trashedAt: string | null = null,
) =>
  ({
    reviewId,
    title: reviewId,
    project: { id: project, name: project },
    viewedAt,
    trashedAt,
  }) as ReviewApiSummary;

it("lists the boards opened last in every project, newest first, without the open one or any in Trash", () => {
  expect(
    recentBoards(
      [
        board("plan", "app", "2026-10-01T10:00:00Z"),
        board("model", "data-model", "2026-10-03T10:00:00Z"),
        board("open", "app", "2026-10-04T10:00:00Z"),
        board("never", "app", null),
        board("dropped", "docs", "2026-10-05T10:00:00Z", "2026-10-06"),
        board("notes", "docs", "2026-10-02T10:00:00Z"),
      ],
      "open",
    ).map(({ reviewId }) => reviewId),
  ).toEqual(["model", "notes", "plan"]);
});
