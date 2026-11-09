import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { expect, it } from "vitest";

import { recentTree, unreadTree } from "./whiteboard-tree";

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

it("lists families with an unread member, newest first, without the open family or any in Trash", () => {
  const created = (
    reviewId: string,
    createdAt: string,
    viewedAt: string | null,
    extra: Partial<ReviewApiSummary> = {},
  ) => ({ ...board(reviewId, "app", viewedAt), createdAt, ...extra });

  const plan = created("plan", "2026-10-01", "2026-10-02", {
    children: ["step"],
  });

  const step = created("step", "2026-10-03", null, { parentId: "plan" });
  const open = created("open", "2026-10-06", null, { children: ["sibling"] });

  const sibling = created("sibling", "2026-10-07", null, {
    parentId: "open",
  });

  const tree = unreadTree(
    [
      plan,
      step,
      open,
      sibling,
      created("read", "2026-10-04", "2026-10-05"),
      created("updated", "2026-10-05", "2026-10-04"),
      created("gone", "2026-10-08", null, { trashedAt: "2026-10-09" }),
    ],
    "sibling",
  );

  expect(tree.map(({ board }) => board.reviewId)).toEqual(["updated", "plan"]);
  expect(tree[1]!.children.map(({ reviewId }) => reviewId)).toEqual(["step"]);
});
