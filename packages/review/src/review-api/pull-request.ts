import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

import { type LocalVcsKind, parseGitRemote } from "@dev.fast/local-vcs";
import { errorMessage } from "@dev.fast/trace-core";

import { ReviewInputError } from "./document.js";
import {
  type ParsedPullRequestAddress,
  type PullRequestProvider,
  type PullRequestRefMap,
  resolvePullRequestProvider,
} from "./provider.js";

export * from "./provider.js";

export { GitHubProvider } from "./github-provider.js";

/** Runs one subprocess and resolves its stdout; rejects on failure or timeout. */
export type RunCommand = (
  file: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
) => Promise<string>;

export interface PullRequestDeps {
  run: RunCommand;
  fetch: typeof fetch;
}

/** What a forge says about a PR; the commits are fetched separately. */
export interface PullRequestRecord {
  host: string;
  slug: string;
  number: number;
  title: string;
  baseRefName: string;
  /** Forge's base commit, frozen at the PR's last update. */
  baseRefOid?: string;
}

const FETCH_TIMEOUT_MS = 120_000;

const LOCAL_TIMEOUT_MS = 30_000;

export const defaultPullRequestDeps: PullRequestDeps = {
  run: (file, args, options) =>
    new Promise((resolve, reject) => {
      execFile(
        file,
        args,
        {
          cwd: options.cwd,
          timeout: options.timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
          // Never wait on a credential or confirmation prompt nobody can see.
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GH_PROMPT_DISABLED: "1",
            GIT_SSH_COMMAND:
              process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
          },
        },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout);

          const reason = error.killed
            ? `timed out after ${options.timeoutMs / 1000}s`
            : String(stderr).trim() || error.message;

          reject(new Error(`${file} ${args[0]}: ${reason}`));
        },
      );
    }),
  fetch: (input, init) => fetch(input, init),
};

/** Host, owner/repo and number from a canonical PR URL (validated by the command schema). */
export function pullRequestAddress(url: string) {
  const resolution = resolvePullRequestProvider(url);

  if (resolution) {
    return {
      host: resolution.address.host,
      slug: resolution.address.canonicalSlug,
      number: resolution.address.number,
    };
  }

  const { hostname, pathname } = new URL(url);
  const [, owner, repo, , number] = pathname.split("/");

  return { host: hostname, slug: `${owner}/${repo}`, number: Number(number) };
}

/** Delegates PR metadata reading to the resolved provider. */
export async function readPullRequest(
  url: string,
  deps: PullRequestDeps,
): Promise<PullRequestRecord> {
  const resolution = resolvePullRequestProvider(url);

  if (!resolution)
    throw new ReviewInputError(`Unsupported pull request URL: ${url}`, 400);

  return resolution.provider.readPullRequest(resolution.address, deps);
}

/** Remotes by the host and owner/repo their configured URL names. The
 * configured URL, not the insteadOf rewrite: a mirror still names its repo. */
export async function githubRemotes(
  gitDir: string,
  deps: PullRequestDeps,
): Promise<{ name: string; host: string; slug: string }[]> {
  const stdout = await deps
    .run(
      "git",
      [
        "--git-dir",
        gitDir,
        "config",
        "--get-regexp",
        String.raw`^remote\..*\.url$`,
      ],
      { timeoutMs: LOCAL_TIMEOUT_MS },
    )
    .catch(() => "");

  return stdout.split("\n").flatMap((line) => {
    const match = /^remote\.(.+)\.url\s+(\S+)/.exec(line.trim());
    const remote = match && parseGitRemote(match[2]!);

    return match && remote
      ? [{ name: match[1]!, host: remote.host, slug: remote.slug }]
      : [];
  });
}

/** Refs Review owns for one PR; the user's branches and bookmarks never move. */
export function pullRequestRefs(pr: {
  host: string;
  slug: string;
  number: number;
}) {
  // github.com keeps the host-less namespace existing checkouts already hold.
  const repository = `${pr.host === "github.com" ? "" : `${pr.host}/`}${pr.slug}`;
  const prefix = `refs/review/github/${repository.toLowerCase()}/pull/${pr.number}`;

  return {
    head: `${prefix}/head`,
    base: `${prefix}/base`,
    frozenBase: `${prefix}/frozen-base`,
  };
}

/**
 * Fetch the PR head (e.g. refs/pull/N/head for GitHub, so fork PRs work) and its base branch
 * into Review's own namespace, and return the comparison shown: the
 * head, and the merge base of the head with the base branch.
 *
 * A PR merged with a merge commit is absorbed: merge-base(base branch, head)
 * is the head itself and the diff is empty. The provider freezes the base commit
 * (baseRefOid) at the PR's last update, so its merge base with the head is
 * the fork point diffed against, and it survives base branches that are
 * force-rebuilt or deleted.
 */
