import { existsSync, realpathSync, rmSync } from "node:fs";
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  git,
  gitCommonDir,
  jjRevisionIsConflicted,
  resolveRevision,
} from "@dev.fast/local-vcs";
import { errorMessage, withFileLock } from "@dev.fast/trace-core";

import {
  type ReviewCheckoutRole,
  reviewManagedCheckoutDir,
  reviewManagedCheckoutRoot,
  reviewManagedCheckoutsDir,
} from "./review-checkout-paths";
import { removeReviewPrepareArtifacts } from "./review-prepare.js";

// A review renders the pinned code on the canvas, but file reads against the
// user's working tree see whatever is checked out there — including edits
// made after the pin. Materialize any pinned commit (the head, the base) as a
// detached, reusable git worktree beside the other dev-fast state in the
// shared git dir so review sessions and graph builds read immutable bytes,
// even when the working copy currently sits at the pinned commit. Returns the
// checkout path, or null when the ref cannot be resolved to a commit or the
// repo has no shared git dir.
export async function ensureReviewPinnedCheckout(input: {
  rootPath: string;
  ref: string;
  reviewUuid: string;
  role?: ReviewCheckoutRole;
}): Promise<string | null> {
  const target = await resolveReviewPinnedCheckout({
    ...input,
    role: input.role ?? "head",
  });

  if (!target) return null;

  const prepared = await withFileLock(
    `${target.checkoutPath}.prepare-lock`,
    {
      retryMs: 20,
      timeoutMs: 30_000,
      staleMs: 120_000,
      heartbeatMs: 5_000,
      unownedGraceMs: 1_000,
    },
    () =>
      materializeReviewPinnedCheckout({ rootPath: input.rootPath, ...target }),
  );

  if (!prepared.acquired)
    throw new Error(
      `Pinned checkout ${target.commit} is busy; retry the operation.`,
    );

  return target.checkoutPath;
}

async function resolveReviewPinnedCheckout(input: {
  rootPath: string;
  ref: string;
  reviewUuid: string;
  role: ReviewCheckoutRole;
}): Promise<{ checkoutPath: string; commit: string } | null> {
  const commit = await resolveReviewPinnedCommit(input.rootPath, input.ref);

  if (!commit) return null;
  const commonDir = await gitCommonDir(input.rootPath);

  if (!commonDir) return null;

  return {
    checkoutPath: reviewManagedCheckoutDir(
      commonDir,
      input.reviewUuid,
      input.role ?? "head",
      commit,
    ),
    commit,
  };
}

async function materializeReviewPinnedCheckout(input: {
  rootPath: string;
  checkoutPath: string;
  commit: string;
}): Promise<void> {
  const { checkoutPath } = input;

  if (await isWorktreeAt(input.rootPath, checkoutPath, input.commit)) {
    return;
  }

  // jj materializes conflict markers into the git export of a conflicted
  // revision, so a checkout of it would silently contain marker text instead
  // of code — and the graph would index that. Refuse with the remedy instead.
  if (await jjRevisionIsConflicted(input.rootPath, input.commit)) {
    throw new Error(
      `Whiteboard cannot pin conflicted revision ${input.commit.slice(0, 12)}: the jj change has unresolved conflicts. Resolve them (jj resolve), then re-pin the review.`,
    );
  }

  // A stale registration (e.g. a manually gutted or deleted directory) blocks
  // re-adding the same path: drop both the registration and any leftover
  // directory before recreating the worktree.
  await git(input.rootPath, ["worktree", "remove", "--force", checkoutPath], {
    allowFailure: true,
  });
  await git(input.rootPath, ["worktree", "prune"], { allowFailure: true });
  rmSync(checkoutPath, { recursive: true, force: true });
  await removeReviewPrepareArtifacts(checkoutPath);
  await mkdir(path.dirname(checkoutPath), { recursive: true });
  await git(input.rootPath, [
    "worktree",
    "add",
    "--detach",
    checkoutPath,
    input.commit,
  ]);
}

/**
 * Remove every checkout one Review owns in a repository. Registrations go
 * first, so an interrupted removal cannot leave a gutted tree that git still
 * lists and a later ensure would reuse; an unregistered leftover is replaced
 * by the next ensure. Each checkout is removed on its own, so one that cannot
 * be deleted leaves the others removed; the error names every failure.
 */
