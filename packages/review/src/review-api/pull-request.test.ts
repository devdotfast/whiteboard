import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveReviewStackLayers } from "@review/review-stack.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { azureDevOpsProvider } from "./azure-devops-provider.js";
import { ReviewInputError } from "./document.js";
import { createReviewApi } from "./http.js";
import { openLocalReviewStore } from "./local-data.js";
import { resolvePullRequest } from "./provider.js";
import {
  type PullRequestDeps,
  type PullRequestRecord,
  defaultPullRequestDeps,
} from "./pull-request.js";

const url = "https://github.com/acme/widget/pull/7";

const hasJj = spawnSync("jj", ["--version"]).status === 0;

const command = <Operation>(operation: Operation) => ({
  operation,
});

describe("reading a pull request", () => {
  const readPullRequest = (prUrl: string, deps: PullRequestDeps) => {
    const { provider, address } = resolvePullRequest(prUrl);

    return provider.readPullRequest(address, deps);
  };

  const record = {
    number: 7,
    title: "Add widgets",
    baseRefName: "main",
    baseRefOid: "a".repeat(40),
    headBranch: "widgets",
  };

  const { headBranch, ...ghRecord } = record;

  const ghJson = JSON.stringify({
    ...ghRecord,
    headRefName: headBranch,
    isCrossRepository: false,
  });

  const deps = (
    gh: () => Promise<string>,
    api?: () => Promise<Response>,
  ): PullRequestDeps & { calls: unknown[][] } => {
    const calls: unknown[][] = [];

    return {
      calls,
      run: async (file, args) => {
        calls.push([file, ...args]);

        return gh();
      },
      fetch: vi.fn<typeof fetch>(async (input) => {
        calls.push(["fetch", String(input)]);

        if (!api) throw new Error("unexpected API call");

        return api();
      }),
    };
  };

  const ghFails = () => Promise.reject(new Error("gh pr: not logged in"));

  it("falls back to the public API when gh fails", async () => {
    const using = deps(ghFails, async () =>
      Response.json({
        number: 7,
        title: "Add widgets",
        base: { ref: "main", sha: record.baseRefOid, repo: { id: 1 } },
        head: { ref: "widgets", repo: { id: 1 } },
      }),
    );

    await expect(readPullRequest(url, using)).resolves.toEqual({
      host: "github.com",
      slug: "acme/widget",
      headRef: "refs/pull/7/head",
      ...record,
    });
    expect(using.calls.at(-1)).toEqual([
      "fetch",
      "https://api.github.com/repos/acme/widget/pulls/7",
    ]);
  });

  it("reads the PR's state from gh, or from the public API", async () => {
    const state = async (
      gh: { state?: string; isDraft?: boolean },
      api?: { state: string; draft?: boolean; merged_at?: string | null },
    ) =>
      (
        await readPullRequest(
          url,
          api
            ? deps(ghFails, async () =>
                Response.json({
                  number: 7,
                  title: "Add widgets",
                  base: {
                    ref: "main",
                    sha: record.baseRefOid,
                    repo: { id: 1 },
                  },
                  head: { ref: "widgets", repo: { id: 1 } },
                  ...api,
                }),
              )
            : deps(async () =>
                JSON.stringify({ ...JSON.parse(ghJson), ...gh }),
              ),
        )
      ).state;

    expect(await state({ state: "OPEN", isDraft: true })).toBe("draft");
    expect(await state({}, { state: "open", draft: true })).toBe("draft");
    expect(
      await state({}, { state: "closed", merged_at: "2026-10-01T00:00:00Z" }),
    ).toBe("merged");
    expect(await state({}, { state: "closed", merged_at: null })).toBe(
      "closed",
    );
  });

  it("reads a GitHub Enterprise PR through gh on its host, never the public API", async () => {
    const enterprise = "https://ghe.example.com/acme/widget/pull/7";
    const using = deps(async () => ghJson);

    await expect(readPullRequest(enterprise, using)).resolves.toEqual({
      host: "ghe.example.com",
      slug: "acme/widget",
      headRef: "refs/pull/7/head",
      ...record,
    });
    expect(using.calls[0]).toContainEqual({
      value: "ghe.example.com/acme/widget",
    });

    const failing = deps(ghFails);

    const error = await readPullRequest(enterprise, failing).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(ReviewInputError);
    expect(failing.calls.map(([file]) => file)).toEqual(["gh"]);
  });

  it("says a missing or private PR was not found", async () => {
    const error = await readPullRequest(
      url,
      deps(ghFails, async () => new Response("{}", { status: 404 })),
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ReviewInputError);
    expect(error).toMatchObject({ status: 404 });
  });

  for (const status of [403, 429]) {
    it(`refuses a PR the GitHub API rate-limits with HTTP ${status}`, async () => {
      const error = await readPullRequest(
        url,
        deps(
          ghFails,
          async () =>
            new Response("{}", {
              status,
              headers: { "x-ratelimit-remaining": "0" },
            }),
        ),
      ).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(ReviewInputError);
      expect(error).toMatchObject({ status: 409 });
    });
  }
});

