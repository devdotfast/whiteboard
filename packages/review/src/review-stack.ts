import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  ReviewApiSummary,
  ReviewStackLayer,
} from "@dev.fast/review-protocol";
import { z } from "zod";

const execFileAsync = promisify(execFile);

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
  "reviewId" | "title" | "origin" | "pins" | "trashedAt"
>;

interface StackEntry {
  branch: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  current: boolean;
  reviews: readonly Candidate[];
}

export async function resolveReviewStackLayers(
  subject: Subject,
  reviews: readonly Candidate[],
  runGitHubApi: RunGitHubApi = defaultRunGitHubApi,
): Promise<ReviewStackLayer[]> {
  const entries = await gitHubStack(subject, reviews, runGitHubApi);

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
    current: pr.number === pullRequestNumber,
    reviews: reviews.filter(
      (candidate) =>
        (candidate.origin?.pullRequestUrl?.replace(/\/pull\/\d+.*$/, "") ??
          candidate.pins?.repositoryId) === repoKey &&
        candidate.origin?.pullRequestNumber === pr.number,
    ),
  }));
}

async function defaultRunGitHubApi(
  host: string,
  endpoint: string,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", "--hostname", host, endpoint],
    {
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );

  return stdout;
}