export async function removeReviewManagedCheckouts(
  commonDir: string,
  reviewUuid: string,
): Promise<void> {
  const root = reviewManagedCheckoutRoot(commonDir, reviewUuid);

  if (!isInsideDirectory(root, reviewManagedCheckoutsDir(commonDir)))
    throw new Error(`Refusing to remove non-managed checkouts at ${root}.`);

  // Resolve symlinks above the root (say /tmp) only; never the root itself.
  const roots = [
    root,
    path.join(realPath(path.dirname(root)), path.basename(root)),
  ];

  const errors: string[] = [];
  // A checkout git refused to remove (say, locked) stays registered and whole.
  const kept = new Set<string>();

  const attempt = (work: Promise<unknown>) =>
    work.then(
      () => true,
      (error) => {
        errors.push(errorMessage(error));

        return false;
      },
    );

  for (const worktree of await listRegisteredWorktrees(commonDir))
    if (
      roots.some((dir) => isInsideDirectory(worktree.worktreePath, dir)) &&
      !(await attempt(
        git(commonDir, [
          "worktree",
          "remove",
          "--force",
          worktree.worktreePath,
        ]),
      ))
    )
      kept.add(realPath(worktree.worktreePath));

  // Descend only into real directories. rm removes a symlink itself, never
  // what it points to, so nothing outside the root is touched.
  const entries = async (dir: string) =>
    (await lstat(dir).catch(() => null))?.isDirectory()
      ? await readdir(dir, { withFileTypes: true })
      : [];

  for (const entry of await entries(root)) {
    const dir = path.join(root, entry.name);

    // base/<commit> and head/<commit> are checkouts; anything else (the
    // navigator workspaces) goes whole.
    const checkouts =
      entry.isDirectory() && (entry.name === "base" || entry.name === "head")
        ? (await entries(dir)).map((child) => path.join(dir, child.name))
        : [dir];

    for (const checkout of checkouts)
      if (
        !kept.has(
          path.join(realPath(path.dirname(checkout)), path.basename(checkout)),
        )
      )
        await attempt(rm(checkout, { recursive: true, force: true }));
  }

  if (!errors.length) await rm(root, { recursive: true, force: true });
  await git(commonDir, ["worktree", "prune"], { allowFailure: true });

  if (errors.length) throw new Error(errors.join("\n"));
}

// Resolve a pinned ref to a commit. Prefer the jj-first local-vcs
// resolution (worktree-aware for HEAD/@ and branch names); fall back to git
// against the shared git dir for refs only the backing store knows, like the
// pinned refs/dev-fast/reviews/pr-N/head in a non-colocated jj workspace.
async function resolveReviewPinnedCommit(
  rootPath: string,
  ref: string,
): Promise<string | null> {
  const resolved = await resolveRevision(rootPath, ref).catch(() => null);

  if (resolved) return resolved.commit;

  const fromGitDir = await git(
    rootPath,
    ["rev-parse", "--verify", `${ref}^{commit}`],
    { allowFailure: true },
  ).catch(() => null);

  if (!fromGitDir?.ok) return null;

  return fromGitDir.stdout.trim() || null;
}

// A checkout is reusable only when git still registers a worktree at that
// path, its HEAD is the wanted commit, and the directory has not been gutted
// on disk (its .git link is the marker git itself relies on).
async function isWorktreeAt(
  rootPath: string,
  checkoutPath: string,
  commit: string,
): Promise<boolean> {
  if (!existsSync(path.join(checkoutPath, ".git"))) return false;

  const list = await git(rootPath, ["worktree", "list", "--porcelain"], {
    allowFailure: true,
  }).catch(() => null);

  if (!list?.ok) return false;

  return parseWorktreeList(list.stdout).some(
    (entry) =>
      path.resolve(entry.worktreePath) === path.resolve(checkoutPath) &&
      entry.headCommit === commit,
  );
}

function parseWorktreeList(
  output: string,
): Array<{ worktreePath: string; headCommit: string | null }> {
  const entries: Array<{ worktreePath: string; headCommit: string | null }> =
    [];

  for (const block of output.split(/\n\n+/)) {
    let worktreePath: string | null = null;
    let headCommit: string | null = null;

    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        worktreePath = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        headCommit = line.slice("HEAD ".length);
      }
    }

    if (worktreePath) entries.push({ worktreePath, headCommit });
  }

  return entries;
}

async function listRegisteredWorktrees(
  rootPath: string,
): Promise<Array<{ worktreePath: string; headCommit: string | null }>> {
  const listed = await git(rootPath, ["worktree", "list", "--porcelain"], {
    allowFailure: true,
  }).catch(() => null);

  return listed?.ok ? parseWorktreeList(listed.stdout) : [];
}

function realPath(filePath: string): string {
  return existsSync(filePath) ? realpathSync(filePath) : path.resolve(filePath);
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath);

  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}
