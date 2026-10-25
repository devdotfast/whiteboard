import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { expect, it } from "vitest";

import { recentTree } from "./whiteboard-tree";

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
    recentTree(
      [
        board("plan", "app", "2026-10-01T10:00:00Z"),
        board("model", "data-model", "2026-10-03T10:00:00Z"),
        board("open", "app", "2026-10-04T10:00:00Z"),
        board("never", "app", null),
        board("dropped", "docs", "2026-10-05T10:00:00Z", "2026-10-06"),
        board("notes", "docs", "2026-10-02T10:00:00Z"),
      ],
      "open",
    ).map(({ board }) => board.reviewId),
  ).toEqual(["model", "notes", "plan"]);
});

it("groups a recently opened child under its unvisited parent and keeps dependency order", () => {
  const plan = { ...board("plan", "app", null), children: ["first", "second"] };
  const first = { ...board("first", "app", "2026-10-01"), parentId: "plan" };

  const second = {
    ...board("second", "app", "2026-10-05"),
    parentId: "plan",
    dependsOn: ["first"],
  };

  const other = board("other", "other", "2026-10-03");
  const tree = recentTree([plan, first, second, other], "unlisted");
  expect(tree.map(({ board }) => board.reviewId)).toEqual(["plan", "other"]);
  expect(tree[0]!.children.map(({ reviewId }) => reviewId)).toEqual([
    "first",
    "second",
  ]);
  expect(
    recentTree([plan, first, second, other], "second").map(
      ({ board }) => board.reviewId,
    ),
  ).toEqual(["other"]);
});
