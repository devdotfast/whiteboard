import { describe, expect, it, vi } from "vitest";

import { type RunGitHubApi, readGitHubPullRequests } from "./github-pr-graph";

const repo = { full_name: "o/r" };

const record = (number: number) => ({
  number,
  title: `PR ${number}`,
  head: { ref: `feature-${number}`, repo },
  base: { ref: "main", repo },
});

describe("repository PR facts", () => {
  it("reads beyond the first page and coalesces concurrent consumers", async () => {
    const run = vi.fn<RunGitHubApi>(async (_host: string, endpoint: string) =>
      JSON.stringify(
        endpoint.endsWith("page=1")
          ? Array.from({ length: 100 }, (_, index) => record(index + 1))
          : [record(101)],
      ),
    );

    const [first, second] = await Promise.all([
      readGitHubPullRequests("github.com", "o/r", run),
      readGitHubPullRequests("github.com", "o/r", run),
    ]);

    expect(first).toHaveLength(101);
    expect(second).toEqual(first);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("allows a new read after a transient failure", async () => {
    const run = vi
      .fn<RunGitHubApi>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(JSON.stringify([record(1)]));

    await expect(
      readGitHubPullRequests("github.com", "o/r", run),
    ).rejects.toThrow("offline");
    await expect(
      readGitHubPullRequests("github.com", "o/r", run),
    ).resolves.toMatchObject([{ number: 1 }]);
  });
});
