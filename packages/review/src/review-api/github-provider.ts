import { parseGitRemote } from "@dev.fast/local-vcs";
import { errorMessage } from "@dev.fast/trace-core";
import { z } from "zod";

import { ReviewInputError } from "./document.js";
import type {
  CredentialOptions,
  ParsedPullRequestAddress,
  PullRequestProvider,
  PullRequestRefMap,
} from "./provider.js";
import type { PullRequestDeps, PullRequestRecord } from "./pull-request.js";

const GH_TIMEOUT_MS = 20_000;

const API_TIMEOUT_MS = 15_000;

const GITHUB_PR_REGEX =
  /^https:\/\/([a-z0-9.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)$/;

const metadataSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  baseRefName: z.string().min(1),
  baseRefOid: z.string().optional(),
});

function firstLine(text: string) {
  return text.split("\n")[0]!.slice(0, 300);
}

function unreadable(url: string, ghFailure: string, fallback: string) {
  return new ReviewInputError(
    `Could not read ${url}: gh failed (${ghFailure}) and ${fallback}. Run \`gh auth status\` and sign in with an account that can read the repository, then retry.`,
    409,
  );
}

export class GitHubProvider implements PullRequestProvider {
  readonly id = "github";

  parseUrl(url: string): ParsedPullRequestAddress | null {
    const match = GITHUB_PR_REGEX.exec(url);

    if (!match) return null;

    const [, host, owner, repo, numStr] = match;
    const number = Number(numStr);

    if (!Number.isSafeInteger(number)) return null;

    return {
      provider: this.id,
      host,
      canonicalSlug: `${owner}/${repo}`,
      number,
      rawUrl: url,
    };
  }

  async readPullRequest(
    address: ParsedPullRequestAddress,
    deps: PullRequestDeps,
  ): Promise<PullRequestRecord> {
    const { host, canonicalSlug: slug, number, rawUrl: url } = address;
    let ghFailure: string;

    try {
      const stdout = await deps.run(
        "gh",
        [
          "pr",
          "view",
          String(number),
          "--repo",
          `${host}/${slug}`,
          "--json",
          "number,title,baseRefName,baseRefOid",
        ],
        { timeoutMs: GH_TIMEOUT_MS },
      );

      return { host, slug, ...metadataSchema.parse(JSON.parse(stdout)) };
    } catch (error) {
      ghFailure = firstLine(errorMessage(error));
    }

    if (host !== "github.com")
      throw new ReviewInputError(
        `Could not read ${url}: gh failed (${ghFailure}). Run \`gh auth login --hostname ${host}\` with an account that can read the repository, then retry.`,
        409,
      );

    let response: Response;

    try {
      response = await deps.fetch(
        `https://api.github.com/repos/${slug}/pulls/${number}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );
    } catch (error) {
      throw unreadable(
        url,
        ghFailure,
        `the GitHub API is unreachable (${firstLine(errorMessage(error))})`,
      );
    }

    if (response.status === 404)
      throw new ReviewInputError(
        `${url} was not found: it does not exist, or it is private and gh is not signed in to an account that can read it (run \`gh auth status\`). gh said: ${ghFailure}`,
        404,
      );

    if (response.status === 403 || response.status === 429)
      throw unreadable(
        url,
        ghFailure,
        response.headers.get("x-ratelimit-remaining") === "0" ||
          response.status === 429
          ? "the unauthenticated GitHub API rate limit is exhausted"
          : "the GitHub API refused the request",
      );

    if (!response.ok)
      throw unreadable(
        url,
        ghFailure,
        `the GitHub API returned HTTP ${response.status}`,
      );

    const parsed = z
      .object({
        number: z.number(),
        title: z.string(),
        base: z.object({ ref: z.string().min(1), sha: z.string() }),
      })
      .safeParse(await response.json().catch(() => undefined));

    if (!parsed.success)
      throw unreadable(url, ghFailure, "the GitHub API response was malformed");

    return {
      host,
      slug,
      number: parsed.data.number,
      title: parsed.data.title,
      baseRefName: parsed.data.base.ref,
      baseRefOid: parsed.data.base.sha,
    };
  }

  pullRequestRefs(
    _address: ParsedPullRequestAddress,
    pr: PullRequestRecord,
  ): PullRequestRefMap {
    // github.com keeps the host-less namespace existing checkouts already hold.
    const repository = `${pr.host === "github.com" ? "" : `${pr.host}/`}${pr.slug}`;
    const prefix = `refs/review/github/${repository.toLowerCase()}/pull/${pr.number}`;
    const localHead = `${prefix}/head`;
    const localBase = `${prefix}/base`;
    const localFrozenBase = `${prefix}/frozen-base`;

    return {
      localHead,
      localBase,
      localFrozenBase,
      fetchRefspecs: [
        `+refs/pull/${pr.number}/head:${localHead}`,
        `+refs/heads/${pr.baseRefName}:${localBase}`,
      ],
    };
  }

  matchesRemote(remoteUrl: string, address: ParsedPullRequestAddress): boolean {
    const remote = parseGitRemote(remoteUrl);

    if (!remote) return false;

    return (
      remote.host.toLowerCase() === address.host.toLowerCase() &&
      remote.slug.toLowerCase() === address.canonicalSlug.toLowerCase()
    );
  }

  async credentialOptions(
    _address: ParsedPullRequestAddress,
    _deps: PullRequestDeps,
  ): Promise<CredentialOptions> {
    return { gitArgs: [] };
  }
}
