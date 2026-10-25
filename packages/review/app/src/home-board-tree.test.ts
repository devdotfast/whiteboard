import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { describe, expect, it } from "vitest";

import {
  defaultHomeFilters,
  homeBoardTree,
  homeBranchGroup,
} from "./review-home-model";

const now = Date.parse("2026-10-20T12:00:00Z");

function board(
  reviewId: string,
  extra: Partial<ReviewApiSummary> = {},
): ReviewApiSummary {
  return {
    reviewId,
    repositoryName: "repo",
    title: reviewId,
    version: 1,
    createdAt: "2026-10-01T00:00:00Z",
    viewedAt: "2026-10-20T00:00:00Z",
    trashedAt: null,
    ...extra,
  };
}

it("ranks a family by its latest child without sorting its siblings", () => {
  const tree = homeBoardTree(
    [
      board("Plan", { children: ["First", "Last"] }),
      board("Other", { createdAt: "2026-10-19T00:00:00Z" }),
      board("Last", { parentId: "Plan", createdAt: "2026-10-20T10:00:00Z" }),
      board("First", { parentId: "Plan" }),
    ],
    defaultHomeFilters,
    "",
    "updated",
  );

  expect(tree.map((branch) => branch.board.reviewId)).toEqual([
    "Plan",
    "Other",
  ]);
  expect(tree[0].children.map((child) => child.reviewId)).toEqual([
    "First",
    "Last",
  ]);
  expect(homeBranchGroup(tree[0], now)).toBe("unread");
});

it("keeps matching children with parent context for exact branch filters", () => {
  const tree = homeBoardTree(
    [
      board("Plan", { children: ["One", "Two"] }),
      board("One", { parentId: "Plan", origin: { branch: "feature" } }),
      board("Two", { parentId: "Plan", origin: { branch: "feature-extra" } }),
    ],
    { ...defaultHomeFilters, branches: ["feature"] },
    "",
    "updated",
  );

  expect(tree.map((branch) => branch.board.reviewId)).toEqual(["Plan"]);
  expect(tree[0].children.map((child) => child.reviewId)).toEqual(["One"]);
});

it("keeps an orphan reachable after its parent leaves the active catalog", () => {
  const tree = homeBoardTree(
    [
      board("Child", {
        parentId: "trashed-plan",
        createdAt: "2026-10-19T00:00:00Z",
      }),
    ],
    defaultHomeFilters,
    "",
    "updated",
  );

  expect(tree.map((branch) => branch.board.reviewId)).toEqual(["Child"]);
  expect(homeBranchGroup(tree[0], now)).toBe("week");
});
