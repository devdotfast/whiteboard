import { parseGitRemote } from "@dev.fast/local-vcs";
import type { PullRequestState } from "@dev.fast/review-protocol";
import { errorMessage } from "@dev.fast/trace-core";
import { z } from "zod";

import { ReviewInputError } from "./document.js";
import type { PullRequestProvider } from "./provider.js";
import { GitHubRefusedRead, firstLine } from "./pull-request.js";

const GH_TIMEOUT_MS = 20_000;

const API_TIMEOUT_MS = 15_000;

const GITHUB_PR_REGEX =
  /^https:\/\/([a-z0-9.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)$/;

const metadataSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  baseRefName: z.string().min(1),
  baseRefOid: z.string().optional(),
  headRefName: z.string().min(1),
  isCrossRepository: z.boolean(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]).optional(),
  isDraft: z.boolean().optional(),
});

/** gh's state and draft flag as one state. */
function ghState(
  state: "OPEN" | "CLOSED" | "MERGED" | undefined,
  isDraft: boolean | undefined,
): PullRequestState | undefined {
  if (state === "MERGED") return "merged";

  if (state === "CLOSED") return "closed";

  if (state === "OPEN") return isDraft ? "draft" : "open";

  return undefined;
}

function unreadable(url: string, ghFailure: string, fallback: string) {
  return new ReviewInputError(
    `Could not read ${url}: gh failed (${ghFailure}) and ${fallback}. Run \`gh auth status\` and sign in with an account that can read the repository, then retry.`,
    409,
  );
}

export const githubProvider: PullRequestProvider = {
  id: "github",

  parseUrl(url) {
    const match = GITHUB_PR_REGEX.exec(url);
    const number = Number(match?.[4]);

    if (!match || !Number.isSafeInteger(number)) return undefined;

    return { host: match[1]!, slug: `${match[2]}/${match[3]}`, number };
  },

  /** gh first (it carries the user's auth), then, for github.com only, GitHub's
   * public REST API: Enterprise hosts require gh. */
  async readPullRequest({ host, slug, number }, deps) {
    const url = `https://${host}/${slug}/pull/${number}`;
    const headRef = `refs/pull/${number}/head`;
    let ghFailure: string;

    try {
      const stdout = await deps.run(
        "gh",
        [
          "pr",
          "view",
          { value: String(number) },
          "--repo",
          { value: `${host}/${slug}` },
          "--json",
          "number,title,baseRefName,baseRefOid,headRefName,isCrossRepository,state,isDraft",
        ],
        { timeoutMs: GH_TIMEOUT_MS },
      );

      const { headRefName, isCrossRepository, state, isDraft, ...metadata } =
        metadataSchema.parse(JSON.parse(stdout));

      const pullRequestState = ghState(state, isDraft);

      return {
        host,
        slug,
        headRef,
        ...metadata,
        headBranch: isCrossRepository ? undefined : headRefName,
        ...(pullRequestState && { state: pullRequestState }),
      };
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

    if (response.status === 403 || response.status === 429) {
      const reset = Number(response.headers.get("x-ratelimit-reset"));

      throw new GitHubRefusedRead(
        unreadable(
          url,
          ghFailure,
          response.headers.get("x-ratelimit-remaining") === "0" ||
            response.status === 429
            ? "the unauthenticated GitHub API rate limit is exhausted"
            : "the GitHub API refused the request",
        ).message,
        reset > 0 ? reset * 1000 : Date.now() + 15 * 60_000,
      );
    }

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
        base: z.object({
          ref: z.string().min(1),
          sha: z.string(),
          repo: z.object({ id: z.number() }),
        }),
        head: z.object({
          ref: z.string().min(1),
          repo: z.object({ id: z.number() }).nullable(),
        }),
        state: z.enum(["open", "closed"]).optional(),
        draft: z.boolean().optional(),
        merged_at: z.string().nullable().optional(),
      })
      .safeParse(await response.json().catch(() => undefined));

    if (!parsed.success)
      throw unreadable(url, ghFailure, "the GitHub API response was malformed");

    return {
      host,
      slug,
      headRef,
      number: parsed.data.number,
      title: parsed.data.title,
      baseRefName: parsed.data.base.ref,
      baseRefOid: parsed.data.base.sha,
      headBranch:
        parsed.data.head.repo?.id === parsed.data.base.repo.id
          ? parsed.data.head.ref
          : undefined,
      ...(parsed.data.state && {
        state: parsed.data.merged_at
          ? "merged"
          : parsed.data.state === "closed"
            ? "closed"
            : parsed.data.draft
              ? "draft"
              : "open",
      }),
    };
  },

  matchesRemote(remoteUrl, address) {
    const remote = parseGitRemote(remoteUrl);

    return (
      remote?.host === address.host &&
      remote.slug.toLowerCase() === address.slug.toLowerCase()
    );
  },
};
