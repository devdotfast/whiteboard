import { defaultBranch, git, runVcs } from "@dev.fast/local-vcs";
import type {
  ReviewApiSummary,
  ReviewStackLayer,
} from "@dev.fast/review-protocol";
import { z } from "zod";

import {
  type RunGitHubApi,
  readGitHubPullRequests,
} from "./github-pr-graph.js";
import { pullRequestKey, sourceBranchName } from "./review-api/origin.js";
import { pullRequestProvider } from "./review-api/provider.js";

export type { RunGitHubApi };

const GitHubStacksSchema = z.array(
  z.object({
    pull_requests: z.array(
      z.object({
        number: z.number().int().positive(),
        head: z.object({ ref: z.string().min(1) }),
      }),
    ),
  }),
);

type Subject = Pick<ReviewApiSummary, "origin" | "pins"> & {
  reviewId?: string;
};

type Candidate = Pick<
  ReviewApiSummary,
  "reviewId" | "title" | "origin" | "pins" | "trashedAt" | "project"
>;

/** The branch a review sits on: its PR's target, else the base it names. */
const baseOf = (review?: Pick<ReviewApiSummary, "origin">) =>
  sourceBranchName(
    review?.origin?.pullRequestBaseBranch ?? review?.origin?.baseBranch,
  );

/** A GitHub PR URL's host, owner/repo slug and number; else undefined. */
function gitHubPullRequest(url: string | undefined) {
  const resolution = url ? pullRequestProvider(url) : undefined;

  return resolution?.provider.id === "github" ? resolution.address : undefined;
}

interface StackEntry {
  branch: string;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  base: string | null;
  subject: string | null;
  current: boolean;
  reviews: readonly Candidate[];
}

/** The review's GitHub stack, else the chain of reviews through its base. */
export async function resolveReviewStackLayers(
  subject: Subject,
  reviews: readonly Candidate[],
  options: { runGitHubApi?: RunGitHubApi; repositoryPath?: string } = {},
): Promise<ReviewStackLayer[]> {
  let entries = await gitHubStack(
    subject,
    reviews,
    options.runGitHubApi ?? defaultRunGitHubApi,
  );

  if (entries.length < 2) {
    const discovered = await inferredGitHubStack(
      subject,
      reviews,
      options.runGitHubApi ?? defaultRunGitHubApi,
    ).catch(() => []);

    if (discovered.length > 1) entries = discovered;
  }

  if (!entries.length && options.repositoryPath)
    entries = await localStack(subject, reviews, options.repositoryPath);

  const currentIndex = entries.findIndex((entry) => entry.current);

  return entries.map((entry, index) => {
    const review =
      entry.reviews.find(
        (candidate) => candidate.reviewId === subject.reviewId,
      ) ??
      entry.reviews.findLast((candidate) => !candidate.trashedAt) ??
      entry.reviews.at(-1);

    return {
      branch: entry.branch,
      pullRequestNumber: entry.pullRequestNumber,
      pullRequestUrl: entry.pullRequestUrl,
      base: entry.base,
      subject: entry.subject,
      reviewUuid: review?.reviewId ?? null,
      reviewTitle: review?.title ?? null,
      relation:
        index < currentIndex
          ? "earlier"
          : index === currentIndex
            ? "current"
            : "later",
    };
  });
}

type GitHubStacks = z.infer<typeof GitHubStacksSchema>;

// One GitHub answer serves every pull request in a stack for a minute.
const STACKS_FRESH_MS = 60_000;

const stackReads = new WeakMap<
  RunGitHubApi,
  Map<string, { at: number; stacks: Promise<GitHubStacks> }>
>();

function readGitHubStacks(
  runGitHubApi: RunGitHubApi,
  host: string,
  repository: string,
  pullRequestNumber: number,
): Promise<GitHubStacks> {
  const reads = stackReads.get(runGitHubApi) ?? new Map();

  stackReads.set(runGitHubApi, reads);

  const keyOf = (number: number) => `${host}/${repository}#${number}`;
  const cached = reads.get(keyOf(pullRequestNumber));

  if (cached && Date.now() - cached.at < STACKS_FRESH_MS) return cached.stacks;

  const read = {
    at: Date.now(),
    stacks: runGitHubApi(
      host,
      `repos/${repository}/stacks?pull_request=${pullRequestNumber}`,
    ).then((text) => GitHubStacksSchema.parse(JSON.parse(text))),
  };

  reads.set(keyOf(pullRequestNumber), read);
  read.stacks.then(
    (stacks) => {
      const stack = stacks.find((candidate) =>
        candidate.pull_requests.some((pr) => pr.number === pullRequestNumber),
      );

      for (const pr of stack?.pull_requests ?? [])
        reads.set(keyOf(pr.number), read);
    },
    () => {
      if (reads.get(keyOf(pullRequestNumber)) === read)
        reads.delete(keyOf(pullRequestNumber));
    },
  );

  return read.stacks;
}

async function gitHubStack(
  subject: Subject,
  reviews: readonly Candidate[],
  runGitHubApi: RunGitHubApi,
): Promise<StackEntry[]> {
  const binding = gitHubPullRequest(subject.origin?.pullRequestUrl);

  if (!binding) return [];
  const { host, slug, number: pullRequestNumber } = binding;
  const repoKey = `https://${host}/${slug}`;
  let stacks: GitHubStacks;

  try {
    stacks = await readGitHubStacks(
      runGitHubApi,
      host,
      slug,
      pullRequestNumber,
    );
  } catch {
    // Stack discovery must not make the Review unavailable when GitHub or
    // authentication is unavailable, or stacks are not enabled for the repo.
    return [];
  }

  const stack = stacks.find((candidate) =>
    candidate.pull_requests.some((pr) => pr.number === pullRequestNumber),
  );

  return (stack?.pull_requests ?? []).map((pr) => ({
    branch: pr.head.ref,
    pullRequestNumber: pr.number,
    pullRequestUrl: `${repoKey}/pull/${pr.number}`,
    base: null,
    subject: null,
    current: pr.number === pullRequestNumber,
    reviews: reviews.filter(
      (candidate) =>
        (candidate.origin?.pullRequestUrl?.replace(/\/pull\/\d+.*$/, "") ??
          candidate.pins?.repositoryId) === repoKey &&
        candidate.origin?.pullRequestNumber === pr.number,
    ),
  }));
}

