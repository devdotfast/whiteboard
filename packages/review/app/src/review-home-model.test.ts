import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { describe, expect, it } from "vitest";

import {
  defaultHomeFilters,
  groupFor,
  homeRepositories,
  matchesHomeFilters,
  repositoryIdentity,
  sortHomeReviews,
  toggleHomeWorktree,
  worktreeKey,
} from "./review-home-model";

const now = Date.parse("2026-10-11T12:00:00Z");

const board: ReviewApiSummary = {
  reviewId: "one",
  version: 1,
  title: "Fold query contract",
  repositoryName: "whiteboard",
  repositoryGroup: { key: "repo", label: "devdotfast/whiteboard" },
  repositoryPath: "/checkouts/fold-query",
  origin: { branch: "sm/grammar", pullRequestNumber: 1091 },
  createdAt: new Date(now).toISOString(),
  viewedAt: null,
  trashedAt: null,
};

describe("Home model", () => {
  it("uses rolling seven-day boundaries and unread precedence independent of working", () => {
    const read = { ...board, viewedAt: board.createdAt };
    expect(
      groupFor(
        { ...read, createdAt: new Date(now - 7 * 86400000).toISOString() },
        now,
      ),
    ).toBe("week");
    expect(
      groupFor(
        { ...read, createdAt: new Date(now - 7 * 86400000 - 1).toISOString() },
        now,
      ),
    ).toBe("earlier");
    expect(
      groupFor({ ...board, createdAt: "2020-01-01", working: true }, now),
    ).toBe("unread");
    expect(groupFor({ ...read, working: true }, now)).toBe("week");
  });
  it("searches titles, worktrees, branches and repos, but not PR numbers", () => {
    expect(matchesHomeFilters(board, defaultHomeFilters, "fold query")).toBe(
      true,
    );

    for (const query of ["devdotfast", "fold-query", "sm/grammar"])
      expect(matchesHomeFilters(board, defaultHomeFilters, query)).toBe(true);

    for (const query of ["1091", "#1091"])
      expect(matchesHomeFilters(board, defaultHomeFilters, query)).toBe(false);
  });
  it("groups remote worktrees together without conflating same-name local repositories", () => {
    const imported = {
      ...board,
      repositoryGroup: undefined,
      shared: { cloneUrl: "git@github.com:devdotfast/whiteboard.git" },
    };

    const otherTree = {
      ...imported,
      repositoryPath: "/tmp/another-tree",
      shared: { cloneUrl: "https://github.com/devdotfast/whiteboard" },
    };

    expect(repositoryIdentity(imported)?.key).toBe(
      repositoryIdentity(otherTree)?.key,
    );
    expect(
      repositoryIdentity({ ...board, repositoryGroup: undefined }),
    ).toBeUndefined();
    const filters = { ...defaultHomeFilters, repositories: ["git:/one/.git"] };
    expect(
      matchesHomeFilters(
        {
          ...board,
          repositoryGroup: { key: "git:/two/.git", label: "same-name" },
        },
        filters,
      ),
    ).toBe(false);
  });
  it("requires every search chip and live text while facet values remain OR alternatives", () => {
    const filters = {
      ...defaultHomeFilters,
      searches: ["Fold", "contract"],
      repositories: ["other", "repo"],
    };

    expect(matchesHomeFilters(board, filters, "query")).toBe(true);
    expect(matchesHomeFilters(board, filters, "missing")).toBe(false);
    expect(
      matchesHomeFilters(board, { ...filters, searches: ["Fold", "missing"] }),
    ).toBe(false);
  });
  it("ranks title hits before metadata hits, keeping the requested sort within each rank", () => {
    const titleHit = { ...board, createdAt: "2020-01-01" };
    const treeHit = { ...board, reviewId: "tree", title: "Other board" };
    expect(sortHomeReviews([treeHit, titleHit], "updated", ["fold"])).toEqual([
      titleHit,
      treeHit,
    ]);
    expect(
      matchesHomeFilters(board, {
        ...defaultHomeFilters,
        searches: ["contract", "sm/grammar", "devdotfast"],
      }),
    ).toBe(true);
  });
  it("sorts created time independently of the latest update", () => {
    const older = { ...board, title: "Zulu", firstCreatedAt: "2026-01-01" };

    const newer = {
      ...board,
      reviewId: "two",
      title: "Alpha",
      firstCreatedAt: "2026-02-01",
      createdAt: "2026-10-10",
    };

    expect(sortHomeReviews([older, newer], "updated")).toEqual([older, newer]);
    expect(sortHomeReviews([older, newer], "created")).toEqual([newer, older]);
    expect(sortHomeReviews([older, newer], "title")).toEqual([newer, older]);
  });
});

it("normalizes all unresolved worktrees without limiting the unfiltered list", () => {
  const local = ["one", "two"].map((name) => ({
    ...board,
    reviewId: name,
    repositoryGroup: undefined,
    repositoryPath: `/local/${name}`,
  }));

  const reviews = [...local, board];
  const catalog = homeRepositories(reviews);

  let filters = toggleHomeWorktree(
    defaultHomeFilters,
    worktreeKey(local[0]!),
    catalog,
  );

  expect(reviews.filter((r) => matchesHomeFilters(r, filters))).toEqual([
    local[0],
  ]);
  filters = toggleHomeWorktree(filters, worktreeKey(local[1]!), catalog);
  expect(reviews.filter((r) => matchesHomeFilters(r, filters))).toEqual(
    reviews,
  );
});
