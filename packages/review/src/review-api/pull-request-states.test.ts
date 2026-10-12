import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { openLocalReviewStore } from "./local-data.js";
import type { PullRequestDeps } from "./pull-request.js";

const url = (number: number) => `https://github.com/acme/widget/pull/${number}`;

let directory: string;

let local: ReturnType<typeof openLocalReviewStore>;

let stop: () => void;

/** What gh answers for each PR number; a missing one fails. */
let states: Map<number, "OPEN" | "MERGED">;

let reads: number[];

let api: () => Response;

/** gh's state for a PR; undefined when gh fails. */
let gh: (number: number) => Promise<string | undefined>;

const deps: PullRequestDeps = {
  run: async (_file, args) => {
    // The PR number, as `gh pr view <number>` gets it.
    const number = Number(Object.values(Object(args[2]))[0]);
    reads.push(number);
    const state = await gh(number);

    if (!state) throw new Error("gh is signed out");

    return JSON.stringify({
      number,
      title: "PR",
      baseRefName: "main",
      headRefName: "feature",
      isCrossRepository: false,
      state,
    });
  },
  fetch: async () => api(),
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-01") });
  directory = mkdtempSync(path.join(tmpdir(), "review-pr-states-"));
  states = new Map();
  reads = [];
  api = () => new Response("{}", { status: 500 });
  gh = async (number) => states.get(number);
  local = openLocalReviewStore(path.join(directory, "reviews.db"), {
    pullRequests: deps,
    pullRequestStates: true,
  });
  stop = local.data.subscribePullRequestStates(() => {});
});

afterEach(async () => {
  stop();
  vi.useRealTimers();
  await local.store.close();
  await local.data.close();
  rmSync(directory, { recursive: true, force: true });
});

const minutes = (count: number) =>
  vi.setSystemTime(Date.now() + count * 60_000);

it("reads a PR's state in the background and tells listeners when it changes", async () => {
  states.set(1, "OPEN");
  const changed = vi.fn<() => void>();
  const unsubscribe = local.data.subscribePullRequestStates(changed);

  expect(local.data.pullRequestState(url(1))).toBeUndefined();
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(local.data.pullRequestState(url(1))).toBe("open");
  unsubscribe();
});

it("keeps the last state when a read fails, and reads a merged PR only once", async () => {
  states.set(1, "OPEN");
  states.set(2, "MERGED");
  local.data.pullRequestState(url(1));
  local.data.pullRequestState(url(2));
  await vi.waitFor(() => expect(reads).toHaveLength(2));
  await vi.waitFor(() =>
    expect(local.data.pullRequestState(url(2))).toBe("merged"),
  );

  states.delete(1);
  minutes(6);
  local.data.pullRequestState(url(1));
  local.data.pullRequestState(url(2));
  await vi.waitFor(() => expect(reads).toEqual([1, 2, 1]));
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(local.data.pullRequestState(url(1))).toBe("open");
});

it("reads at most two PRs at once", async () => {
  const releases: (() => void)[] = [];

  gh = async (number) => {
    await new Promise<void>((resolve) => releases.push(resolve));

    return "OPEN";
  };

  for (const number of [1, 2, 3, 4]) local.data.pullRequestState(url(number));
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(releases).toHaveLength(2);

  for (const release of releases.splice(0)) release();
  await vi.waitFor(() => expect(releases).toHaveLength(2));

  for (const release of releases.splice(0)) release();
  await vi.waitFor(() =>
    expect(local.data.pullRequestState(url(4))).toBe("open"),
  );
});

it("stops reading while GitHub rate-limits, until it says to retry", async () => {
  const reset = Math.floor(Date.now() / 1000) + 600;

  api = () =>
    new Response("{}", {
      status: 403,
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(reset),
      },
    });

  local.data.pullRequestState(url(1));
  await vi.waitFor(() => expect(reads).toEqual([1]));
  await new Promise((resolve) => setTimeout(resolve, 50));

  local.data.pullRequestState(url(2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(reads).toEqual([1]);

  minutes(11);
  states.set(2, "OPEN");
  local.data.pullRequestState(url(3));
  await vi.waitFor(() => expect(reads).toEqual([1, 2, 3]));
});
