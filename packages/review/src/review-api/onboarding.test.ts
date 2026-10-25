import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type OnboardingRun,
  onboardingProjects,
  onboardingTargets,
  parseWorktrees,
} from "./onboarding";

/** Answers each command from a table keyed by the command line. */
function runner(answers: Record<string, string | Error>): OnboardingRun {
  return async (file, args) => {
    const answer = answers[[file, ...args].join(" ")];

    if (answer === undefined || answer instanceof Error)
      throw answer ?? new Error(`unexpected: ${file} ${args.join(" ")}`);

    return answer;
  };
}

const WORKTREES = [
  "worktree /repo",
  "HEAD 1111",
  "branch refs/heads/fix/webhook-retries",
  "",
  "worktree /code/payments-sso",
  "HEAD 2222",
  "branch refs/heads/feat/sso-login",
  "",
  "worktree /repo/.git/dev-fast/reviews/abc/head",
  "HEAD 3333",
  "detached",
  "",
  "worktree /code/payments-old",
  "HEAD 4444",
  "detached",
  "",
].join("\n");

const PRS = JSON.stringify([
  {
    number: 418,
    title: "Move ledger writes behind an outbox",
    url: "https://github.com/acme/payments/pull/418",
    author: { login: "priya" },
    headRefName: "ledger-outbox",
    additions: 904,
    deletions: 311,
    updatedAt: "2026-10-14T09:00:00Z",
  },
]);

const GH_PR_LIST =
  "gh pr list --limit 10 --search sort:updated-desc --json number,title,url,author,headRefName,additions,deletions,updatedAt";

const BRANCH_TIMES_COMMAND =
  "git for-each-ref --format=%(refname:short)%09%(committerdate:unix) refs/heads";

// Each branch's last commit: the checkout's is older than the worktree's.
const BRANCH_TIMES = [
  "fix/webhook-retries\t1760000000",
  "feat/sso-login\t1790000000",
].join("\n");

describe("parseWorktrees", () => {
  it("reads each worktree's path and branch", () => {
    expect(parseWorktrees(WORKTREES).slice(0, 2)).toEqual([
      { path: "/repo", branch: "fix/webhook-retries" },
      { path: "/code/payments-sso", branch: "feat/sso-login" },
    ]);
  });
});

describe("onboardingTargets", () => {
  it("offers the checkout's branch, other branch worktrees, and open PRs, most recent first", async () => {
    const result = await onboardingTargets(
      "/repo/src",
      runner({
        "git rev-parse --show-toplevel": "/repo\n",
        "git branch --show-current": "fix/webhook-retries\n",
        "git worktree list --porcelain": WORKTREES,
        "git symbolic-ref --short refs/remotes/origin/HEAD": "origin/trunk\n",
        [BRANCH_TIMES_COMMAND]: BRANCH_TIMES,
        [GH_PR_LIST]: PRS,
      }),
    );

    expect(result).toEqual({
      project: { path: "/repo", name: "repo" },
      base: "trunk",
      targets: [
        {
          kind: "pr",
          number: 418,
          title: "Move ledger writes behind an outbox",
          url: "https://github.com/acme/payments/pull/418",
          author: "priya",
          branch: "ledger-outbox",
          additions: 904,
          deletions: 311,
        },
        {
          kind: "worktree",
          path: "/code/payments-sso",
          branch: "feat/sso-login",
        },
        { kind: "branch", path: "/repo", branch: "fix/webhook-retries" },
      ],
    });
  });

  it("still offers branches without gh, and falls back to main", async () => {
    const result = await onboardingTargets(
      "/repo",
      runner({
        "git rev-parse --show-toplevel": "/repo\n",
        "git branch --show-current": "main\n",
        "git worktree list --porcelain":
          "worktree /repo\nbranch refs/heads/main\n",
        "git symbolic-ref --short refs/remotes/origin/HEAD": new Error(
          "no remote",
        ),
        [GH_PR_LIST]: new Error("gh: command not found"),
      }),
    );

    expect(result.base).toBe("main");
    expect(result.targets).toEqual([
      { kind: "branch", path: "/repo", branch: "main" },
    ]);
  });

  it("refuses a folder outside a repository", async () => {
    await expect(onboardingTargets("/tmp/notes", runner({}))).rejects.toThrow(
      "Choose a folder inside a Git repository.",
    );
  });
});

describe("onboardingProjects", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(path.join(tmpdir(), "onboarding-projects-")),
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /** A repository with one commit, last active `daysAgo` days ago. */
  async function repository(name: string, daysAgo: number) {
    const root = path.join(directory, name);

    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" });

    await mkdir(path.join(root, "src"), { recursive: true });
    git("init", "-q", "-b", "main");
    git(
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Start",
    );

    return {
      root,
      git,
      async touch() {
        const when = new Date(Date.now() - daysAgo * 86_400_000);

        for (const file of ["index", "logs/HEAD"])
          await utimes(path.join(root, ".git", file), when, when).catch(
            () => {},
          );
      },
    };
  }

  it("resolves folders to their repositories, most recently active first", async () => {
    const web = await repository("web", 5);
    const api = await repository("api", 1);
    const worktree = path.join(directory, "web-feature");

    web.git("worktree", "add", "-q", "-b", "feature", worktree);
    await api.touch();
    await web.touch();
    await mkdir(path.join(directory, "notes"));

    const projects = await onboardingProjects(
      [
        worktree,
        path.join(api.root, "src"),
        api.root,
        path.join(directory, "notes"),
        path.join(directory, "gone"),
      ],
      { temporaryRoots: [] },
    );

    expect(projects).toEqual([
      { path: api.root, name: "api" },
      { path: web.root, name: "web" },
    ]);
  });

  it("leaves out repositories in temporary folders", async () => {
    const scratch = await repository("scratch", 0);

    expect(
      await onboardingProjects([scratch.root], {
        temporaryRoots: [directory],
      }),
    ).toEqual([]);
  });
});