/** A stack inferred from open PRs whose bases chain through this one's, for
 * repositories without GitHub stacks. Whiteboards only annotate the result. */
async function inferredGitHubStack(
  subject: Subject,
  reviews: readonly Candidate[],
  run: RunGitHubApi,
): Promise<StackEntry[]> {
  const binding = gitHubPullRequest(subject.origin?.pullRequestUrl);

  if (!binding) return [];
  const graph = await readGitHubPullRequests(binding.host, binding.slug, run);
  const current = graph.find((pr) => pr.number === binding.number);

  if (!current) return [];
  const chain = [current];
  const seen = new Set([current.headBranch]);

  const extend = (direction: "base" | "head") => {
    let end = current;

    for (;;) {
      const matches = graph.filter((pr) =>
        direction === "base"
          ? pr.headBranch === end.baseBranch
          : pr.baseBranch === end.headBranch,
      );

      if (matches.length !== 1 || seen.has(matches[0]!.headBranch)) return;
      end = matches[0]!;
      seen.add(end.headBranch);

      if (direction === "base") chain.unshift(end);
      else chain.push(end);
    }
  };

  extend("base");
  extend("head");

  if (chain.length < 2) return [];

  const project = reviews.find((review) => review.reviewId === subject.reviewId)
    ?.project?.id;

  return chain.map((pr) => ({
    branch: pr.headBranch,
    pullRequestNumber: pr.number,
    pullRequestUrl: pr.url,
    base: null,
    subject: pr.title,
    current: pr.number === current.number,
    reviews: reviews.filter((review) => {
      const candidateUrl = review.origin?.pullRequestUrl;

      if (candidateUrl)
        return pullRequestKey(candidateUrl) === pullRequestKey(pr.url);

      const sameRepository = subject.pins?.repositoryId
        ? review.pins?.repositoryId === subject.pins.repositoryId
        : Boolean(project && review.project?.id === project);

      return (
        sameRepository &&
        sourceBranchName(review.origin?.branch) === pr.headBranch
      );
    }),
  }));
}

/** The chain of reviews through this one, linked by the base each names. */
async function localStack(
  subject: Subject,
  reviews: readonly Candidate[],
  repositoryPath: string,
): Promise<StackEntry[]> {
  const group = reviews.find((review) => review.reviewId === subject.reviewId)
    ?.project?.id;

  const current = sourceBranchName(subject.origin?.branch);
  const currentBase = baseOf(subject);

  if (!group || !current) return [];

  const main = currentBase
    ? await defaultBranch(repositoryPath).catch(() => null)
    : null;

  const inGroup = reviews.filter((review) => review.project?.id === group);

  const branchOf = (review?: Candidate) =>
    sourceBranchName(review?.origin?.branch);

  const latest = (field: "branch" | "baseBranch", branch: string) => {
    const matches = inGroup.filter(
      (review) =>
        (field === "branch" ? branchOf(review) : baseOf(review)) === branch,
    );

    return matches.findLast((review) => !review.trashedAt) ?? matches.at(-1);
  };

  const branches = [current];

  for (
    let base = currentBase;
    base &&
    base !== (main && sourceBranchName(main.ref)) &&
    !branches.includes(base);
    base = baseOf(latest("branch", base))
  )
    branches.unshift(base);

  for (
    let child = branchOf(latest("baseBranch", current));
    child && !branches.includes(child);
    child = branchOf(latest("baseBranch", child))
  )
    branches.push(child);

  const bottom = branches[0]!;

  // A base nobody reviewed gets a row; a new review of it starts at its fork.
  const start =
    latest("branch", bottom) || !main
      ? null
      : await forkPoint(repositoryPath, main.commit, bottom);

  if (!latest("branch", bottom) && !start) branches.shift();

  if (branches.length < 2) return [];

  return branches.map((branch) => ({
    branch,
    pullRequestNumber:
      latest("branch", branch)?.origin?.pullRequestNumber ?? null,
    pullRequestUrl: latest("branch", branch)?.origin?.pullRequestUrl ?? null,
    base: (branch === bottom && start?.base) || null,
    subject: (branch === bottom && start?.subject) || null,
    current: branch === current,
    reviews: inGroup.filter((review) => branchOf(review) === branch),
  }));
}

/** Where a local branch left `main`, and its oldest commit's subject. */
async function forkPoint(repositoryPath: string, main: string, branch: string) {
  const ref = `refs/heads/${branch}`;

  const fork = await git(
    repositoryPath,
    ["merge-base", { rev: main }, { rev: ref }],
    {
      allowFailure: true,
    },
  );

  if (!fork.ok) return null;

  const base = fork.stdout.trim();

  const log = await git(
    repositoryPath,
    ["log", "--reverse", "--format=%s", { rev: `${base}..${ref}` }],
    { allowFailure: true },
  );

  return { base, subject: log.stdout.split("\n")[0] || null };
}

async function defaultRunGitHubApi(
  host: string,
  endpoint: string,
): Promise<string> {
  const { stdout } = await runVcs(
    "gh",
    ["api", "--hostname", { value: host }, { value: endpoint }],
    { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
  );

  return stdout;
}
