import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { setLocalVcsCommandObserver } from "@dev.fast/local-vcs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AuthoringTool } from "./agent-client.js";
import { authoringTools } from "./authoring-tools.js";
import { ReviewApiClient } from "./client.js";
import { ReviewInputError } from "./document.js";
import { createReviewApi } from "./http.js";
import { callPublicTool, publicTool } from "./public-tools.js";
import { type ReviewProviders, ReviewStore } from "./store.js";

let directory: string, store: ReviewStore;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "review-relations-"));
  vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-01") });
  store = new ReviewStore(path.join(directory, "reviews.db"), {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  } satisfies ReviewProviders);
});

afterEach(async () => {
  vi.useRealTimers();
  await store.close();
  rmSync(directory, { recursive: true, force: true });
});

/** Each board is saved a minute after the last. */
const board = async (
  title: string,
  pins: { base: string; head: string } | undefined = undefined,
  repository = "repo",
) => {
  vi.setSystemTime(Date.now() + 60_000);

  const { id: repositoryId } = store.registerRepository(
    path.join(directory, repository),
  );

  return (
    await store.execute({
      operation: {
        type: "create",
        title,
        target: pins
          ? { kind: "commits", repositoryId, ...pins }
          : { kind: "project", repositoryId },
      },
    })
  ).reviewId;
};

const setParent = (reviewId: string, parentId: string | null) =>
  store.execute({ operation: { type: "set_parent", reviewId, parentId } });

const setDependencies = (reviewId: string, dependsOn: string[]) =>
  store.execute({
    operation: { type: "set_dependencies", reviewId, dependsOn },
  });

const titles = (ids: readonly string[]) =>
  ids.map((id) => store.read(id).title);

it("nests one level deep, within one project", async () => {
  const plan = await board("Plan");
  const step = await board("Step");
  const other = await board("Other");
  const elsewhere = await board("Elsewhere", undefined, "another-repo");

  await setParent(step, plan);

  // A child can't take children, and a parent can't become a child.
  await expect(setParent(other, step)).rejects.toThrow(ReviewInputError);
  await expect(setParent(plan, other)).rejects.toThrow(ReviewInputError);
  await expect(setParent(other, other)).rejects.toThrow(ReviewInputError);
  await expect(setParent(other, elsewhere)).rejects.toThrow(ReviewInputError);
  await expect(setParent(other, "no-such-board")).rejects.toThrow(
    ReviewInputError,
  );

  expect(store.relations(plan)).toEqual({
    parentId: null,
    children: [step],
    dependsOn: [],
  });

  // Moving a board to top level frees its parent to become a child.
  await setParent(step, null);
  await setParent(plan, other);
  expect(store.relations(plan).parentId).toBe(other);
});

it("refuses a dependency that closes a cycle, and names the cycle", async () => {
  const a = await board("Alpha");
  const b = await board("Bravo");
  const c = await board("Charlie");

  await setDependencies(a, [b]);
  await setDependencies(b, [c]);

  const refusal = await setDependencies(c, [a]).catch((error) => error);

  expect(refusal).toBeInstanceOf(ReviewInputError);
  expect(refusal.message).toMatch(/Charlie.*Alpha.*Bravo.*Charlie/);
  // Titles repeat; the ids say which boards to change.
  expect(refusal.message).toContain(a);
  await expect(setDependencies(a, [a])).rejects.toThrow(ReviewInputError);
  expect(store.relations(c).dependsOn).toEqual([]);
});

it("orders siblings after everything they reach through dependencies, then newest first", async () => {
  const plan = await board("Plan");
  const first = await board("First");
  const second = await board("Second");
  const third = await board("Third");
  const loose = await board("Loose");
  const outside = await board("Outside");

  for (const child of [first, second, third, loose])
    await setParent(child, plan);

  // Second reaches First only through a board outside the plan.
  await setDependencies(second, [outside]);
  await setDependencies(outside, [first]);
  await setDependencies(third, [second]);

  // Loose depends on nothing, and is the newest.
  expect(titles(store.relations(plan).children)).toEqual([
    "Loose",
    "First",
    "Second",
    "Third",
  ]);
  expect(store.summary(plan)!.children).toEqual(store.relations(plan).children);
});

it("keeps siblings in their order when one is edited, newest made first, then by id", async () => {
  const plan = await board("Plan");
  const older = await board("Older");
  const newer = await board("Newer");

  for (const child of [older, newer]) await setParent(child, plan);
  expect(titles(store.relations(plan).children)).toEqual(["Newer", "Older"]);

  vi.setSystemTime(Date.now() + 60_000);
  await store.execute({
    operation: { type: "rename", reviewId: older, title: "Older, edited" },
  });

  expect(titles(store.relations(plan).children)).toEqual([
    "Newer",
    "Older, edited",
  ]);
});

