import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  type VcsArg,
  gitCommonDirSync,
  parseGitRemote,
  runVcs,
  runVcsSync,
} from "@dev.fast/local-vcs";

/** Worktrees and same-origin clones share a group. */
export interface RepositoryGroup {
  key: string;
  label: string;
}

/** A command's output, or undefined if it fails; the runner's rules (no
 * lazy fetch, no prompt, a timeout) apply. */
function quietly(
  tool: "git" | "jj",
  args: VcsArg[],
  options: { cwd?: string; input?: string } = {},
): string | undefined {
  try {
    return runVcsSync(tool, args, {
      cwd: options.cwd,
      input: options.input,
      encoding: "utf8",
      stdio: [
        options.input === undefined ? "ignore" : "pipe",
        "pipe",
        "ignore",
      ],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return undefined;
  }
}

/** A path with its parent's symlinks resolved, for a path that may be gone. */
export function canonicalPath(file: string) {
  try {
    return path.join(realpathSync(path.dirname(file)), path.basename(file));
  } catch {
    return path.resolve(file);
  }
}

/** The git directory a checkout's worktrees share, read from its `.git`
 * without running git; undefined when that can't be read so. */
function commonDirOf(root: string): string | undefined {
  const dotGit = path.join(root, ".git");

  try {
    // Real paths, as git gives them, so checkouts of one repository match.
    if (statSync(dotGit).isDirectory()) return realpathSync(dotGit);
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1];

    if (!gitdir) return undefined;
    const own = path.resolve(root, gitdir.trim());

    try {
      return realpathSync(
        path.resolve(
          own,
          readFileSync(path.join(own, "commondir"), "utf8").trim(),
        ),
      );
    } catch {
      return realpathSync(own);
    }
  } catch {
    return undefined;
  }
}

/** The origin remote's URL from a git config file; undefined when the file
 * can't settle it (a URL rewrite, an include), so git must be asked. */
function originUrlOf(commonDir: string): string | null | undefined {
  let config: string;

  try {
    config = readFileSync(path.join(commonDir, "config"), "utf8");
  } catch {
    return undefined;
  }

  if (/insteadof|^\s*\[include/im.test(config)) return undefined;
  const section = /^\s*\[remote\s+"origin"\]([^[]*)/im.exec(config)?.[1];

  return section
    ? (/^\s*url\s*=\s*(.+)$/im.exec(section)?.[1]?.trim() ?? null)
    : null;
}

/** Clones of one repository share its origin's host and path, on any forge
 * and over any protocol; a checkout with no usable origin is its own. */
function groupOf(commonDir: string, origin: string | null): RepositoryGroup {
  const remote = origin ? parseGitRemote(origin) : null;

  return remote
    ? {
        key: `remote:${remote.host}/${remote.slug.toLowerCase()}`,
        label: remote.slug,
      }
    : {
        key: `git:${commonDir}`,
        label: path.basename(path.dirname(commonDir)),
      };
}

/** A checkout's repository group; undefined if it isn't a readable git
 * checkout. Reads `.git` and its config directly where it can, so many
 * checkouts group in a moment; git answers the rest. */
export function repositoryGroupAt(root: string): RepositoryGroup | undefined {
  // Resolving a missing checkout would spawn on every listing.
  if (!existsSync(root)) return undefined;

  const commonDir = commonDirOf(root);
  const origin = commonDir ? originUrlOf(commonDir) : undefined;

  if (commonDir && origin !== undefined) return groupOf(commonDir, origin);

  const resolved = gitCommonDirSync(root);

  if (!resolved) return undefined;

  const url = quietly("git", [
    "--git-dir",
    resolved,
    "remote",
    "get-url",
    "origin",
  ]);

  return groupOf(resolved, url?.trim() || null);
}

/** What grouping asks of one checkout on disk: one call each. */
export interface CheckoutProbe {
  /** Its repository group, or undefined for a folder that isn't one. */
  groupAt(root: string): RepositoryGroup | undefined;
  /** Its repository's shared git directory and the worktree folders that
   * directory lists, deleted ones included until they are pruned. */
  worktreesOf(
    root: string,
  ): { commonDir: string; worktrees: string[] } | undefined;
  /** Which of these commits the repository at `commonDir` has. */
  commitsIn(commonDir: string, commits: string[]): Set<string>;
  /** The same, without blocking, so several repositories answer at once;
   * a probe without it answers one at a time. */
  findCommits?(commonDir: string, commits: string[]): Promise<Set<string>>;
}

/** The probe that reads `.git` directly, running git only where it must. */
export const gitCheckoutProbe: CheckoutProbe = {
  groupAt: repositoryGroupAt,
  worktreesOf(root) {
    const commonDir = commonDirOf(root) ?? gitCommonDirSync(root) ?? undefined;

    if (!commonDir) return undefined;

    let entries: string[] = [];

    try {
      entries = readdirSync(path.join(commonDir, "worktrees"));
    } catch {
      // No worktrees.
    }

    const worktrees = entries.flatMap((entry) => {
      try {
        const gitdir = readFileSync(
          path.join(commonDir, "worktrees", entry, "gitdir"),
          "utf8",
        ).trim();

        return [path.dirname(gitdir)];
      } catch {
        return [];
      }
    });

    return { commonDir, worktrees };
  },
  commitsIn: (commonDir, commits) =>
    commitsListed(
      quietly("git", ["--git-dir", commonDir, "cat-file", "--batch-check"], {
        input: commits.join("\n") + "\n",
      }),
    ),
  findCommits: async (commonDir, commits) =>
    commitsListed(
      await runVcs(
        "git",
        ["--git-dir", commonDir, "cat-file", "--batch-check"],
        { input: commits.join("\n") + "\n", maxBuffer: 64 * 1024 * 1024 },
      ).then(
        ({ stdout }) => stdout,
        () => undefined,
      ),
    ),
};

/** How many repositories are asked about commits at once. */
const PARALLEL_GIT = 8;

/** The commits each repository was asked about, by its git directory. */
type CommitQuestions = Map<string, string[]>;

/** Which of them each has. */
type CommitAnswers = Map<string, Set<string>>;

/**
 * How a store's checkouts group into projects, worked out in one pass and
 * kept for the life of the process. `prepare` asks each checkout still on
 * disk for its group and its worktrees, once each, before an upgrade takes
 * the write lock; projects are then assigned from the maps it builds,
 * without touching git. A deleted checkout joins the checkout that lists it
 * as a worktree, else one whose repository has the commits its boards
 * pinned (a pruned worktree's history lives on in its repository),
 * preferring the one whose folder held it; unmatched, it gets its own
 * project.
 */
export class CheckoutGroups {
  private readonly groups = new Map<string, RepositoryGroup | undefined>();
  private owners: ReadonlyMap<string, string> | undefined;

  constructor(
    private readonly db: DatabaseSync,
    private readonly probe: CheckoutProbe = gitCheckoutProbe,
    /** The grouping another connection's `prepare` already worked out. */
    prepared?: ReadonlyMap<string, string>,
  ) {
    this.owners = prepared;
  }

  /** A checkout's group, asked once per path. */
  group(root: string): RepositoryGroup | undefined {
    if (!this.groups.has(root)) {
      let group: RepositoryGroup | undefined;

      // A missing folder has no group, and git needn't be asked.
      if (existsSync(root))
        try {
          group = this.probe.groupAt(root);
        } catch {
          group = undefined;
        }

      this.groups.set(root, group);
    }

    return this.groups.get(root);
  }

  /** A file as a commit has it, or undefined if this repository can't say
   * without fetching. */
  fileAt(root: string, commit: string, file: string) {
    return quietly("git", ["-C", root, "show", { rev: `${commit}:${file}` }]);
  }

  /** Works everything out now, ahead of a migration that needs it. */
  prepare() {
    if (this.owners) return;

    const finding = this.findOwners();
    let step = finding.next();

    while (!step.done)
      step = finding.next(
        new Map(
          [...step.value].map(([commonDir, commits]) => [
            commonDir,
            this.commitsIn(commonDir, commits),
          ]),
        ),
      );

    this.owners = step.value;
  }

  /** As `prepare`, asking several repositories at once: before a store
   * opens, while nothing waits on its write lock yet. */
  async prepareConcurrently(): Promise<void> {
    if (this.owners) return;

    const finding = this.findOwners();
    let step = finding.next();

    while (!step.done) {
      const questions = [...step.value];
      const answers: CommitAnswers = new Map();

      const ask = async () => {
        for (let next = questions.shift(); next; next = questions.shift()) {
          const [commonDir, commits] = next;

          answers.set(commonDir, await this.findCommits(commonDir, commits));
        }
      };

      await Promise.all(Array.from({ length: PARALLEL_GIT }, ask));
      step = finding.next(answers);
    }

    this.owners = step.value;
  }

  /** The grouping `prepare` worked out, to hand to another connection's. */
  get prepared(): ReadonlyMap<string, string> | undefined {
    return this.owners;
  }

  ownerOf(repositoryId: string): string | undefined {
    this.prepare();

    return this.owners!.get(repositoryId);
  }

  private repositories() {
    return this.db.prepare("SELECT id, path FROM repositories").all();
  }

  private commitsIn(commonDir: string, commits: string[]) {
    try {
      return this.probe.commitsIn(commonDir, commits);
    } catch {
      return new Set<string>();
    }
  }

  private async findCommits(commonDir: string, commits: string[]) {
    try {
      return await (this.probe.findCommits?.(commonDir, commits) ??
        this.probe.commitsIn(commonDir, commits));
    } catch {
      return new Set<string>();
    }
  }

  /** Works out each deleted checkout's owner, yielding the questions for
   * git it needs answered: once about the commits boards pin now, and
   * again about older ones only for a checkout those leave unsettled. */
  private *findOwners(): Generator<
    CommitQuestions,
    Map<string, string>,
    CommitAnswers
  > {
    const owners = new Map<string, string>();
    const existing: { id: string; root: string }[] = [];
    const deleted: { id: string; root: string }[] = [];

    for (const { id, path: root } of this.repositories())
      (existsSync(String(root)) ? existing : deleted).push({
        id: String(id),
        root: String(root),
      });

    // Each checkout on disk, asked once for its group and once for its
    // worktrees.
    const listed = new Map<string, string>();
    const repositories = new Map<string, string>();
    const repositoryOf = new Map<string, string>();

    for (const checkout of existing) {
      this.group(checkout.root);

      if (!deleted.length) continue;

      let found: ReturnType<CheckoutProbe["worktreesOf"]>;

      try {
        found = this.probe.worktreesOf(checkout.root);
      } catch {
        found = undefined;
      }

      if (!found) continue;
      repositoryOf.set(checkout.id, found.commonDir);

      if (repositories.has(found.commonDir)) continue;
      repositories.set(found.commonDir, checkout.id);

      for (const worktree of found.worktrees)
        listed.set(canonicalPath(worktree), checkout.id);
    }

    for (const gone of deleted) {
      const owner = listed.get(canonicalPath(gone.root));

      if (owner) owners.set(gone.id, owner);
    }

    const folders = existing.map((checkout) => ({
      id: checkout.id,
      folder: canonicalPath(checkout.root) + path.sep,
    }));

    // Of the repositories that have its commits, the one whose folder held
    // it; a folder of another repository says nothing. Else the first.
    const containers = (gone: { root: string }) => {
      const at = canonicalPath(gone.root);

      return folders.flatMap(({ id, folder }) =>
        at.startsWith(folder) && repositoryOf.has(id)
          ? [{ id, commonDir: repositoryOf.get(id)! }]
          : [],
      );
    };

    const unmatched = deleted.filter(({ id }) => !owners.has(id));

    // The rest by the commits their boards pinned, asked once of each
    // repository: the boards' current versions first. A checkout one of
    // them doesn't pin needs the history from the start.
    const now = this.pinnedCommits(
      new Set(unmatched.map(({ id }) => id)),
      "current",
    );

    const historyFirst = unmatched.some(({ id }) => !now.has(id));

    const pinned = historyFirst
      ? this.pinnedCommits(new Set(unmatched.map(({ id }) => id)), "all")
      : now;

    const having = new Map<string, string[]>();

    if (pinned.size) {
      const answers = yield questionsFor(repositories, pinned);

      for (const [gone, theirs] of pinned)
        having.set(gone, repositoriesWith(repositories, answers, theirs));
    }

    // A checkout is settled by its current commits only if the repository
    // its owner would come from has them; another repository might have
    // only older ones, and rank before it.
    const unsettled = historyFirst
      ? []
      : unmatched.filter(({ id, root }) => {
          const first =
            containers({ root })[0]?.commonDir ??
            repositories.keys().next().value;

          return !having.get(id)?.includes(first ?? "");
        });

    if (unsettled.length) {
      const older = new Map(
        [
          ...this.pinnedCommits(new Set(unsettled.map(({ id }) => id)), "all"),
        ].map(([gone, commits]) => [
          gone,
          commits.filter((commit) => !now.get(gone)?.includes(commit)),
        ]),
      );

      const answers = yield questionsFor(repositories, older);

      for (const [gone, theirs] of older) {
        const more = repositoriesWith(repositories, answers, theirs);
        const known = having.get(gone) ?? [];

        // In the repositories' order, as one question would have found them.
        having.set(
          gone,
          [...repositories.keys()].filter(
            (commonDir) =>
              known.includes(commonDir) || more.includes(commonDir),
          ),
        );
      }
    }

    for (const gone of unmatched) {
      const withCommits = having.get(gone.id);

      if (!withCommits?.length) continue;

      const container = containers(gone).find(({ commonDir }) =>
        withCommits.includes(commonDir),
      );

      owners.set(gone.id, container?.id ?? repositories.get(withCommits[0]!)!);
    }

    return owners;
  }

  /** The commits each of these checkouts' boards pin: in their current
   * versions, or in every version. */
  private pinnedCommits(
    checkouts: ReadonlySet<string>,
    versions: "current" | "all",
  ) {
    const pinned = new Map<string, string[]>();

    if (!checkouts.size) return pinned;

    for (const row of this.db
      .prepare(
        `SELECT json_extract(snapshot,'$.pins.repositoryId') AS repository,
          json_extract(snapshot,'$.pins.head') AS head,
          json_extract(snapshot,'$.pins.base') AS base
        FROM ${versions === "current" ? "reviews CROSS JOIN versions ON versions.review_id=reviews.id AND versions.version=reviews.version" : "versions"}
        WHERE json_valid(snapshot) AND json_type(snapshot,'$.pins')='object'`,
      )
      .all()) {
      const repository = String(row.repository);

      if (!checkouts.has(repository)) continue;
      const commits = pinned.get(repository) ?? [];

      for (const commit of [String(row.head), String(row.base)])
        if (
          /^[0-9a-f]{40}$/.test(commit) &&
          !/^0+$/.test(commit) &&
          !commits.includes(commit)
        )
          commits.push(commit);

      if (commits.length) pinned.set(repository, commits);
    }

    return pinned;
  }
}

/** Every repository asked about every commit pinned. */
function questionsFor(
  repositories: ReadonlyMap<string, string>,
  pinned: ReadonlyMap<string, string[]>,
): CommitQuestions {
  const commits = [...new Set([...pinned.values()].flat())];

  return new Map(
    commits.length
      ? [...repositories.keys()].map((commonDir) => [commonDir, commits])
      : [],
  );
}

/** The repositories, in order, that have any of these commits. */
function repositoriesWith(
  repositories: ReadonlyMap<string, string>,
  answers: CommitAnswers,
  commits: string[],
) {
  return [...repositories.keys()].filter((commonDir) =>
    commits.some((commit) => answers.get(commonDir)?.has(commit)),
  );
}

/** The commits `git cat-file --batch-check` found. */
function commitsListed(output: string | undefined) {
  return new Set(
    (output ?? "")
      .split("\n")
      .filter((line) => / commit /.test(line))
      .map((line) => line.split(" ")[0]!),
  );
}
