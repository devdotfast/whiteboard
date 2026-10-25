import { expect, it } from "vitest";

import { type SiblingFacts, orderSiblings } from "./board-order.js";

const noDependencies = () => [];

const noAncestry = () => false;

/** Lower, then Upper saved later: recency alone puts Upper first. */
const lower: SiblingFacts = {
  id: "lower",
  createdAt: "2026-10-01T00:00:00Z",
  repositoryId: "repo",
  headBranch: "feature",
};

const upper: SiblingFacts = {
  id: "upper",
  createdAt: "2026-10-01T00:01:00Z",
  repositoryId: "repo",
  baseBranch: "feature",
};

it("puts a PR after the sibling whose branch it merges into", () => {
  expect(orderSiblings([lower, upper], noDependencies, noAncestry)).toEqual([
    "lower",
    "upper",
  ]);
});

it("matches a PR's base branch only in its own repository", () => {
  expect(
    orderSiblings(
      [lower, { ...upper, repositoryId: "other" }],
      noDependencies,
      noAncestry,
    ),
  ).toEqual(["upper", "lower"]);
});