export async function fetchPullRequest(
  input: {
    rootPath: string;
    gitDir: string;
    kind: LocalVcsKind;
    remote: string;
    pullRequest: PullRequestRecord;
    url?: string;
  },
  deps: PullRequestDeps,
): Promise<{ head: string; base: string }> {
  const { pullRequest: pr } = input;
  const prUrl = input.url ?? `https://${pr.host}/${pr.slug}/pull/${pr.number}`;
  const resolution = resolvePullRequestProvider(prUrl);

  if (!resolution)
    throw new ReviewInputError(`Unsupported pull request URL: ${prUrl}`, 400);

  const { provider, address } = resolution;
  const refMap: PullRequestRefMap = provider.pullRequestRefs(address, pr);
  const credentials = await provider.credentialOptions(address, deps);

  const git = (args: string[], timeoutMs = LOCAL_TIMEOUT_MS) =>
    deps
      .run("git", ["--git-dir", input.gitDir, ...args], { timeoutMs })
      .then((stdout) => stdout.trim());

  const fetchRefs = (...refspecs: string[]) =>
    git(
      [
        ...credentials.gitArgs,
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--quiet",
        input.remote,
        ...refspecs,
      ],
      FETCH_TIMEOUT_MS,
    );

  const commit = (ref: string) =>
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).catch(
      () => undefined,
    );

  const mergeBase = (left: string, right: string) =>
    git(["merge-base", left, right]).catch(() => undefined);

  const frozenBase = async () => {
    if (!pr.baseRefOid) return undefined;

    if (!(await commit(pr.baseRefOid)))
      await fetchRefs(`+${pr.baseRefOid}:${refMap.localFrozenBase}`).catch(
        () => undefined,
      );

    return commit(pr.baseRefOid);
  };

  let baseTip: string | undefined;

  try {
    await fetchRefs(...refMap.fetchRefspecs);
    baseTip = await commit(refMap.localBase);
  } catch (error) {
    // The base branch may be gone; the head and the frozen base suffice.
    try {
      await fetchRefs(`+refs/pull/${pr.number}/head:${refMap.localHead}`);
    } catch {
      throw new ReviewInputError(
        `Could not fetch PR #${pr.number} from remote "${input.remote}" (${pr.slug}). Check \`git fetch ${input.remote}\` works with your Git credentials, then retry. Git said: ${firstLine(errorMessage(error))}`,
        409,
      );
    }
  }

  const head = await commit(refMap.localHead);

  baseTip ??= await frozenBase();

  if (!head || !baseTip)
    throw new ReviewInputError(
      `Fetched PR #${pr.number} but could not resolve its ${head ? `base branch ${pr.baseRefName}` : "head"}.`,
      409,
    );

  let base = await mergeBase(baseTip, head);

  if (!base || base === head) {
    const frozen = await frozenBase();

    if (frozen && frozen !== baseTip)
      base = (await mergeBase(frozen, head)) ?? base;
  }

  if (!base)
    throw new ReviewInputError(
      `PR #${pr.number}'s head shares no history with ${pr.baseRefName}.`,
      409,
    );

  if (input.kind === "jj")
    await indexForJj(input.rootPath, [base, head], git, deps);

  return { head, base };
}

/**
 * jj resolves only commits in its index, and `jj git import` indexes only
 * branches, remote branches and tags. Import the commits through a
 * transient tag, then drop it: the commits stay indexed (hidden, resolvable
 * by commit id) and no bookmark or tag remains.
 */
async function indexForJj(
  rootPath: string,
  commits: string[],
  git: (args: string[]) => Promise<string>,
  deps: PullRequestDeps,
) {
  const tags = commits.map(() => `refs/tags/review-index-${randomUUID()}`);

  const jjImport = () =>
    deps.run(
      "jj",
      ["-R", rootPath, "git", "import", "--ignore-working-copy", "--quiet"],
      { cwd: rootPath, timeoutMs: LOCAL_TIMEOUT_MS },
    );

  try {
    for (const [index, tag] of tags.entries())
      await git(["update-ref", tag, commits[index]!]);
    await jjImport();
  } finally {
    for (const tag of tags)
      await git(["update-ref", "-d", tag]).catch(() => undefined);
    await jjImport().catch(() => undefined);
  }
}

function firstLine(text: string) {
  return text.split("\n")[0]!.slice(0, 300);
}
