import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { type VcsArg, gitAt } from "@dev.fast/local-vcs";
import { normalizeGitHubRemote } from "@dev.fast/review-share-protocol";
import { type Pins, ReviewInputError } from "@review/review-api/document.js";

/** A full commit id, SHA-1 or SHA-256. */
export const COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/** Refuses anything but full commit ids, before any of them reaches git:
 * a shared board's commits come from someone else, and one spelled as an
 * option or a refspec would make git do something else. */
export function assertCommitIds(commits: readonly string[]) {
  if (!commits.every((commit) => COMMIT_ID.test(commit)))
    throw new ReviewInputError(
      "The shared whiteboard names a commit that isn't a full commit id.",
    );
}

/** Keep credential helpers but prevent the calling shell from redirecting Git's object store. */
export function sharedGit(cwd: string, args: VcsArg[]) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("GIT_") ||
        [
          "GIT_SSH",
          "GIT_SSH_COMMAND",
          "GIT_ASKPASS",
          "GIT_SSH_VARIANT",
        ].includes(key),
    ),
  );

  return gitAt(
    cwd,
    ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
    {
      env,
      timeout: 300_000,
    },
  );
}

function fetchError(stderr: string, publishing: boolean): ReviewInputError {
  if (/not our ref|couldn't find remote ref|unadvertised object/i.test(stderr))
    return new ReviewInputError(
      publishing
        ? "Push the reviewed commits to GitHub before sharing."
        : "The shared commits are no longer available on GitHub. Ask the sender to restore them, then retry.",
      409,
    );

  return new ReviewInputError(
    "Could not fetch the GitHub repository. Check your connection and Git credentials for this repository, then retry.",
    409,
  );
}

/** Recipients need complete history; publication only checks that the commits exist.
 * `commits` are other commits the board's references read at; a plan has
 * only those. */
export async function fetchPinnedRepository(
  root: string,
  url: string,
  pins: Pick<Pins, "base" | "head"> | undefined,
  publishing = false,
  commits: readonly string[] = [],
) {
  // Each commit and the ref it is fetched to.
  const named = [
    ...(pins
      ? [
          { commit: pins.base, ref: "base" },
          { commit: pins.head, ref: "head" },
        ]
      : []),
    ...commits.map((commit) => ({ commit, ref: `commits/${commit}` })),
  ];

  if (!named.every(({ commit }) => COMMIT_ID.test(commit)))
    throw new ReviewInputError(
      "Sharing requires immutable base and head commits.",
    );
  await mkdir(root, { recursive: true, mode: 0o700 });
  await sharedGit(root, ["init", "--quiet"]);

  if (!publishing) {
    await sharedGit(root, ["config", "core.hooksPath", "/dev/null"]);
    await sharedGit(root, ["config", "core.fsmonitor", "false"]);
    await sharedGit(root, ["remote", "add", "origin", { remote: url }]);
  }

  // Branch refs make Git reject non-commit objects during the fetch itself.
  const refs = publishing ? "refs/heads/review" : "refs/review";

  try {
    await sharedGit(root, [
      "fetch",
      "--no-tags",
      "--force",
      ...(publishing ? ["--depth=1", "--filter=tree:0"] : []),
      { remote: publishing ? url : "origin" },
      ...named.map(({ commit, ref }) => ({
        refspec: { from: commit, to: `${refs}/${ref}` },
      })),
    ]);
  } catch (error) {
    throw fetchError(
      error instanceof Error && "stderr" in error ? String(error.stderr) : "",
      publishing,
    );
  }

  if (!publishing)
    for (const { commit } of named)
      await sharedGit(root, ["cat-file", "-e", { rev: `${commit}^{commit}` }]);
}

/** Fetches the commits a shared board's links read at into a checkout of
 * its repository, from its origin unless it has them, and keeps each under
 * `refs/review/shared/<share>/<commit>`, so `git gc` can't prune one the
 * board still quotes. */
export async function fetchSharedCommits(
  root: string,
  commits: readonly string[],
  share: string,
) {
  assertCommitIds(commits);

  const ref = (commit: string) => `refs/review/shared/${share}/${commit}`;
  const missing: string[] = [];

  for (const commit of commits)
    try {
      await sharedGit(root, ["cat-file", "-e", { rev: `${commit}^{commit}` }]);
      await sharedGit(root, ["update-ref", { ref: ref(commit) }, { commit }]);
    } catch {
      missing.push(commit);
    }

  if (!missing.length) return;

  try {
    await sharedGit(root, [
      "fetch",
      "--no-tags",
      "origin",
      ...missing.map((commit) => ({
        refspec: { from: commit, to: ref(commit), force: true },
      })),
    ]);
  } catch (error) {
    throw fetchError(
      error instanceof Error && "stderr" in error ? String(error.stderr) : "",
      false,
    );
  }
}

/** Drops the refs `fetchSharedCommits` kept for a share, once the share is
 * gone, so `git gc` can prune what only it quoted. */
export async function forgetSharedCommits(root: string, share: string) {
  const { stdout } = await sharedGit(root, [
    "for-each-ref",
    "--format=%(refname)",
    { ref: `refs/review/shared/${share}/` },
  ]);

  for (const ref of stdout.split("\n").filter(Boolean))
    await sharedGit(root, ["update-ref", "-d", { ref }]);
}

/** A managed clone of a repository's default branch, for a shared board
 * with no pins whose repository the receiver has no checkout of. */
export async function cloneSharedRepository(root: string, url: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await sharedGit(root, ["init", "--quiet"]);
  await sharedGit(root, ["config", "core.hooksPath", "/dev/null"]);
  await sharedGit(root, ["config", "core.fsmonitor", "false"]);
  await sharedGit(root, ["remote", "add", "origin", { remote: url }]);

  try {
    await sharedGit(root, ["fetch", "--no-tags", "origin", "HEAD"]);
  } catch (error) {
    throw fetchError(
      error instanceof Error && "stderr" in error ? String(error.stderr) : "",
      false,
    );
  }

  await sharedGit(root, ["checkout", "--detach", "FETCH_HEAD"]);
}

export async function repositoryReady(
  root: string,
  pins: Pick<Pins, "base" | "head">,
  commits: readonly string[] = [],
): Promise<boolean> {
  if (
    ![pins.base, pins.head, ...commits].every((commit) =>
      COMMIT_ID.test(commit),
    )
  )
    return false;

  try {
    const head = await sharedGit(root, ["rev-parse", "HEAD"]);

    if (head.stdout.trim() !== pins.head) return false;

    for (const commit of [pins.base, pins.head, ...commits])
      await sharedGit(root, ["cat-file", "-e", { rev: `${commit}^{commit}` }]);

    return true;
  } catch {
    return false;
  }
}

export async function readShareRepository(root: string) {
  let cloneUrl: string;

  try {
    cloneUrl = normalizeGitHubRemote(
      (await sharedGit(root, ["remote", "get-url", "origin"])).stdout,
    );
  } catch {
    throw new ReviewInputError("Sharing requires a GitHub origin remote.");
  }

  return { cloneUrl };
}

export async function verifyShareRepository(
  root: string,
  pins: Pins | undefined,
  repository?: { cloneUrl: string },
  commits: readonly string[] = [],
) {
  const { cloneUrl } = repository ?? (await readShareRepository(root));
  const temporary = await mkdtemp(path.join(tmpdir(), "review-share-check-"));

  try {
    await fetchPinnedRepository(temporary, cloneUrl, pins, true, commits);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  return { cloneUrl };
}
