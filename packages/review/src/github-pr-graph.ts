import { z } from "zod";

export type RunGitHubApi = (host: string, endpoint: string) => Promise<string>;

const repository = z.object({ full_name: z.string() });

const pullRequest = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  draft: z.boolean().optional(),
  head: z.object({ ref: z.string(), repo: repository.nullable() }),
  base: z.object({ ref: z.string(), repo: repository }),
});

export interface GitHubPullRequest {
  number: number;
  url: string;
  title: string;
  headBranch: string;
  baseBranch: string;
  draft: boolean;
}

// Repository facts are independent of which PRs have whiteboards. Share a
// short-lived, coalesced read between source resolution and stack discovery.
const caches = new WeakMap<
  RunGitHubApi,
  Map<
    string,
    {
      expires: number;
      read: Promise<GitHubPullRequest[]>;
    }
  >
>();

export function readGitHubPullRequests(
  host: string,
  slug: string,
  run: RunGitHubApi,
): Promise<GitHubPullRequest[]> {
  let cache = caches.get(run);

  if (!cache) caches.set(run, (cache = new Map()));
  const key = `${host}/${slug}`.toLowerCase();
  const previous = cache.get(key);

  if (previous && previous.expires > Date.now()) return previous.read;

  const read = (async () => {
    const result: GitHubPullRequest[] = [];

    for (let page = 1; page <= 10; page++) {
      const records = z
        .array(pullRequest)
        .parse(
          JSON.parse(
            await run(
              host,
              `repos/${slug}/pulls?state=open&per_page=100&page=${page}`,
            ),
          ),
        );

      for (const pr of records) {
        // A fork's identically named branch is not this repository's branch.
        if (
          pr.head.repo?.full_name.toLowerCase() !== slug.toLowerCase() ||
          pr.base.repo.full_name.toLowerCase() !== slug.toLowerCase()
        )
          continue;
        result.push({
          number: pr.number,
          url: `https://${host}/${slug}/pull/${pr.number}`,
          title: pr.title,
          headBranch: pr.head.ref,
          baseBranch: pr.base.ref,
          draft: pr.draft ?? false,
        });
      }

      if (records.length < 100) return result;
    }

    throw new Error(
      "PR discovery exceeded 1000 open pull requests; refusing a partial stack.",
    );
  })();

  cache.set(key, { expires: Date.now() + 60_000, read });
  // Failures are optional context, but must not poison the next read.
  void read.catch(() => {
    if (cache.get(key)?.read === read) cache.delete(key);
  });

  return read;
}
