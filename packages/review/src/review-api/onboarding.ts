import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  type ReviewOnboardingProject,
  ReviewOnboardingRunRequestSchema,
  type ReviewOnboardingTarget,
  type ReviewOnboardingTargetsResponse,
} from "@dev.fast/review-protocol";
import {
  type AskAgentId,
  type AskPicks,
  askAgentIds,
} from "@review/ask/thread-state.js";
import type { AskThreadHooks } from "@review/ask/thread.js";
import { readBoundedRequestJson } from "@review/server/hono-http.js";
import type { Hono } from "hono";
import { z } from "zod";

import type { AskRecord } from "./ask-history.js";
import { ReviewInputError } from "./document.js";
import type { AskHost } from "./http.js";
import { recentFolders } from "./recent-folders.js";
import type { ReviewStore } from "./store.js";

const COMMAND_TIMEOUT_MS = 15_000;

const PULL_REQUEST_LIMIT = 10;

/** Ignored when the agent does not offer the model. */
const RUN_PICKS: Partial<Record<AskAgentId, AskPicks>> = {
  claude: { model: "sonnet" },
  codex: { model: "gpt-6-luna" },
};

/** Runs one subprocess and resolves its stdout; rejects on failure. */
export type OnboardingRun = (
  file: string,
  args: string[],
  cwd: string,
) => Promise<string>;

const runCommand: OnboardingRun = (file, args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        // Never wait on a credential prompt nobody can see.
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GH_PROMPT_DISABLED: "1",
        },
        windowsHide: true,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

/** Scratch repositories, such as test fixtures, are nobody's project. */
const TEMPORARY_ROOTS = [os.tmpdir(), "/tmp", "/private/tmp", "/var/folders"];

const isInside = (roots: string[], folder: string) =>
  roots.some((root) => {
    const relative = path.relative(root, folder);

    return !relative.startsWith("..") && !path.isAbsolute(relative);
  });

async function modified(file: string): Promise<number> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

/** The repository a folder belongs to, and when it last saw Git activity.
 * Worktrees resolve to their main checkout, which lists them as targets. */
async function repositoryOf(folder: string, run: OnboardingRun) {
  try {
    if (!(await stat(folder)).isDirectory()) return undefined;

    const common = path.resolve(
      folder,
      (
        await run(
          "git",
          ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          folder,
        )
      ).trim(),
    );

    // A bare repository has no checkout to draw from.
    if (path.basename(common) !== ".git") return undefined;

    const activity = await Promise.all(
      ["index", "FETCH_HEAD", path.join("logs", "HEAD")].map((file) =>
        modified(path.join(common, file)),
      ),
    );

    return { root: path.dirname(common), active: Math.max(...activity) };
  } catch {
    return undefined;
  }
}

const RESOLVE_CONCURRENCY = 8;

const PROJECT_LIMIT = 30;

/** The repositories behind folders Whiteboard, the user's agents, and their
 * editors have worked in, most recently active first. */
export async function onboardingProjects(
  folders: string[],
  {
    run = runCommand,
    temporaryRoots = TEMPORARY_ROOTS,
  }: { run?: OnboardingRun; temporaryRoots?: string[] } = {},
): Promise<ReviewOnboardingProject[]> {
  const isTemporary = (folder: string) => isInside(temporaryRoots, folder);
  const queue = [...new Set(folders)].filter((folder) => !isTemporary(folder));
  const roots = new Map<string, number>();

  await Promise.all(
    Array.from({ length: RESOLVE_CONCURRENCY }, async () => {
      for (let folder = queue.shift(); folder; folder = queue.shift()) {
        const repository = await repositoryOf(folder, run);

        if (repository && !isTemporary(repository.root))
          roots.set(repository.root, repository.active);
      }
    }),
  );

  return [...roots]
    .sort((a, b) => b[1] - a[1])
    .slice(0, PROJECT_LIMIT)
    .map(([root]) => ({ path: root, name: path.basename(root) }));
}

interface Worktree {
  path: string;
  branch?: string;
}

/** `git worktree list --porcelain`: blocks of `worktree`, `HEAD`, `branch`. */
export function parseWorktrees(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  let current: Worktree | undefined;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length) };
      worktrees.push(current);
    } else if (current && line.startsWith("branch "))
      current.branch = line
        .slice("branch ".length)
        .replace(/^refs\/heads\//, "");
  }

  return worktrees;
}