it("counts a board's place among the siblings the sidebar lists, not ones in Trash", async () => {
  const plan = await board("Plan");
  const first = await board("First");
  const trashed = await board("Trashed");
  const last = await board("Last");

  for (const child of [first, trashed, last]) await setParent(child, plan);
  await store.execute({
    operation: { type: "lifecycle", reviewId: trashed, state: "trash" },
  });

  expect(store.place(first).siblings.map(({ title }) => title)).toEqual([
    "Last",
    "First",
  ]);
  // The board in Trash still knows where it is.
  expect(
    store.place(trashed).siblings.map(({ reviewId }) => reviewId),
  ).toContain(trashed); // The parent lists the same children, in the same order.
  expect(store.place(plan).children?.map(({ title }) => title)).toEqual([
    "Last",
    "First",
  ]);
  expect(store.place(first).children).toBeUndefined();
});

it("orders a PR stack by its commits unless a dependency says otherwise", async () => {
  const stack = await board("Stack");

  // The upper PR is saved last, so recency alone would put it first.
  const lower = await board("Lower", { base: "main", head: "lower-head" });

  const upper = await board("Upper", {
    base: "lower-head",
    head: "upper-head",
  });

  await setParent(lower, stack);
  await setParent(upper, stack);
  expect(titles(store.relations(stack).children)).toEqual(["Lower", "Upper"]);

  await setDependencies(lower, [upper]);
  expect(titles(store.relations(stack).children)).toEqual(["Upper", "Lower"]);
});

describe("a PR on top of a sibling's commits, by git", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
      { encoding: "utf8" },
    ).trim();

  const commit = (cwd: string) => {
    git(cwd, "commit", "-q", "--allow-empty", "-m", "commit");

    return git(cwd, "rev-parse", "HEAD");
  };

  let repo: string;

  beforeEach(() => {
    repo = path.join(directory, "repo");
    execFileSync("git", ["init", "-q", repo]);
  });

  /** Lower, then Upper saved last: recency alone puts Upper first. */
  const stack = async (lowerHead: string, upperBase: string) => {
    const parent = await board("Stack");
    const lower = await board("Lower", { base: "main", head: lowerHead });
    const upper = await board("Upper", { base: upperBase, head: "upper" });

    await setParent(lower, parent);
    await setParent(upper, parent);

    return parent;
  };

  it("comes after it once git answers, off the server thread", async () => {
    const lowerHead = commit(repo);
    const parent = await stack(lowerHead, commit(repo));
    const changed = vi.fn<() => void>();
    store.subscribeCatalog(changed);

    expect(titles(store.relations(parent).children)).toEqual([
      "Upper",
      "Lower",
    ]);
    await vi.waitFor(() =>
      expect(titles(store.relations(parent).children)).toEqual([
        "Lower",
        "Upper",
      ]),
    );
    expect(changed).toHaveBeenCalled();
  });

  it("asks git a few questions at a time, and each once, however many siblings", async () => {
    const heads = Array.from({ length: 12 }, () => commit(repo));
    const parent = await board("Stack");

    for (const [index, head] of heads.entries()) {
      const child = await board(`PR ${index}`, {
        base: index ? heads[index - 1]! : "main",
        head,
      });

      await setParent(child, parent);
    }

    let running = 0;
    let most = 0;
    const asked: string[] = [];

    setLocalVcsCommandObserver({
      start: ({ args }) => {
        if (!args.includes("merge-base")) return () => {};

        asked.push(args.slice(-2).join(".."));
        most = Math.max(most, ++running);

        return () => running--;
      },
    });

    try {
      store.relations(parent);
      store.relations(parent);
      await vi.waitFor(() => expect(running).toBe(0), { timeout: 20_000 });
    } finally {
      setLocalVcsCommandObserver(null);
    }

    expect(asked.length).toBeGreaterThan(8);
    expect(most).toBeLessThanOrEqual(8);
    expect(new Set(asked).size).toBe(asked.length);
  }, 30_000);

  it("asks again when git couldn't answer, such as for a commit not fetched yet", async () => {
    const lowerHead = commit(repo);
    const clone = path.join(directory, "clone");
    execFileSync("git", ["clone", "-q", repo, clone]);
    const upperBase = commit(clone);
    const parent = await stack(lowerHead, upperBase);

    store.relations(parent);
    await new Promise((resolve) => setTimeout(resolve, 500));
    git(repo, "fetch", "-q", clone, "HEAD");
    vi.setSystemTime(Date.now() + 120_000);

    store.relations(parent);
    await vi.waitFor(() =>
      expect(titles(store.relations(parent).children)).toEqual([
        "Lower",
        "Upper",
      ]),
    );
  });
});

