import { defaultBranch, git, runVcs } from "@dev.fast/local-vcs";
import type {
  ReviewApiSummary,
  ReviewStackLayer,
} from "@dev.fast/review-protocol";
import { z } from "zod";

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

export type RunGitHubApi = (host: string, endpoint: string) => Promise<string>;

type Subject = Pick<ReviewApiSummary, "origin"> & { reviewId?: string };

type Candidate = Pick<
  ReviewApiSummary,
  "reviewId" | "title" | "origin" | "pins" | "trashedAt" | "project"
>;

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

async function gitHubStack(
  subject: Subject,
  reviews: readonly Candidate[],
  runGitHubApi: RunGitHubApi,
): Promise<StackEntry[]> {
  const binding = subject.origin?.pullRequestUrl?.match(
    /^https:\/\/([a-z0-9.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)$/,
  );

  if (!binding) return [];
  const [, host, owner, repository, number] = binding;
  const pullRequestNumber = Number(number);
  const repoKey = `https://${host}/${owner}/${repository}`;
  let stacks: z.infer<typeof GitHubStacksSchema>;

  try {
    stacks = GitHubStacksSchema.parse(
      JSON.parse(
        await runGitHubApi(
          host!,
          `repos/${owner}/${repository}/stacks?pull_request=${number}`,
        ),
      ),
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

/** The chain of reviews through this one, linked by the base each names. */
async function localStack(
  subject: Subject,
  reviews: readonly Candidate[],
  repositoryPath: string,
): Promise<StackEntry[]> {
  const group = reviews.find((review) => review.reviewId === subject.reviewId)
    ?.project?.id;

  const current = subject.origin?.branch;

  if (!group || !current) return [];

  const main = subject.origin?.baseBranch
    ? await defaultBranch(repositoryPath).catch(() => null)
    : null;

  const name = (ref: string) => ref.replace(/^origin\//, "");

  const inGroup = reviews.filter((review) => review.project?.id === group);

  const latest = (field: "branch" | "baseBranch", branch: string) => {
    const matches = inGroup.filter(
      (review) => review.origin?.[field] === branch,
    );

    return matches.findLast((review) => !review.trashedAt) ?? matches.at(-1);
  };

  const branches = [current];

  for (
    let base = subject.origin?.baseBranch;
    base && name(base) !== (main && name(main.ref)) && !branches.includes(base);
    base = latest("branch", base)?.origin?.baseBranch
  )
    branches.unshift(base);

  for (
    let child = latest("baseBranch", current)?.origin?.branch;
    child && !branches.includes(child);
    child = latest("baseBranch", child)?.origin?.branch
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
    reviews: inGroup.filter((review) => review.origin?.branch === branch),
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