const pullRequestsSchema = z.array(
  z.object({
    number: z.number().int().positive(),
    title: z.string().min(1),
    url: z.string().min(1),
    author: z.object({ login: z.string() }).nullish(),
    headRefName: z.string().optional(),
    additions: z.number().int().nonnegative().optional(),
    deletions: z.number().int().nonnegative().optional(),
    updatedAt: z.string().optional(),
  }),
);

/** A target, and when it last moved, in milliseconds. */
interface Dated {
  target: ReviewOnboardingTarget;
  at: number;
}

/** When each local branch last got a commit, in milliseconds. */
async function branchTimes(
  root: string,
  run: OnboardingRun,
): Promise<Map<string, number>> {
  const output = await run(
    "git",
    [
      "for-each-ref",
      "--format=%(refname:short)%09%(committerdate:unix)",
      "refs/heads",
    ],
    root,
  ).catch(() => "");

  return new Map(
    output
      .split("\n")
      .map((line) => line.split("\t"))
      .filter(([branch, seconds]) => branch && seconds)
      .map(([branch, seconds]) => [branch, Number(seconds) * 1000]),
  );
}

async function defaultBase(root: string, run: OnboardingRun): Promise<string> {
  try {
    return (
      await run(
        "git",
        ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        root,
      )
    )
      .trim()
      .replace(/^origin\//, "");
  } catch {
    return "main";
  }
}

async function pullRequests(
  root: string,
  run: OnboardingRun,
): Promise<Dated[]> {
  try {
    const listed = pullRequestsSchema.parse(
      JSON.parse(
        await run(
          "gh",
          [
            "pr",
            "list",
            "--limit",
            String(PULL_REQUEST_LIMIT),
            // The most recently touched, not the most recently opened.
            "--search",
            "sort:updated-desc",
            "--json",
            "number,title,url,author,headRefName,additions,deletions,updatedAt",
          ],
          root,
        ),
      ),
    );

    return listed.map((pr) => ({
      target: {
        kind: "pr",
        number: pr.number,
        title: pr.title,
        url: pr.url,
        author: pr.author?.login ?? "",
        branch: pr.headRefName ?? "",
        additions: pr.additions ?? 0,
        deletions: pr.deletions ?? 0,
      },
      at: pr.updatedAt ? Date.parse(pr.updatedAt) || 0 : 0,
    }));
  } catch {
    // No gh, not signed in, or no GitHub remote: branches still work.
    return [];
  }
}

/** What a repository offers to draw: its checkout's branch, its other
 * worktrees, and its open pull requests, most recently touched first. */
export async function onboardingTargets(
  directory: string,
  run: OnboardingRun = runCommand,
): Promise<ReviewOnboardingTargetsResponse> {
  let root: string;

  try {
    root = (
      await run("git", ["rev-parse", "--show-toplevel"], directory)
    ).trim();
  } catch {
    throw new ReviewInputError("Choose a folder inside a Git repository.", 400);
  }

  const [branch, worktreeList, base, prs, times] = await Promise.all([
    run("git", ["branch", "--show-current"], root).then(
      (output) => output.trim(),
      () => "",
    ),
    run("git", ["worktree", "list", "--porcelain"], root).catch(() => ""),
    defaultBase(root, run),
    pullRequests(root, run),
    branchTimes(root, run),
  ]);

  const local = (target: ReviewOnboardingTarget & { branch: string }) => ({
    target,
    at: times.get(target.branch) ?? 0,
  });

  const worktrees = parseWorktrees(worktreeList)
    .filter(
      (worktree) =>
        worktree.branch &&
        path.resolve(worktree.path) !== path.resolve(root) &&
        // Whiteboard's own checkouts live under the git dir.
        !worktree.path.split(/[\\/]/).includes("dev-fast") &&
        // Scratch checkouts, such as an agent's throwaway worktree.
        !isInside(TEMPORARY_ROOTS, worktree.path),
    )
    .map((worktree) =>
      local({
        kind: "worktree",
        path: worktree.path,
        branch: worktree.branch ?? "",
      }),
    );

  return {
    project: { path: root, name: path.basename(root) },
    base,
    // A stable sort: what git and gh leave undated keeps their order.
    targets: [
      ...(branch ? [local({ kind: "branch", path: root, branch })] : []),
      ...worktrees,
      ...prs,
    ]
      .sort((a, b) => b.at - a.at)
      .map(({ target }) => target),
  };
}

/** What the agent reads before the user's prompt: the whiteboard is made,
 * and only needs drawing. */
async function runContext(
  ask: AskHost,
  agent: (typeof askAgentIds)[number],
  threadId: string,
  reviewId: string,
) {
  const reach = await ask.threads.reach(agent, threadId);

  return [
    `The user asked for a whiteboard from inside the Whiteboard app. The app already made it, empty, and shows it beside this conversation: its sessionId is "${reviewId}". Draw into it; do not create another.`,
    ...(reach?.kind === "mcp"
      ? [
          `Use the whiteboard MCP tools: read session_get_instructions({}) for the guidelines and each component's fields, then fill this whiteboard with session_edit({"sessionId":"${reviewId}", ...}).`,
        ]
      : reach?.kind === "cli"
        ? [
            `Whiteboard's CLI changes whiteboards from your shell: read \`${reach.command} api session_get_instructions '{}'\` for the guidelines and each component's fields, then fill this whiteboard with \`${reach.command} api session_edit '{"sessionId":"${reviewId}", ...}'\`. \`${reach.command} api tools\` lists each tool's input.`,
          ]
        : []),
  ].join("\n");
}

/** What starting a run borrows from the review API it is served by. */
export interface OnboardingRunHost {
  /** Registers a checkout, for a whiteboard to target. */
  register(root: string): Promise<{ id: string }>;
  /** Where a thread in a review saves itself. */
  historyHooks(record: Omit<AskRecord, "sessionId">): AskThreadHooks;
  /** Queues a thread for its review's Ask panel to open. */
  handOff(reviewId: string, threadId: string): void;
  /** Shows a review in Desktop; reports, rather than throws, a failure. */
  open(reviewId: string): Promise<{ opened: boolean }>;
}

/** First run's Run step, and Home's New whiteboard: make the whiteboard, open
 * it, and start an agent drawing it in its Ask panel. */
export function registerOnboardingRoutes(
  app: Hono,
  store: ReviewStore,
  ask: AskHost,
  host: OnboardingRunHost,
  run: OnboardingRun = runCommand,
): void {
  app.get("/onboarding/agents", async (context) =>
    context.json({ agents: await ask.agents() }),
  );

  app.get("/onboarding/projects", async (context) =>
    context.json({
      projects: await onboardingProjects(
        [
          ...store.repositories().map((repository) => repository.path),
          ...(await recentFolders()),
        ],
        { run },
      ),
    }),
  );

  app.get("/onboarding/targets", async (context) => {
    const directory = context.req.query("path");

    if (!directory) throw new ReviewInputError("A folder is required.", 400);

    return context.json(await onboardingTargets(directory, run));
  });

  app.post("/onboarding/runs", async (context) => {
    const parsed = ReviewOnboardingRunRequestSchema.extend({
      agent: z.enum(askAgentIds),
    }).safeParse(await readBoundedRequestJson(context.req.raw));

    if (!parsed.success) throw new ReviewInputError("Invalid run.", 400);
    const input = parsed.data;
    const { target } = input;

    // A pull request is drawn from the project; a branch from its checkout.
    const cwd = target.kind === "pr" ? input.projectPath : target.path;
    let head: string;

    try {
      head = (await run("git", ["rev-parse", "HEAD"], cwd)).trim();
    } catch {
      throw new ReviewInputError(
        "Choose a folder inside a Git repository.",
        400,
      );
    }

    const repository = await host.register(cwd);

    // An existing whiteboard for the same pull request comes back instead.
    const created = await store.execute({
      operation:
        target.kind === "pr"
          ? {
              type: "create",
              pullRequestUrl: target.url,
              repositoryId: repository.id,
            }
          : {
              type: "create",
              title: target.branch,
              target: {
                kind: "worktree",
                repositoryId: repository.id,
                ...(input.base && { base: input.base }),
              },
            },
    });

    const { reviewId } = created;
    const title = store.read(reviewId).title;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    ask.threads.open({
      id,
      reviewId,
      agent: input.agent,
      ...host.historyHooks({
        id,
        anchor: { board: reviewId },
        agent: input.agent,
        version: created.version,
        head,
        cwd,
        selection: { target: { kind: "review" }, title },
        title,
        createdAt: now,
        updatedAt: now,
      }),
      cwd,
      head,
      selection: { title },
      context: await runContext(ask, input.agent, id, reviewId),
      picks: RUN_PICKS[input.agent],
      question: { text: input.prompt },
    });

    // Before it opens, so its canvas finds the conversation waiting.
    host.handOff(reviewId, id);
    await host.open(reviewId);

    return context.json({ reviewId });
  });
}