it("drops a board's relations when a retarget moves it to another project", async () => {
  const plan = await board("Plan");
  const step = await board("Step");
  await setParent(step, plan);

  const { id: repositoryId } = store.registerRepository(
    path.join(directory, "another-repo"),
  );

  const result = await store.execute({
    operation: {
      type: "set_target",
      reviewId: step,
      target: { kind: "project", repositoryId },
    },
  });

  expect(result.warnings).toHaveLength(1);
  expect(store.relations(step).parentId).toBeNull();
  expect(store.relations(plan).children).toEqual([]);
});

it("moves a deleted parent's children to top level and drops dependencies on it", async () => {
  const plan = await board("Plan");
  const step = await board("Step");
  const later = await board("Later");

  await setParent(step, plan);
  await setParent(later, plan);
  await setDependencies(later, [step, plan]);

  await store.execute({
    operation: { type: "lifecycle", state: "trash", reviewId: plan },
  });
  await store.execute({ operation: { type: "delete", reviewId: plan } });

  expect(store.relations(step).parentId).toBeNull();
  expect(store.relations(later)).toEqual({
    parentId: null,
    children: [],
    dependsOn: [step],
  });
});

it("lets an agent nest a board on create and read its place through the session tools", async () => {
  const plan = await board("Plan");
  const api = createReviewApi(store);

  const client = new ReviewApiClient(
    { serverUrl: "http://review.test", token: "t" },
    async (url, init) =>
      api.request(
        new URL(url).pathname.replace(/^\/reviews-api/, "") +
          new URL(url).search,
        init,
      ),
  );

  // SAFETY: the published tools as the server lists them over /authoring.
  const tools = (authoringTools() as AuthoringTool[]).map(publicTool);

  const call = (name: string, input: Parameters<typeof callPublicTool>[2]) =>
    callPublicTool(client, tools.find((tool) => tool.name === name)!, input);

  const { sessionId } = (await call("session_create", {
    title: "Step",
    target: {
      kind: "project",
      repositoryPath: path.join(directory, "repo"),
    },
    parentId: plan,
    open: false,
  })) as { sessionId: string };

  expect(
    await call("session_set_dependencies", { sessionId, dependsOn: [] }),
  ).toMatchObject({ relations: { parentId: plan } });

  const outline = await call("session_get", { sessionId: plan });

  expect(String(outline)).toContain(sessionId);

  // As JSON, a board names its parent, children and dependencies as
  // session_list does.
  const listed = (await call("session_list", {})) as ({
    sessionId: string;
  } & Parameters<typeof relations>[0])[];

  const relations = ({
    parentId,
    children,
    dependsOn,
  }: {
    parentId?: string;
    children?: string[];
    dependsOn?: string[];
  }) => ({ parentId, children, dependsOn });

  for (const id of [plan, sessionId])
    expect(
      relations(
        (await call("session_get", {
          sessionId: id,
          format: "json",
        })) as Parameters<typeof relations>[0],
      ),
    ).toEqual(relations(listed.find((each) => each.sessionId === id)!));

  expect(relations(listed.find((each) => each.sessionId === plan)!)).toEqual({
    children: [sessionId],
  });
});

it("tells a board's watchers when its parent's children change, without a version", async () => {
  const plan = await board("Plan");
  const step = await board("Step");
  const later = await board("Later");

  await setParent(step, plan);

  const api = createReviewApi(store);

  const watch = await api.request(
    `/watch?subscriptions=${encodeURIComponent(JSON.stringify([{ reviewId: step, mode: "textual" }]))}`,
  );

  const reader = watch.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";

  const next = async () => {
    while (!buffered.includes("\n")) buffered += (await reader.read()).value;
    const line = buffered.slice(0, buffered.indexOf("\n"));

    buffered = buffered.slice(line.length + 1);

    // A review's line; the list's lines are not asked for here.
    return JSON.parse(line).value;
  };

  const siblings = async () =>
    (
      (await (await api.request(`/${step}/place`)).json()) as {
        siblings: { reviewId: string }[];
      }
    ).siblings.map(({ reviewId }) => reviewId);

  try {
    expect(await next()).toMatchObject({ version: 0, placeRevision: 0 });
    expect(await siblings()).toEqual([step]);

    await setParent(later, plan);

    expect(await next()).toMatchObject({ version: 0, placeRevision: 1 });
    expect(await siblings()).toEqual([later, step]);
  } finally {
    await reader.cancel();
  }
});

