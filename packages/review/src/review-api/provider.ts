import { ReviewInputError } from "./document.js";
import { githubProvider } from "./github-provider.js";
import type { PullRequestDeps, PullRequestRecord } from "./pull-request.js";

export interface PullRequestAddress {
  host: string;
  slug: string;
  number: number;
}

export interface PullRequestProvider {
  /** Names Review's ref namespace: refs/review/<id>/... */
  id: string;
  /** Recognizes this forge's PR URLs and extracts host, repo and number. */
  parseUrl(url: string): PullRequestAddress | undefined;
  /** Asks the forge for the PR's title, base branch and head ref. */
  readPullRequest(
    address: PullRequestAddress,
    deps: PullRequestDeps,
  ): Promise<PullRequestRecord>;
  /** Picks the local remote to fetch the PR from. */
  matchesRemote(remoteUrl: string, address: PullRequestAddress): boolean;
}

const providers: PullRequestProvider[] = [githubProvider];

export function pullRequestProvider(url: string) {
  for (const provider of providers) {
    const address = provider.parseUrl(url);

    if (address) return { provider, address };
  }

  return undefined;
}

export function resolvePullRequest(url: string) {
  const resolution = pullRequestProvider(url);

  if (!resolution)
    throw new ReviewInputError(`Unsupported pull request URL: ${url}`, 400);

  return resolution;
}
