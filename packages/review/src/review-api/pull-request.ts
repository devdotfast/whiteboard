import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import {
  type LocalVcsKind,
  type VcsArg,
  renderVcsArgs,
  runVcs,
} from "@dev.fast/local-vcs";
import type { PullRequestState } from "@dev.fast/review-protocol";
import { errorMessage } from "@dev.fast/trace-core";

import { ReviewInputError } from "./document.js";

/** Runs one subprocess and resolves its stdout; rejects on failure or
 * timeout. git, jj and gh go through the VCS runner; Azure DevOps's az (by
 * way of cmd.exe on Windows) gets its operands checked the same way. */
export type RunCommand = (
  file: "git" | "jj" | "gh" | "az" | "cmd.exe",
  args: VcsArg[],
  options: { cwd?: string; timeoutMs: number },
) => Promise<string>;

const execFileAsync = promisify(execFile);

export interface PullRequestDeps {
  run: RunCommand;
  fetch: typeof fetch;
}

/** What GitHub says about a PR; the commits are fetched separately. */
export interface PullRequestRecord {
  host: string;
  slug: string;
  number: number;
  title: string;
  /** e.g. refs/pull/7/head */
  headRef: string;
  baseRefName: string;
  /** Absent when the head lives in a fork. */
  headBranch?: string;
  /** GitHub's base commit, frozen at the PR's last update. */
  baseRefOid?: string;
  state?: PullRequestState;
}

const FETCH_TIMEOUT_MS = 120_000;

const LOCAL_TIMEOUT_MS = 30_000;

export const defaultPullRequestDeps: PullRequestDeps = {
  run: async (file, args, options) => {
    const spawnOptions = {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      // Never wait on ssh asking for a passphrase nobody can see.
      env: {
        ...process.env,
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
      },
    };

    try {
      return (
        file === "az" || file === "cmd.exe"
          ? await execFileAsync(file, renderVcsArgs(args), {
              ...spawnOptions,
              encoding: "utf8",
            })
          : await runVcs(file, args, spawnOptions)
      ).stdout;
    } catch (error) {
      // SAFETY: execFile rejects with an ExecFileException carrying stderr.
      const failure = error as { killed?: boolean; stderr?: string };

      const reason = failure.killed
        ? `timed out after ${options.timeoutMs / 1000}s`
        : String(failure.stderr ?? "").trim() || errorMessage(error);

      throw new Error(`${file} ${String(args[0])}: ${reason}`);
    }
  },
  fetch: (input, init) => fetch(input, init),
};

/** Remotes by their configured URL, not the insteadOf rewrite: a mirror
 * still names its repo. */
export async function remoteUrls(
  gitDir: string,
  deps: PullRequestDeps,
): Promise<{ name: string; url: string }[]> {
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

    return match ? [{ name: match[1]!, url: match[2]! }] : [];
  });
}

/** Refs Review owns for one PR; the user's branches and bookmarks never move. */
function pullRequestRefs(provider: string, pr: PullRequestRecord) {
  // github.com keeps the host-less namespace existing checkouts already hold.
  const repository = `${pr.host === "github.com" ? "" : `${pr.host}/`}${pr.slug}`;
  const prefix = `refs/review/${provider}/${repository.toLowerCase()}/pull/${pr.number}`;

  return {
    head: `${prefix}/head`,
    base: `${prefix}/base`,
    frozenBase: `${prefix}/frozen-base`,
  };
}

/**
 * Fetch the PR head (refs/pull/N/head, so fork PRs work) and its base branch
 * into Review's own namespace, and return the comparison GitHub shows: the
 * head, and the merge base of the head with the base branch.
 *
 * A PR merged with a merge commit is absorbed: merge-base(base branch, head)
 * is the head itself and the diff is empty. GitHub freezes the base commit
 * (baseRefOid) at the PR's last update, so its merge base with the head is
 * the fork point GitHub diffs against, and it survives base branches that are
 * force-rebuilt or deleted.
 */
export async function fetchPullRequest(
  input: {
    rootPath: string;
    gitDir: string;
    kind: LocalVcsKind;
    remote: string;
    provider: string;
    pullRequest: PullRequestRecord;
  },
  deps: PullRequestDeps,
): Promise<{ head: string; base: string }> {
  const { pullRequest: pr } = input;
  const refs = pullRequestRefs(input.provider, pr);

  const git = (args: VcsArg[], timeoutMs = LOCAL_TIMEOUT_MS) =>
    deps
      .run("git", ["--git-dir", input.gitDir, ...args], { timeoutMs })
      .then((stdout) => stdout.trim());

  const fetchRefs = (...refspecs: VcsArg[]) =>
    git(
      [
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--quiet",
        { remote: input.remote },
        ...refspecs,
      ],
      FETCH_TIMEOUT_MS,
    );

  const commit = (ref: string) =>
    git(["rev-parse", "--verify", "--quiet", { rev: `${ref}^{commit}` }]).catch(
      () => undefined,
    );

  const mergeBase = (left: string, right: string) =>
    git(["merge-base", { rev: left }, { rev: right }]).catch(() => undefined);

  const frozenBase = async () => {
    if (!pr.baseRefOid) return undefined;

    if (!(await commit(pr.baseRefOid)))
      await fetchRefs({
        refspec: { from: pr.baseRefOid, to: refs.frozenBase, force: true },
      }).catch(() => undefined);

    return commit(pr.baseRefOid);
  };

  let baseTip: string | undefined;

  const pullHead: VcsArg = {
    refspec: { from: pr.headRef, to: refs.head, force: true },
  };

  try {
    await fetchRefs(pullHead, {
      refspec: {
        from: `refs/heads/${pr.baseRefName}`,
        to: refs.base,
        force: true,
      },
    });
    baseTip = await commit(refs.base);
  } catch (error) {
    // The base branch may be gone; the head and the frozen base suffice.
    try {
      await fetchRefs(pullHead);
    } catch {
      throw new ReviewInputError(
        `Could not fetch PR #${pr.number} from remote "${input.remote}" (${pr.slug}). Check \`git fetch ${input.remote}\` works with your Git credentials, then retry. Git said: ${firstLine(errorMessage(error))}`,
        409,
      );
    }
  }

  const head = await commit(refs.head);

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
  git: (args: VcsArg[]) => Promise<string>,
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
      await git(["update-ref", { ref: tag }, { commit: commits[index]! }]);
    await jjImport();
  } finally {
    for (const tag of tags)
      await git(["update-ref", "-d", tag]).catch(() => undefined);
    await jjImport().catch(() => undefined);
  }
}

/** GitHub refused a read, as it does past a rate limit; it takes reads
 * again at `retryAt`. */
export class GitHubRefusedRead extends ReviewInputError {
  constructor(
    message: string,
    readonly retryAt: number,
  ) {
    super(message, 409);
  }
}

export function firstLine(text: string) {
  return text.split("\n")[0]!.slice(0, 300);
}
