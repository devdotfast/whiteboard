import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  ReviewApiSummary,
  ReviewStackLayer,
} from "@dev.fast/review-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type RunGitHubApi, resolveReviewStackLayers } from "./review-stack";

const reviewSummary = (input: {
  reviewId: string;
  repositoryUrl: string;
  pullRequestNumber: number;
  title: string;
  trashedAt?: string;
}): Pick<ReviewApiSummary, "reviewId" | "title" | "origin" | "trashedAt"> => ({
  reviewId: input.reviewId,
  title: input.title,
  trashedAt: input.trashedAt ?? null,
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
        { runGitHubApi: run },
      ),
    ).resolves.toEqual([
      {
        branch: "a",
        pullRequestNumber: 10,
        pullRequestUrl: "https://github.com/o/r/pull/10",
        base: null,
        subject: null,
        reviewUuid: reviewA.reviewId,
        reviewTitle: "Review A",
        relation: "earlier",
      },
      {
        branch: "b",
        pullRequestNumber: 20,
        pullRequestUrl: "https://github.com/o/r/pull/20",
        base: null,
        subject: null,
        reviewUuid: reviewB.reviewId,
        reviewTitle: "Review B",
        relation: "current",
      },
      {
        branch: "c",
        pullRequestNumber: 30,
        pullRequestUrl: "https://github.com/o/r/pull/30",
        base: null,
        subject: null,
        reviewUuid: null,
        reviewTitle: null,
        relation: "later",
      },
      {
        branch: "d",
        pullRequestNumber: 40,
        pullRequestUrl: "https://github.com/o/r/pull/40",
        base: null,
        subject: null,
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
      resolveReviewStackLayers(subject, [], {
        runGitHubApi: async () => {
          throw new Error("GitHub is unavailable");
        },
      }),
    ).resolves.toEqual([]);
    await expect(
      resolveReviewStackLayers(subject, [], { runGitHubApi: async () => "{}" }),
    ).resolves.toEqual([]);
  });
  it("does not invoke GitHub for a review without a canonical PR binding", async () => {
    const run = vi.fn<RunGitHubApi>();

    for (const pullRequestUrl of [
      undefined,
      "https://github.com/o/r/issues/20",
    ]) {
      expect(
        await resolveReviewStackLayers({ origin: { pullRequestUrl } }, [], {
          runGitHubApi: run,
        }),
      ).toEqual([]);
    }

    expect(run).not.toHaveBeenCalled();
  });

  it("returns no layers for a standalone PR or a stack that does not contain it", async () => {
    const subject = {
      origin: { pullRequestUrl: "https://github.com/o/r/pull/20" },
    };

    expect(
      await resolveReviewStackLayers(subject, [], {
        runGitHubApi: async () => "[]",
      }),
    ).toEqual([]);
    expect(
      await resolveReviewStackLayers(subject, [], {
        runGitHubApi: async () =>
          JSON.stringify([
            { pull_requests: [{ number: 10, head: { ref: "unrelated" } }] },
          ]),
      }),
    ).toEqual([]);
  });

  describe("an inferred PR chain", () => {
    const repo = { full_name: "o/r" };

    const graph = [
      {
        number: 10,
        title: "Lower",
        head: { ref: "a", repo },
        base: { ref: "main", repo },
      },
      {
        number: 20,
        title: "Middle",
        head: { ref: "b", repo },
        base: { ref: "a", repo },
      },
      {
        number: 30,
        title: "Upper",
        head: { ref: "c", repo },
        base: { ref: "b", repo },
      },
      {
        number: 40,
        title: "Fork collision",
        head: { ref: "a", repo: { full_name: "fork/r" } },
        base: { ref: "main", repo },
      },
    ];

    const run: RunGitHubApi = async (_, endpoint) =>
      endpoint.includes("/stacks?") ? "[]" : JSON.stringify(graph);

    const pins = { repositoryId: "repo", base: "base", head: "head" };

    const subject = {
      reviewId: "middle",
      pins,
      origin: {
        branch: "b",
        baseBranch: "main",
        pullRequestUrl: "https://github.com/o/r/pull/20",
        pullRequestNumber: 20,
        pullRequestBaseBranch: "a",
      },
    };

    const middle = { ...subject, title: "Middle board", trashedAt: null };

    const branchBoard = (
      reviewId: string,
      origin: NonNullable<ReviewApiSummary["origin"]>,
    ) => ({ reviewId, title: reviewId, trashedAt: null, pins, origin });

    const rows = async (
      reviews: Parameters<typeof resolveReviewStackLayers>[1],
    ) =>
      (
        await resolveReviewStackLayers(subject, reviews, { runGitHubApi: run })
      ).map((layer) => [layer.branch, layer.relation, layer.reviewUuid]);

    it("discovers it even when other PRs have no whiteboards", async () => {
      expect(await rows([middle])).toEqual([
        ["a", "earlier", null],
        ["b", "current", "middle"],
        ["c", "later", null],
      ]);
    });

    it("does not attach a board whose PR was removed by its branch", async () => {
      expect(
        await rows([
          branchBoard("detached", { branch: "a", pullRequestDetached: true }),
          middle,
        ]),
      ).toEqual([
        ["a", "earlier", null],
        ["b", "current", "middle"],
        ["c", "later", null],
      ]);
    });

    it("attaches a board by a stored origin/ branch label", async () => {
      expect(
        await rows([middle, branchBoard("legacy", { branch: "origin/c" })]),
      ).toEqual([
        ["a", "earlier", null],
        ["b", "current", "middle"],
        ["c", "later", "legacy"],
      ]);
    });
  });

  it("does not pick an arbitrary continuation when multiple PRs depend on one branch", async () => {
    const repo = { full_name: "o/r" };

    const graph = [
      {
        number: 10,
        title: "Base",
        head: { ref: "a", repo },
        base: { ref: "main", repo },
      },
      {
        number: 20,
        title: "Left",
        head: { ref: "b", repo },
        base: { ref: "a", repo },
      },
      {
        number: 30,
        title: "Right",
        head: { ref: "c", repo },
        base: { ref: "a", repo },
      },
    ];

    const result = await resolveReviewStackLayers(
      { origin: { pullRequestUrl: "https://github.com/o/r/pull/10" } },
      [],
      {
        runGitHubApi: async (_, endpoint) =>
          endpoint.includes("/stacks?") ? "[]" : JSON.stringify(graph),
      },
    );

    expect(result).toEqual([]);
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
      {
        runGitHubApi: async () =>
          JSON.stringify([
            { pull_requests: [{ number: 20, head: { ref: "feature" } }] },
          ]),
      },
    );

    expect(result).toEqual([
      {
        branch: "feature",
        pullRequestNumber: 20,
        pullRequestUrl: "https://github.com/o/r/pull/20",
        base: null,
        subject: null,
        reviewUuid: null,
        reviewTitle: null,
        relation: "current",
      },
    ]);
  });

  it("links the open review for its own PR and the newest undismissed review elsewhere", async () => {
    const review = (reviewId: string, number: number, trashedAt?: string) =>
      reviewSummary({
        reviewId,
        title: reviewId,
        repositoryUrl: "https://github.com/o/r",
        pullRequestNumber: number,
        trashedAt,
      });

    const layers = await resolveReviewStackLayers(
      {
        reviewId: "open-20",
        origin: { pullRequestUrl: "https://github.com/o/r/pull/20" },
      },
      [
        review("old-10", 10),
        review("new-10", 10),
        review("dismissed-10", 10, "2026-10-06T00:00:00.000Z"),
        review("open-20", 20),
        review("newer-20", 20),
        review("only-dismissed-30", 30, "2026-10-06T00:00:00.000Z"),
      ],
      {
        runGitHubApi: async () =>
          JSON.stringify([
            {
              pull_requests: [
                { number: 10, head: { ref: "a" } },
                { number: 20, head: { ref: "b" } },
                { number: 30, head: { ref: "c" } },
              ],
            },
          ]),
      },
    );

    expect(layers.map((layer) => layer.reviewUuid)).toEqual([
      "new-10",
      "open-20",
      "only-dismissed-30",
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
      { runGitHubApi: run },
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

it("asks GitHub once for a stack its pull requests share within a minute", async () => {
  const run = vi.fn<RunGitHubApi>(async () =>
    JSON.stringify([
      {
        pull_requests: [
          { number: 1, head: { ref: "a" } },
          { number: 2, head: { ref: "b" } },
        ],
      },
    ]),
  );

  const subject = (pullRequestNumber: number) => ({
    origin: {
      pullRequestNumber,
      pullRequestUrl: `https://github.com/o/cached/pull/${pullRequestNumber}`,
    },
  });

  const layers = (number: number) =>
    resolveReviewStackLayers(subject(number), [], { runGitHubApi: run });

  await layers(1);
  await layers(1);
  // The other pull request in the stack reads the same answer.
  await expect(layers(2)).resolves.toMatchObject([
    { pullRequestNumber: 1, relation: "earlier" },
    { pullRequestNumber: 2, relation: "current" },
  ]);
  expect(run).toHaveBeenCalledTimes(1);
});

describe("local stacks", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  // main ← a ← b ← c.
  const repository = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "review-stack-"));
    roots.push(root);

    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, stdio: "ignore" });

    git("init", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("commit", "--allow-empty", "-m", "base");

    for (const [branch, from] of [
      ["a", "main"],
      ["b", "a"],
      ["c", "b"],
    ]) {
      git("switch", "-c", branch!, from!);
      git("commit", "--allow-empty", "-m", `Start ${branch}`);
      git("commit", "--allow-empty", "-m", `Finish ${branch}`);
    }

    return root;
  };

  const review = (
    reviewId: string,
    branch: string,
    baseBranch: string,
    trashedAt: string | null = null,
  ) => ({
    reviewId,
    title: `Review ${branch}`,
    origin: { branch, baseBranch },
    trashedAt,
    project: { id: "repo", name: "repo" },
  });

  const rows = (layers: ReviewStackLayer[]) =>
    layers.map((layer) => [
      layer.branch,
      layer.relation,
      layer.reviewUuid,
      layer.base,
      layer.subject,
    ]);

  it("chains reviews through the bases they name, following the newest above", async () => {
    const root = await repository();
    const b = review("b", "b", "a");

    const layers = await resolveReviewStackLayers(
      b,
      [
        review("a", "a", "main"),
        b,
        review("c-old", "c", "b"),
        review("c", "c", "b"),
        review("c-trashed", "c", "b", "2026-10-13T00:00:00.000Z"),
        {
          ...review("other", "d", "b"),
          project: { id: "other", name: "other" },
        },
      ],
      { repositoryPath: root },
    );

    expect(rows(layers)).toEqual([
      ["a", "earlier", "a", null, null],
      ["b", "current", "b", null, null],
      ["c", "later", "c", null, null],
    ]);
  });

  it("offers an unreviewed base branch from its fork point", async () => {
    const root = await repository();

    const main = execFileSync("git", ["rev-parse", "main"], {
      cwd: root,
      encoding: "utf8",
    }).trim();

    const b = review("b", "b", "a");

    expect(
      rows(await resolveReviewStackLayers(b, [b], { repositoryPath: root })),
    ).toEqual([
      ["a", "earlier", null, main, "Start a"],
      ["b", "current", "b", null, null],
    ]);
  });
});