it("keeps a checkout registered when a board made with it is still being saved", async () => {
  const { id: repositoryId } = store.registerRepository(
    path.join(directory, "racing"),
  );

  const created = store.execute({
    operation: {
      type: "create",
      title: "In flight",
      target: { kind: "project", repositoryId },
    },
  });

  await store.unregisterRepository(repositoryId);
  await created;

  expect(store.repositoryPath(repositoryId)).toBe(
    path.join(directory, "racing"),
  );
});

it("deletes a board 30 days in Trash as Delete… does: its children move up and links into it stay", async () => {
  const plan = await board("Plan");
  const step = await board("Step");
  const linking = await board("Linking");

  await setParent(step, plan);
  await store.execute({
    operation: {
      type: "edit",
      reviewId: linking,
      edit: {
        type: "insert",
        content: {
          type: "markdown",
          markdown: `See [the plan](whiteboard:board/${plan}).`,
        },
      },
    },
  });
  await store.execute({
    operation: { type: "lifecycle", state: "trash", reviewId: plan },
  });

  // A month on, the store opens and purges it.
  vi.setSystemTime(Date.now() + 31 * 86_400_000);
  await store.close();
  store = new ReviewStore(path.join(directory, "reviews.db"), {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  } satisfies ReviewProviders);

  expect(store.has(plan)).toBe(false);
  expect(store.relations(step).parentId).toBeNull();
  expect(store.linkingBoards(plan)).toEqual([linking]);
});

it("leaves a board in Trash out of its parent's children and others' dependencies until it is restored", async () => {
  const plan = await board("Plan");
  const step = await board("Step");
  const after = await board("After");

  await setParent(step, plan);
  await setDependencies(after, [step]);

  const lifecycle = (state: "trash" | "active") =>
    store.execute({ operation: { type: "lifecycle", state, reviewId: step } });

  await lifecycle("trash");
  expect(store.relations(plan).children).toEqual([]);
  expect(store.relations(after).dependsOn).toEqual([]);
  expect(
    store.list().find((summary) => summary.reviewId === plan)?.children ?? [],
  ).toEqual([]);
  // Its own place still knows where it was.
  expect(store.place(step).parent?.reviewId).toBe(plan);

  await lifecycle("active");
  expect(store.relations(plan).children).toEqual([step]);
  expect(store.relations(after).dependsOn).toEqual([step]);
});

it("keeps nesting one level deep across Trash, so a restore never makes a grandchild", async () => {
  const plan = await board("Plan");
  const step = await board("Step");
  const detail = await board("Detail");
  const other = await board("Other");

  await setParent(step, plan);

  const lifecycle = (reviewId: string, state: "trash" | "active") =>
    store.execute({ operation: { type: "lifecycle", state, reviewId } });

  await lifecycle(plan, "trash");
  await expect(setParent(detail, step)).rejects.toThrow(ReviewInputError);
  await lifecycle(plan, "active");
  expect(store.relations(plan).children).toEqual([step]);
  expect(store.relations(detail).parentId).toBeNull();

  await lifecycle(step, "trash");
  await expect(setParent(plan, other)).rejects.toThrow(ReviewInputError);
  await lifecycle(step, "active");
  expect(store.relations(step).parentId).toBe(plan);

  await lifecycle(plan, "trash");
  await setParent(step, other);
  await lifecycle(plan, "active");
  expect(store.relations(plan).children).toEqual([]);
  expect(store.relations(step).parentId).toBe(other);
});

it("refuses a dependency that closes a cycle through a board in Trash", async () => {
  const a = await board("Alpha");
  const b = await board("Bravo");
  const c = await board("Charlie");

  await setDependencies(a, [b]);
  await setDependencies(b, [c]);
  await store.execute({
    operation: { type: "lifecycle", state: "trash", reviewId: b },
  });

  await expect(setDependencies(c, [a])).rejects.toThrow(ReviewInputError);

  await store.execute({
    operation: { type: "lifecycle", state: "active", reviewId: b },
  });
  expect(store.relations(c).dependsOn).toEqual([]);
  expect(store.relations(a).dependsOn).toEqual([b]);
});

it("won't name a board in Trash as a parent or a dependency", async () => {
  const plan = await board("Plan");
  const step = await board("Step");
  const gone = await board("Gone");

  await store.execute({
    operation: { type: "lifecycle", state: "trash", reviewId: gone },
  });

  const refusal = await setParent(step, gone).catch((error) => error);

  expect(refusal).toBeInstanceOf(ReviewInputError);
  expect(refusal.message).toMatch(/Trash/);
  expect(refusal.message).toContain(gone);
  await expect(setDependencies(step, [plan, gone])).rejects.toThrow(/Trash/);

  expect(store.place(step).parent).toBeUndefined();
  expect(store.relations(step).dependsOn).toEqual([]);
});
