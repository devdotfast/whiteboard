import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { describe, expect, it, vi } from "vitest";

import { type RunGitHubApi, resolveReviewStackLayers } from "./review-stack";

const reviewSummary = (input: {
  reviewId: string;
  repositoryUrl: string;
  pullRequestNumber: number;
  title: string;
}): Pick<ReviewApiSummary, "reviewId" | "title" | "origin"> => ({
  reviewId: input.reviewId,
  title: input.title,
  origin: {
    pullRequestNumber: input.pullRequestNumber,
    pullRequestUrl: `${input.repositoryUrl}/pull/${input.pullRequestNumber}`,
  },
});

describe("resolveReviewStackLayers", () => {
  it("returns PR layers on both sides of the reviewed PR and matches local reviews", async () => {
    const run = vi.fn<RunGitHubApi>(async () =>
      JSON.stringify([
        {
          pull_requests: [
            { number: 10, head: { ref: "a" } },
            { number: 20, head: { ref: "b" } },
            { number: 30, head: { ref: "c" } },
            { number: 40, head: { ref: "d" } },
          ],
        },
      ]),
    );

    const reviewA = reviewSummary({
      reviewId: "11111111-1111-4111-8111-111111111111",
      repositoryUrl: "https://github.com/o/r",
      pullRequestNumber: 10,
      title: "Review A",
    });

    const reviewB = reviewSummary({
      reviewId: "22222222-2222-4222-8222-222222222222",
      repositoryUrl: "https://github.com/o/r",
      pullRequestNumber: 20,
      title: "Review B",
    });

    await expect(
      resolveReviewStackLayers(
        {
          origin: { pullRequestUrl: "https://github.com/o/r/pull/20" },
        },
        [reviewA, reviewB],
        run,
      ),
    ).resolves.toEqual([
      {
        branch: "a",
        pullRequestNumber: 10,
        pullRequestUrl: "https://github.com/o/r/pull/10",
        reviewUuid: reviewA.reviewId,
        reviewTitle: "Review A",
        relation: "earlier",
      },
      {
        branch: "b",
        pullRequestNumber: 20,
        pullRequestUrl: "https://github.com/o/r/pull/20",
        reviewUuid: reviewB.reviewId,
        reviewTitle: "Review B",
        relation: "current",
      },
      {
        branch: "c",
        pullRequestNumber: 30,
        pullRequestUrl: "https://github.com/o/r/pull/30",
        reviewUuid: null,
        reviewTitle: null,
        relation: "later",
      },
      {
        branch: "d",
        pullRequestNumber: 40,
        pullRequestUrl: "https://github.com/o/r/pull/40",
        reviewUuid: null,
        reviewTitle: null,
        relation: "later",
      },
    ]);
    expect(run).toHaveBeenCalledWith(
      "github.com",
      "repos/o/r/stacks?pull_request=20",
    );
  });

  it("fails closed when stack discovery is unavailable or malformed", async () => {
    const subject = {
      origin: { pullRequestUrl: "https://github.com/o/r/pull/30" },
    };

    await expect(
      resolveReviewStackLayers(subject, [], async () => {
        throw new Error("GitHub is unavailable");
      }),
    ).resolves.toEqual([]);
    await expect(
      resolveReviewStackLayers(subject, [], async () => "{}"),
    ).resolves.toEqual([]);
  });
  it("does not invoke GitHub for a review without a canonical PR binding", async () => {
    const run = vi.fn<RunGitHubApi>();

    for (const pullRequestUrl of [
      undefined,
      "https://github.com/o/r/issues/20",
    ]) {
      expect(
        await resolveReviewStackLayers({ origin: { pullRequestUrl } }, [], run),
      ).toEqual([]);
    }

    expect(run).not.toHaveBeenCalled();
  });

  it("returns no layers for a standalone PR or a stack that does not contain it", async () => {
    const subject = {
      origin: { pullRequestUrl: "https://github.com/o/r/pull/20" },
    };

    expect(
      await resolveReviewStackLayers(subject, [], async () => "[]"),
    ).toEqual([]);
    expect(
      await resolveReviewStackLayers(subject, [], async () =>
        JSON.stringify([
          { pull_requests: [{ number: 10, head: { ref: "unrelated" } }] },
        ]),
      ),
    ).toEqual([]);
  });

  it("does not attach reviews of the same PR number in another repository", async () => {
    const result = await resolveReviewStackLayers(
      { origin: { pullRequestUrl: "https://github.com/o/r/pull/20" } },
      [
        reviewSummary({
          reviewId: "other",
          title: "Other repo",
          repositoryUrl: "https://github.com/o/other",
          pullRequestNumber: 20,
        }),
      ],
      async () =>
        JSON.stringify([
          { pull_requests: [{ number: 20, head: { ref: "feature" } }] },
        ]),
    );

    expect(result).toEqual([
      {
        branch: "feature",
        pullRequestNumber: 20,
        pullRequestUrl: "https://github.com/o/r/pull/20",
        reviewUuid: null,
        reviewTitle: null,
        relation: "current",
      },
    ]);
  });

  it("asks a GitHub Enterprise PR's own host and keys its layers there", async () => {
    const run = vi.fn<RunGitHubApi>(async () =>
      JSON.stringify([
        {
          pull_requests: [
            { number: 10, head: { ref: "a" } },
            { number: 20, head: { ref: "b" } },
          ],
        },
      ]),
    );

    const layers = await resolveReviewStackLayers(
      { origin: { pullRequestUrl: "https://ghe.example.com/o/r/pull/20" } },
      [
        reviewSummary({
          reviewId: "github-com",
          title: "Same repository name on github.com",
          repositoryUrl: "https://github.com/o/r",
          pullRequestNumber: 10,
        }),
      ],
      run,
    );

    expect(run).toHaveBeenCalledWith(
      "ghe.example.com",
      "repos/o/r/stacks?pull_request=20",
    );
    expect(
      layers.map((layer) => [layer.pullRequestUrl, layer.reviewUuid]),
    ).toEqual([
      ["https://ghe.example.com/o/r/pull/10", null],
      ["https://ghe.example.com/o/r/pull/20", null],
    ]);
  });
});