describe("creating a review from a pull request URL alone", () => {
  let directory: string, upstream: string, checkout: string;
  let local: ReturnType<typeof openLocalReviewStore>;

  /** What gh reports; the tests move the base as GitHub would. */
  let pr: Omit<
    PullRequestRecord,
    "host" | "slug" | "headRef" | "headBranch"
  > & {
    headRefName: string;
    isCrossRepository: boolean;
  };

  let ghCalls: number;
  let openPullRequests: object[];

  // The open PR #7 GitHub lists for the widgets branch.
  const widgetsPullRequest = (title: string, baseBranch = "main") => ({
    number: 7,
    title,
    head: { ref: "widgets", repo: { full_name: "acme/widget" } },
    base: { ref: baseBranch, repo: { full_name: "acme/widget" } },
  });

  const gitIn =
    (cwd: string) =>
    (...args: string[]) =>
      execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
        cwd,
        encoding: "utf8",
      }).trim();

  const commit = (cwd: string, file: string, text: string) => {
    writeFileSync(path.join(cwd, file), text);
    gitIn(cwd)("add", ".");
    gitIn(cwd)("commit", "-qm", `Write ${file}`);

    return gitIn(cwd)("rev-parse", "HEAD");
  };

  /** A local repository stands in for acme/widget on the host. */
  const pointAtUpstream = (
    gitDir: string,
    remote = "https://github.com/acme/widget.git",
  ) => {
    const config = (...args: string[]) =>
      execFileSync("git", ["--git-dir", gitDir, "config", ...args]);

    config("remote.origin.url", remote);
    config(`url.${upstream}.insteadOf`, remote);
  };

  let fork: string, trunk: string;

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "review-pr-create-"));
    upstream = path.join(directory, "upstream");
    mkdirSync(upstream);
    const up = gitIn(upstream);
    up("init", "-q", "-b", "main");
    up("config", "user.name", "Review Test");
    up("config", "user.email", "review-test@example.invalid");
    fork = commit(upstream, "base.ts", "export const base = 1;\n");
    // The PR comes from a fork: GitHub exposes it only as refs/pull/7/head.
    up("checkout", "-q", "-b", "contributor");
    commit(upstream, "feature.ts", "export const feature = 1;\n");
    up("update-ref", "refs/pull/7/head", "HEAD");
    up("checkout", "-q", "main");
    up("branch", "-qD", "contributor");
    trunk = commit(upstream, "base.ts", "export const base = 2;\n");

    checkout = path.join(directory, "checkout");
    gitIn(directory)("clone", "-q", upstream, checkout);
    pointAtUpstream(path.join(checkout, ".git"));

    pr = {
      number: 7,
      title: "Add widgets",
      baseRefName: "main",
      headRefName: "contributor",
      isCrossRepository: true,
    };
    ghCalls = 0;
    openPullRequests = [];
    local = openLocalReviewStore(path.join(directory, "reviews.db"), {
      manageWorkspaces: false,
      pullRequests: {
        ...defaultPullRequestDeps,
        run: async (file, args, options) => {
          if (file === "az")
            return JSON.stringify({
              title: pr.title,
              sourceRefName: "refs/heads/feature",
              targetRefName: `refs/heads/${pr.baseRefName}`,
              repository: { name: "widget", project: { name: "project" } },
            });

          if (file !== "gh")
            return defaultPullRequestDeps.run(file, args, options);
          ghCalls++;

          if (args[0] === "api") return JSON.stringify(openPullRequests);

          return JSON.stringify(pr);
        },
        fetch: () => Promise.reject(new Error("no network in tests")),
      },
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await local.store.close();
    await local.data.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const createFromUrl = async (
    fields: {
      title?: string;
      target?: { kind: "commits"; repositoryId: string; head: string };
    } = {},
    into = checkout,
  ) =>
    local.store.execute(
      command({
        type: "create",
        pullRequestUrl: url,
        ...(fields.target
          ? fields
          : { ...fields, repositoryId: (await local.data.register(into)).id }),
      }),
    );

  const upstreamHead = () => gitIn(upstream)("rev-parse", "refs/pull/7/head");

  const userRefs = (gitDir: string) =>
    execFileSync(
      "git",
      [
        "--git-dir",
        gitDir,
        "for-each-ref",
        "refs/heads",
        "refs/remotes",
        "refs/tags",
      ],
      { encoding: "utf8" },
    );

  it("fetches a fork PR and pins GitHub's comparison, titled from the PR", async () => {
    const { id: repositoryId } = await local.data.register(checkout);
    const before = userRefs(path.join(checkout, ".git"));

    const created = await createFromUrl();
    const snapshot = local.store.read(created.reviewId);

    expect(created).toMatchObject({ created: true });
    expect(snapshot).toMatchObject({
      title: "Add widgets",
      pins: { repositoryId, base: fork, head: upstreamHead() },
      target: {
        kind: "commits",
        repositoryId,
        base: fork,
        head: upstreamHead(),
      },
      origin: { pullRequestUrl: url, pullRequestNumber: 7, baseBranch: "main" },
    });
    expect(snapshot.origin).not.toHaveProperty("branch");
    expect(await local.data.changes(snapshot.pins!, "feature.ts")).toContain(
      "+export const feature = 1;",
    );
    expect(userRefs(path.join(checkout, ".git"))).toBe(before);
  });

  it("keeps the same source identity when creating and retargeting by PR", async () => {
    pr.isCrossRepository = false;
    const created = await createFromUrl();
    const original = local.store.read(created.reviewId);
    const api = createReviewApi(local.store, local.data);

    const response = await api.request("/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        command({
          type: "set_target",
          reviewId: created.reviewId,
          target: {
            kind: "pullRequest",
            repositoryPath: checkout,
            pullRequest: 7,
          },
        }),
      ),
    });

    expect(response.status).toBe(200);
    const retargeted = local.store.read(created.reviewId);
    expect(retargeted.pins).toEqual(original.pins);
    expect(retargeted.origin).toEqual(original.origin);
    expect(retargeted.origin).toMatchObject({
      branch: "contributor",
      baseBranch: "main",
      pullRequestUrl: url,
    });
    expect(local.store.read(created.reviewId, original.version).origin).toEqual(
      original.origin,
    );
  });

  it("discovers a branch's PR without replacing its explicitly chosen comparison", async () => {
    const git = gitIn(checkout);
    git("fetch", "origin", "refs/pull/7/head:refs/heads/widgets");
    openPullRequests = [widgetsPullRequest("Add widgets", "lower-pr")];
    const registered = await local.data.register(checkout);

    const created = await local.store.execute(
      command({
        type: "create",
        title: "Explicit comparison",
        target: {
          kind: "commits",
          repositoryId: registered.id,
          head: "widgets",
          base: "main",
        },
      }),
    );

    const snapshot = local.store.read(created.reviewId);
    expect(snapshot.pins).toMatchObject({ head: upstreamHead(), base: trunk });
    expect(snapshot.origin).toMatchObject({
      pullRequestUrl: url,
      pullRequestNumber: 7,
      pullRequestBaseBranch: "lower-pr",
      branch: "widgets",
      baseBranch: "main",
    });

    const lookup = vi
      .spyOn(local.data, "findPullRequest")
      .mockRejectedValue(new Error("offline"));

    try {
      await local.store.execute(
        command({
          type: "set_target",
          reviewId: created.reviewId,
          target: {
            kind: "commits",
            repositoryId: registered.id,
            head: "widgets",
            base: "main",
          },
        }),
      );
      expect(local.store.read(created.reviewId).origin).toMatchObject({
        pullRequestUrl: url,
        pullRequestNumber: 7,
        pullRequestBaseBranch: "lower-pr",
      });
    } finally {
      lookup.mockRestore();
    }
  });

  it("finds a PR published after a branch review without rewriting its saved pins or history", async () => {
    const git = gitIn(checkout);
    git("fetch", "origin", "refs/pull/7/head:refs/heads/widgets");
    const registered = await local.data.register(checkout);

    const created = await local.store.execute(
      command({
        type: "create",
        title: "Before publishing",
        target: {
          kind: "commits",
          repositoryId: registered.id,
          head: "widgets",
          base: "main",
        },
      }),
    );

    const saved = local.store.read(created.reviewId);
    expect(saved.origin?.pullRequestUrl).toBeUndefined();
    openPullRequests = [widgetsPullRequest("Published later")];
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);

    try {
      const projected = await local.data.discoverPullRequest(saved);
      expect(projected.origin?.pullRequestUrl).toBe(url);
      expect(projected.origin?.pullRequestNumber).toBe(7);
      expect(projected.pins).toEqual(saved.pins);
      expect(local.store.read(created.reviewId)).toEqual(saved);
    } finally {
      clock.mockRestore();
    }
  });

  it("uses a linked worktree's HEAD", async () => {
    const git = gitIn(checkout);
    git("fetch", "origin", "refs/pull/7/head:refs/heads/widgets");
    const linked = path.join(directory, "linked");
    git("worktree", "add", "--quiet", linked, "widgets");
    openPullRequests = [widgetsPullRequest("Widgets")];
    const registered = await local.data.register(linked);

    const target = {
      kind: "worktree",
      repositoryId: registered.id,
      base: "main",
    };

    const created = await local.store.execute(
      command({ type: "create", title: "Linked", target }),
    );

    expect(local.store.read(created.reviewId).origin).toMatchObject({
      branch: "widgets",
      pullRequestUrl: url,
    });

    const explicitHead = await local.store.execute(
      command({
        type: "create",
        title: "Explicit HEAD",
        target: {
          kind: "commits",
          repositoryId: registered.id,
          head: "HEAD",
          base: "main",
        },
      }),
    );

    expect(local.store.read(explicitHead.reviewId).origin?.branch).toBe(
      "widgets",
    );
  });

  it("clears the former branch's PR identity when moving to a different branch", async () => {
    const git = gitIn(checkout);
    git("fetch", "origin", "refs/pull/7/head:refs/heads/widgets");
    openPullRequests = [widgetsPullRequest("Widgets")];
    const registered = await local.data.register(checkout);

    const created = await local.store.execute(
      command({
        type: "create",
        title: "Widgets",
        target: {
          kind: "commits",
          repositoryId: registered.id,
          head: "widgets",
          base: "main",
        },
      }),
    );

    expect(local.store.read(created.reviewId).origin?.pullRequestUrl).toBe(url);
    await local.store.execute(
      command({
        type: "set_target",
        reviewId: created.reviewId,
        target: {
          kind: "commits",
          repositoryId: registered.id,
          head: "main",
          base: fork,
        },
      }),
    );
    const moved = local.store.read(created.reviewId);
    expect(moved.origin?.branch).toBe("main");
    expect(moved.origin?.pullRequestUrl).toBeUndefined();
  });

  it("reuses a branch board when its PR is published later", async () => {
    const git = gitIn(checkout);
    git("fetch", "origin", "refs/pull/7/head:refs/remotes/origin/widgets");
    const registered = await local.data.register(checkout);

    const created = await local.store.execute(
      command({
        type: "create",
        title: "Before PR",
        target: {
          kind: "commits",
          repositoryId: registered.id,
          head: "origin/widgets",
          base: "main",
        },
      }),
    );

    pr.isCrossRepository = false;
    pr.headRefName = "widgets";
    expect(await createFromUrl()).toMatchObject({
      created: false,
      reviewId: created.reviewId,
    });
    expect(local.store.list()).toHaveLength(1);
  });

  it("does not hold up unrelated saves while optional PR discovery waits", async () => {
    const existing = await createFromUrl();
    const git = gitIn(checkout);
    git("fetch", "origin", "refs/pull/7/head:refs/heads/widgets");
    const registered = await local.data.register(checkout);
    let release!: () => void;
    let started!: () => void;

    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });

    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });

    const lookup = vi
      .spyOn(local.data, "findPullRequest")
      .mockImplementation(async () => {
        started();
        await waiting;

        return undefined;
      });

    const pending = local.store.execute(
      command({
        type: "create",
        title: "Slow lookup",
        target: {
          kind: "commits",
          repositoryId: registered.id,
          head: "widgets",
          base: "main",
        },
      }),
    );

    try {
      await entered;
      await local.store.execute(
        command({
          type: "rename",
          reviewId: existing.reviewId,
          title: "Save went through",
        }),
      );
      expect(local.store.read(existing.reviewId).title).toBe(
        "Save went through",
      );
    } finally {
      release();
      await pending;
      lookup.mockRestore();
    }
  });

  it("returns the existing review for a repeat, comparing against the PR's current head", async () => {
    const created = await createFromUrl();

    expect(await createFromUrl()).toMatchObject({
      created: false,
      reviewId: created.reviewId,
      headMoved: false,
    });

    gitIn(upstream)("checkout", "-q", "refs/pull/7/head");
    commit(upstream, "feature.ts", "export const feature = 2;\n");
    gitIn(upstream)("update-ref", "refs/pull/7/head", "HEAD");
    const calls = ghCalls;

    expect(await createFromUrl()).toMatchObject({
      created: false,
      reviewId: created.reviewId,
      headMoved: true,
    });
    expect(ghCalls).toBe(calls + 1);
  });

  it("requires restoring a deleted PR review before reusing it", async () => {
    await local.data.register(checkout);
    const created = await createFromUrl();
    await local.store.execute(
      command({
        type: "lifecycle",
        state: "trash",
        reviewId: created.reviewId,
      }),
    );
    const calls = ghCalls;

    await expect(createFromUrl()).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(created.reviewId),
    });
    expect(ghCalls).toBe(calls);
    expect(local.store.list()).toHaveLength(1);
    expect(local.store.read(created.reviewId).trashedAt).toBeTruthy();

    await local.store.execute(
      command({
        type: "lifecycle",
        state: "active",
        reviewId: created.reviewId,
      }),
    );
    expect(await createFromUrl()).toMatchObject({
      created: false,
      reviewId: created.reviewId,
    });
    await expect(
      local.store.execute(
        command({
          type: "rename",
          reviewId: created.reviewId,
          title: "Continued review",
        }),
      ),
    ).resolves.toMatchObject({ reviewId: created.reviewId });
  });

  it("diffs a merge-committed PR from GitHub's frozen base, not the absorbing branch", async () => {
    await local.data.register(checkout);
    gitIn(upstream)(
      "merge",
      "-q",
      "--no-ff",
      "refs/pull/7/head",
      "-m",
      "Merge",
    );
    pr.baseRefOid = trunk;

    const { reviewId } = await createFromUrl();

    expect(local.store.read(reviewId).pins).toMatchObject({
      base: fork,
      head: upstreamHead(),
    });
  });

  it("fetches the frozen base when the base branch is gone", async () => {
    await local.data.register(checkout);
    gitIn(upstream)("checkout", "-q", "-b", "release");
    const release = commit(upstream, "release.ts", "export const r = 1;\n");
    gitIn(upstream)("checkout", "-q", "main");
    gitIn(upstream)("branch", "-qD", "release");
    Object.assign(pr, { baseRefName: "release", baseRefOid: release });

    const { reviewId } = await createFromUrl();

    expect(local.store.read(reviewId).pins).toMatchObject({
      base: fork,
      head: upstreamHead(),
    });
  });

  it("refuses a checkout of another repository", async () => {
    const other = path.join(directory, "other");
    gitIn(directory)("init", "-q", other);
    gitIn(other)(
      "remote",
      "add",
      "origin",
      "https://github.com/acme/other.git",
    );
    await expect(createFromUrl({}, other)).rejects.toMatchObject({
      status: 404,
    });
    expect(ghCalls).toBe(0);
    expect(local.store.list()).toEqual([]);
  });

  it("resolves a GitHub Enterprise PR only from a remote on its host", async () => {
    const enterprise = "https://ghe.example.com/acme/widget/pull/7";
    const { id: repositoryId } = await local.data.register(checkout);

    const create = () =>
      local.store.execute(
        command({
          type: "create",
          pullRequestUrl: enterprise,
          repositoryId,
        }),
      );

    await expect(create()).rejects.toBeInstanceOf(ReviewInputError);
    expect(ghCalls).toBe(0);

    pointAtUpstream(
      path.join(checkout, ".git"),
      "https://ghe.example.com/acme/widget.git",
    );
    const { reviewId } = await create();

    expect(local.store.read(reviewId)).toMatchObject({
      pins: { repositoryId, base: fork, head: upstreamHead() },
      origin: { pullRequestUrl: enterprise, pullRequestNumber: 7 },
    });
  });

  it("fetches an Azure DevOps PR from a remote of its repository", async () => {
    const azure =
      "https://dev.azure.com/acme/project/_git/widget/pullrequest/7";

    gitIn(upstream)("branch", "feature", "refs/pull/7/head");
    pointAtUpstream(
      path.join(checkout, ".git"),
      "https://dev.azure.com/acme/project/_git/widget",
    );
    const { id: repositoryId } = await local.data.register(checkout);

    const { reviewId } = await local.store.execute(
      command({ type: "create", pullRequestUrl: azure, repositoryId }),
    );

    expect(local.store.read(reviewId)).toMatchObject({
      title: "Add widgets",
      pins: { repositoryId, base: fork, head: upstreamHead() },
      origin: {
        pullRequestUrl: azure,
        pullRequestNumber: 7,
        branch: "feature",
        baseBranch: "main",
      },
    });
  });

  it("stacks same-repository PRs by their branches without GitHub stacks", async () => {
    const up = gitIn(upstream);
    up("checkout", "-q", "-b", "lower");
    commit(upstream, "lower.ts", "export const lower = 1;\n");
    up("update-ref", "refs/pull/8/head", "HEAD");
    up("checkout", "-q", "-b", "upper");
    commit(upstream, "upper.ts", "export const upper = 1;\n");
    up("update-ref", "refs/pull/9/head", "HEAD");
    up("checkout", "-q", "main");
    const { id: repositoryId } = await local.data.register(checkout);

    const create = (number: number, head: string, base: string) => {
      pr = {
        number,
        title: `PR ${number}`,
        baseRefName: base,
        headRefName: head,
        isCrossRepository: false,
      };

      return local.store.execute(
        command({
          type: "create",
          pullRequestUrl: `https://github.com/acme/widget/pull/${number}`,
          repositoryId,
        }),
      );
    };

    await create(8, "lower", "main");
    const { reviewId } = await create(9, "upper", "lower");

    expect(local.store.read(reviewId).origin).toMatchObject({
      branch: "upper",
      baseBranch: "lower",
    });

    const layers = await resolveReviewStackLayers(
      { ...local.store.read(reviewId), reviewId },
      local.store.list(),
      {
        runGitHubApi: () => Promise.reject(new Error("stacks unavailable")),
        repositoryPath: checkout,
      },
    );

    expect(layers).toMatchObject([
      { branch: "lower", pullRequestNumber: 8, relation: "earlier" },
      { branch: "upper", pullRequestNumber: 9, relation: "current" },
    ]);
  });

  it("stacks a PR's boards from every project its repository is in", async () => {
    const up = gitIn(upstream);
    up("update-ref", "refs/pull/8/head", "refs/pull/7/head");
    const { id: repositoryId } = await local.data.register(checkout);

    const notes = path.join(directory, "notes");
    gitIn(directory)("init", "-q", notes);

    const { reviewId: elsewhere } = await local.store.execute(
      command({
        type: "create",
        title: "Notes",
        target: {
          kind: "project",
          repositoryId: (await local.data.register(notes)).id,
        },
      }),
    );

    const create = (number: number, projectId?: string) =>
      local.store.execute(
        command({
          type: "create",
          pullRequestUrl: `https://github.com/acme/widget/pull/${number}`,
          repositoryId,
          ...(projectId && { projectId }),
        }),
      );

    const lower = await create(7);
    const upper = await create(8, local.store.summary(elsewhere)!.project!.id);

    const bin = path.join(directory, "bin");
    mkdirSync(bin);
    writeFileSync(
      path.join(bin, "gh"),
      `#!/bin/sh\necho '${JSON.stringify([
        {
          pull_requests: [
            { number: 7, head: { ref: "lower" } },
            { number: 8, head: { ref: "upper" } },
          ],
        },
      ])}'\n`,
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH}`);

    const response = await createReviewApi(local.store, local.data).request(
      `/${upper.reviewId}/stack`,
    );

    expect((await response.json()).layers).toMatchObject([
      { pullRequestNumber: 7, reviewUuid: lower.reviewId },
      { pullRequestNumber: 8, reviewUuid: upper.reviewId },
    ]);
  });

  describe("as an agent names it to /commands", () => {
    const post = async <Operation>(operation: Operation) => {
      const response = await createReviewApi(local.store, local.data).request(
        "/commands",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation }),
        },
      );

      return {
        status: response.status,
        // SAFETY: a command's result names the board it saved.
        reviewId: ((await response.json()) as { reviewId?: string }).reviewId,
      };
    };

    it("creates a board from a PR number on the checkout's repository", async () => {
      const { status, reviewId } = await post({
        type: "create",
        target: {
          kind: "pullRequest",
          repositoryPath: checkout,
          pullRequest: 7,
        },
      });

      expect(status).toBe(200);
      expect(local.store.read(reviewId!)).toMatchObject({
        pins: { base: fork, head: upstreamHead() },
        origin: { pullRequestUrl: url, pullRequestNumber: 7 },
      });
    });

    it("retargets a board to a PR", async () => {
      const { reviewId } = await post({
        type: "create",
        title: "Plan",
        target: { kind: "project", repositoryPath: checkout },
      });

      const { status } = await post({
        type: "set_target",
        reviewId,
        target: {
          kind: "pullRequest",
          repositoryPath: checkout,
          pullRequest: url,
        },
      });

      expect(status).toBe(200);
      expect(local.store.read(reviewId!)).toMatchObject({
        pins: { base: fork, head: upstreamHead() },
        origin: { pullRequestUrl: url },
      });
    });

    it("checks a retarget before asking GitHub", async () => {
      const { status } = await post({
        type: "set_target",
        reviewId: "missing",
        target: {
          kind: "pullRequest",
          repositoryPath: checkout,
          pullRequest: 7,
        },
      });

      expect(status).toBe(404);
      expect(ghCalls).toBe(0);
    });
  });

  it("uses an explicit target, asking GitHub only for the PR's title", async () => {
    const { id: repositoryId } = await local.data.register(checkout);
    const head = gitIn(checkout)("rev-parse", "HEAD");

    const { reviewId } = await createFromUrl({
      title: "Mine",
      target: { kind: "commits", repositoryId, head },
    });

    expect(ghCalls).toBe(1);
    expect(local.store.read(reviewId)).toMatchObject({
      title: "Mine",
      pins: { base: head, head },
      origin: { pullRequestTitle: "Add widgets" },
    });
  });

  it.skipIf(!hasJj)(
    "indexes the PR commits in a non-colocated jj repository without leaving a tag",
    async () => {
      const jjRepo = path.join(directory, "jj");
      execFileSync("jj", ["git", "init", "--no-colocate", jjRepo], {
        stdio: "pipe",
      });

      const jj = (...args: string[]) =>
        execFileSync("jj", ["-R", jjRepo, "--ignore-working-copy", ...args], {
          encoding: "utf8",
        }).trim();

      pointAtUpstream(jj("git", "root"));
      const { id: repositoryId } = await local.data.register(jjRepo);

      const { reviewId } = await createFromUrl({}, jjRepo);

      const pins = local.store.read(reviewId).pins!;
      expect(pins).toMatchObject({
        repositoryId,
        base: fork,
        head: upstreamHead(),
      });
      expect(jj("log", "--no-graph", "-r", pins.head, "-T", "commit_id")).toBe(
        pins.head,
      );
      expect(jj("tag", "list")).toBe("");
      expect(jj("bookmark", "list", "--all-remotes")).toBe("");
      expect(await local.data.changes(pins, "feature.ts")).toContain(
        "+export const feature = 1;",
      );
    },
  );
});

describe("an Azure DevOps pull request", () => {
  const address = {
    host: "dev.azure.com",
    slug: "acme/My Project/widget",
    number: 7,
  };

  it("reads legacy and percent-encoded URLs as one address", () => {
    for (const url of [
      "https://dev.azure.com/acme/My%20Project/_git/widget/pullrequest/7",
      "https://acme.visualstudio.com/My%20Project/_git/widget/pullrequest/7",
      "https://acme.visualstudio.com/DefaultCollection/My%20Project/_git/widget/pullrequest/7",
    ])
      expect(resolvePullRequest(url).address).toEqual(address);
  });

  it("matches HTTPS and SSH remotes of its repository", () => {
    for (const remote of [
      "https://user@dev.azure.com/acme/My%20Project/_git/widget",
      "https://acme.visualstudio.com/DefaultCollection/My%20Project/_git/widget.git",
      "git@ssh.dev.azure.com:v3/acme/My%20Project/widget",
      "acme@vs-ssh.visualstudio.com:v3/acme/My%20Project/widget.git",
    ])
      expect(azureDevOpsProvider.matchesRemote(remote, address)).toBe(true);

    expect(
      azureDevOpsProvider.matchesRemote(
        "https://dev.azure.com/acme/My%20Project/_git/other",
        address,
      ),
    ).toBe(false);
  });

  it("says a missing PR was not found, with az's reason", async () => {
    const { provider } = resolvePullRequest(
      "https://dev.azure.com/acme/project/_git/widget/pullrequest/7",
    );

    const error = await provider
      .readPullRequest(address, {
        run: () =>
          Promise.reject(
            new Error("az repos: TF401027: The pull request does not exist."),
          ),
        fetch: () => Promise.reject(new Error("no network in tests")),
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ReviewInputError);
    expect(error).toMatchObject({ status: 404 });
    expect(String(error)).toMatch(/TF401027/);
  });
});
