import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveReviewStackLayers } from "@review/review-stack.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { azureDevOpsProvider } from "./azure-devops-provider.js";
import { ReviewInputError } from "./document.js";
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
    expect(String(error)).toMatch(/gh auth login --hostname ghe\.example\.com/);
    expect(failing.calls.map(([file]) => file)).toEqual(["gh"]);
  });

  it("says a missing or private PR was not found, with gh's reason", async () => {
    const error = await readPullRequest(
      url,
      deps(ghFails, async () => new Response("{}", { status: 404 })),
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ReviewInputError);
    expect(error).toMatchObject({ status: 404 });
    expect(String(error)).toMatch(/not found.*gh auth status.*not logged in/);
  });

  it("names an exhausted rate limit", async () => {
    await expect(
      readPullRequest(
        url,
        deps(
          ghFails,
          async () =>
            new Response("{}", {
              status: 403,
              headers: { "x-ratelimit-remaining": "0" },
            }),
        ),
      ),
    ).rejects.toThrow(/rate limit is exhausted.*gh auth status/);
  });
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

          return JSON.stringify(pr);
        },
        fetch: () => Promise.reject(new Error("no network in tests")),
      },
    });
  });

  afterEach(async () => {
    await local.store.close();
    await local.data.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const createFromUrl = (
    fields: {
      title?: string;
      target?: { kind: "commits"; repositoryId: string; head: string };
    } = {},
  ) =>
    local.store.execute(
      command({ type: "create", pullRequestUrl: url, ...fields }),
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

  it("returns the existing review for a repeat, comparing against the PR's current head", async () => {
    await local.data.register(checkout);
    const first = command({ type: "create", pullRequestUrl: url });
    const created = await local.store.execute(first);

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

  it("asks for a registered checkout of the PR's repository", async () => {
    const other = path.join(directory, "other");
    gitIn(directory)("init", "-q", other);
    gitIn(other)(
      "remote",
      "add",
      "origin",
      "https://github.com/acme/other.git",
    );
    await local.data.register(other);

    await expect(createFromUrl()).rejects.toThrow(
      /Register a checkout of acme\/widget/,
    );
    expect(local.store.list()).toEqual([]);
  });

  it("resolves a GitHub Enterprise PR only from a remote on its host", async () => {
    const enterprise = "https://ghe.example.com/acme/widget/pull/7";
    const { id: repositoryId } = await local.data.register(checkout);

    const create = () =>
      local.store.execute(
        command({ type: "create", pullRequestUrl: enterprise }),
      );

    await expect(create()).rejects.toThrow(
      /Register a checkout of ghe\.example\.com\/acme\/widget/,
    );
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
      command({ type: "create", pullRequestUrl: azure }),
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
    await local.data.register(checkout);

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

      const { reviewId } = await createFromUrl();

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
