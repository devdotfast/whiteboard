import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { AskThreads } from "@review/ask/threads.js";
import { AskHistory, type AskRecord } from "@review/review-api/ask-history.js";
import { ReviewInputError } from "@review/review-api/document.js";
import { createReviewApi } from "@review/review-api/http.js";
import type { LocalReviewData } from "@review/review-api/local-data.js";
import { ReviewStore } from "@review/review-api/store.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { STORE_UPGRADES } from "./store-migrations.js";
import { initializeReviewStoreSchema } from "./store-schema.js";

const upgradeVersion = (name: string) =>
  STORE_UPGRADES.find((step) => step.name === name)!.version;

const pins = { repositoryId: "repo", base: "base", head: "head" };

const command = <Operation>(operation: Operation) => ({ operation });

let store: ReviewStore;

beforeEach(() => {
  store = new ReviewStore(":memory:", {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });
});

afterEach(async () => {
  await store.close();
});

it("lets two hosts open an old store at once, the second finding the first's upgrade", async () => {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "ask-")),
    "review-api.db",
  );

  const db = new DatabaseSync(file);

  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE ask_conversations(id TEXT PRIMARY KEY, review_id TEXT NOT NULL,
      agent TEXT NOT NULL, session_id TEXT NOT NULL, version INTEGER NOT NULL,
      head TEXT NOT NULL, cwd TEXT NOT NULL, selection TEXT NOT NULL,
      title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      entries TEXT, UNIQUE(agent, session_id));`);

  // Both hosts start while a third holds the write lock, so each reads the
  // old table before either can change it.
  db.exec("BEGIN IMMEDIATE");

  const host = () =>
    new Promise<number | null>((resolve) =>
      execFile(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `const { ReviewStore } = await import(${JSON.stringify(new URL("./store.ts", import.meta.url).href)});
          const providers = { validatePins: async () => {}, validateSource: async () => {}, validateResource: async () => {} };
          await new ReviewStore(${JSON.stringify(file)}, providers).close();`,
        ],
        (error) => resolve(error ? (error.code as number) : 0),
      ),
    );

  const hosts = [host(), host()];

  await new Promise((resolve) => setTimeout(resolve, 1_500));
  db.exec("COMMIT");
  db.close();

  expect(await Promise.all(hosts)).toEqual([0, 0]);
}, 20_000);

const record = (
  reviewId: string,
  id: string,
  updatedAt: string,
): AskRecord => ({
  id,
  anchor: { board: reviewId },
  agent: "claude",
  sessionId: `session-${id}`,
  version: 0,
  head: "7fd03b8e2",
  cwd: "/checkouts/payments-service",
  title: `Question ${id}`,
  selection: {
    title: "Paragraph 3",
    target: { kind: "text", quote: "The index is created concurrently." },
  },
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt,
  permissions: "read-only",
});

it("keeps each review's conversations, newest first, until the review is deleted", async () => {
  const { reviewId } = await store.execute(
    command({
      type: "create",
      title: "Payments",
      target: { kind: "commits", ...pins },
    }),
  );

  const history = store.askHistory;

  history.save(record(reviewId, "older", "2026-09-01T10:00:00.000Z"));
  history.save(record(reviewId, "newer", "2026-09-01T11:00:00.000Z"));
  history.save(record("shared-review", "shared", "2026-09-01T12:00:00.000Z"));

  expect(history.list(reviewId).map(({ id }) => id)).toEqual([
    "newer",
    "older",
  ]);
  // The list is what the panel shows; the session stays on the server.
  expect(history.list(reviewId)[0]).not.toHaveProperty("sessionId");

  history.touch("older", "2026-09-01T12:30:00.000Z");
  expect(history.list(reviewId).map(({ id }) => id)).toEqual([
    "older",
    "newer",
  ]);
  // Its project is its board's.
  expect(history.get("older")).toEqual({
    ...record(reviewId, "older", "2026-09-01T12:30:00.000Z"),
    projectId: store.projectOf(reviewId),
  });

  history.delete("newer");
  expect(history.get("newer")).toBeUndefined();

  await store.execute(command({ type: "lifecycle", state: "trash", reviewId }));
  expect(history.list(reviewId)).toHaveLength(1);
  expect(() => history.rename("older", "Changed")).toThrow(ReviewInputError);
  await store.execute(command({ type: "delete", reviewId }));
  expect(history.list(reviewId)).toEqual([]);
  expect(history.list("shared-review").map(({ id }) => id)).toEqual(["shared"]);
});

it("keeps what the panel showed, and what each agent offered", () => {
  const db = new DatabaseSync(":memory:");
  initializeReviewStoreSchema(db);

  try {
    const history = new AskHistory(db);
    const saved = record("review", "thread", "2026-09-01T10:00:00.000Z");

    history.save(saved);

    const entries = [
      { kind: "user" as const, id: "q", text: "Is this safe?", at: 1 },
      { kind: "agent" as const, id: "a", text: "It does." },
    ];

    history.saveEntries("thread", entries);
    expect(history.get("thread")).toEqual({ ...saved, entries });
    expect(history.list("review")[0]).not.toHaveProperty("entries");
    history.rename("thread", "Generic agent title");
    expect(history.list("review")[0]).toMatchObject({
      title: "Generic agent title",
      question: "Is this safe?",
    });
    expect(new AskHistory(db).get("thread")?.entries).toEqual(entries);

    // What an agent offered last, for picking before it starts.
    const offer = {
      choices: {
        model: {
          current: "default",
          options: [{ value: "default", name: "Default" }],
        },
        effort: { current: "high", options: [{ value: "high", name: "High" }] },
      },
      commands: [{ name: "review", description: "Review the change" }],
      accepts: { image: true },
    };

    expect(history.offer("claude")).toBeUndefined();
    history.saveOffer("claude", offer);
    expect(new AskHistory(db).offer("claude")).toEqual(offer);

    // And last with each model: the efforts on offer depend on it.
    const haiku = {
      choices: {
        model: {
          current: "haiku",
          options: [
            { value: "default", name: "Default" },
            { value: "haiku", name: "Haiku" },
          ],
        },
      },
    };

    expect(history.offer("claude", "default")).toEqual(offer);
    expect(history.offer("claude", "haiku")).toBeUndefined();
    history.saveModelOffer("claude", haiku);
    expect(history.offer("claude", "haiku")).toEqual(haiku);
    expect(history.offer("claude")).toEqual(offer);
  } finally {
    db.close();
  }
});

it("reopens a conversation in the new session that replaced one its agent lost, with what it showed", () => {
  const history = store.askHistory;
  const entries = [{ kind: "user" as const, id: "asked", text: "Is it?" }];

  history.save(record("review", "lost", "2026-09-01T10:00:00.000Z"));
  history.saveEntries("lost", entries);
  history.updateSession("lost", "session-new");

  expect(history.get("lost")).toMatchObject({
    sessionId: "session-new",
    entries,
  });
});

it("serves a saved conversation without its agent or its checkout", async () => {
  const { reviewId } = await store.execute(
    command({
      type: "create",
      title: "Payments",
      target: { kind: "commits", ...pins },
    }),
  );

  const entries = [
    { kind: "user" as const, id: "q", text: "Is this safe?", at: 1 },
    { kind: "agent" as const, id: "a", text: "It does." },
  ];

  store.askHistory.save(record(reviewId, "thread", "2026-09-01T10:00:00.000Z"));
  store.askHistory.saveEntries("thread", entries);

  const api = createReviewApi(
    store,
    {} as LocalReviewData,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { threads: {} as AskThreads, agents: async () => [] },
  );

  const response = await api.request(`/${reviewId}/ask/thread`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ entries });
});

it("lists a project's conversations on every board in it, each with the board it started on", async () => {
  const checkout = path.join(mkdtempSync(path.join(tmpdir(), "ask-")), "repo");
  execFileSync("git", ["init", "-q", checkout]);
  const { id: repositoryId } = store.registerRepository(checkout);

  const board = async (title: string) =>
    (
      await store.execute(
        command({
          type: "create",
          title,
          target: { kind: "commits", ...pins, repositoryId },
        }),
      )
    ).reviewId;

  const plan = await board("Plan");
  const pr = await board("PR");
  const projectId = store.projectOf(plan);

  store.askHistory.save({
    ...record(plan, "thread", "2026-09-01T10:00:00.000Z"),
    projectId,
  });

  expect(store.askHistory.list(pr, store.projectOf(pr))).toMatchObject([
    { id: "thread", anchor: { board: plan } },
  ]);
  // A board in no project sees only its own.
  expect(store.askHistory.list("elsewhere")).toEqual([]);

  const api = createReviewApi(
    store,
    {} as LocalReviewData,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { threads: {} as AskThreads, agents: async () => [] },
  );

  // Any board in the project opens the thread.
  expect((await api.request(`/${pr}/ask/thread`)).status).toBe(200);
});

it("lets a thread change boards in any project, and lists the boards it changed", async () => {
  const repository = (name: string) => {
    const checkout = path.join(mkdtempSync(path.join(tmpdir(), "ask-")), name);

    execFileSync("git", ["init", "-q", checkout]);

    return store.registerRepository(checkout).id;
  };

  const board = async (repositoryId: string, title: string) =>
    (
      await store.execute(
        command({
          type: "create",
          title,
          target: { kind: "commits", ...pins, repositoryId },
        }),
      )
    ).reviewId;

  const app = repository("app");
  const plan = await board(app, "Plan");
  const pr = await board(app, "PR");
  const elsewhere = await board(repository("other"), "Elsewhere");

  store.askHistory.save({
    ...record(plan, "thread", "2026-09-01T10:00:00.000Z"),
    projectId: store.projectOf(plan),
  });

  // A create names its checkout by path; the rest goes unused.
  const local = {} as LocalReviewData;

  local.register = async (checkout) => store.registerRepository(checkout);

  const api = createReviewApi(
    store,
    local,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { threads: {} as AskThreads, agents: async () => [] },
  );

  const edit = (reviewId: string) =>
    api.request("/commands", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-review-thread": "thread",
      },
      body: JSON.stringify(
        command({
          type: "edit",
          reviewId,
          edit: {
            type: "insert",
            content: { type: "markdown", markdown: "Noted." },
          },
        }),
      ),
    });

  expect((await edit(pr)).status).toBe(200);
  expect((await edit(elsewhere)).status).toBe(200);

  const create = (
    repositoryId: string,
    relations: { parentId?: string; dependsOn?: string[] } = {},
  ) =>
    api.request("/commands", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-review-thread": "thread",
      },
      body: JSON.stringify(
        command({
          type: "create",
          title: "Step",
          target: {
            kind: "project",
            repositoryPath: store
              .repositories()
              .find(({ id }) => id === repositoryId)!.path,
          },
          ...relations,
        }),
      ),
    });

  expect((await create(app, { parentId: plan })).status).toBe(200);

  // A rename is the thread's too, as its edits and creates are.
  await api.request("/commands", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-review-thread": "thread",
    },
    body: JSON.stringify(
      command({ type: "rename", reviewId: plan, title: "The plan" }),
    ),
  });

  const changed = await api.request(`/${plan}/ask/thread/boards`);

  const { boards } = (await changed.json()) as {
    boards: { title: string }[];
  };

  expect(boards.map(({ title }) => title).sort()).toEqual([
    "Elsewhere",
    "PR",
    "Step",
    "The plan",
  ]);
  // Only for a local caller: it names boards across projects.
  expect(
    (
      await api.request(`/${plan}/ask/thread/boards`, {
        headers: { "x-review-client": "remote" },
      })
    ).status,
  ).toBe(404);
});

it("anchors a conversation saved per review on that review", async () => {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "ask-")),
    "reviews.db",
  );

  const db = new DatabaseSync(file);

  db.exec(`CREATE TABLE ask_conversations(id TEXT PRIMARY KEY, review_id TEXT NOT NULL,
    agent TEXT NOT NULL, session_id TEXT NOT NULL, version INTEGER NOT NULL, head TEXT NOT NULL,
    cwd TEXT NOT NULL, selection TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, entries TEXT, bypass INTEGER NOT NULL DEFAULT 0, UNIQUE(agent, session_id));
  CREATE INDEX ask_conversations_review ON ask_conversations(review_id, updated_at);`);
  db.prepare(
    "INSERT INTO ask_conversations VALUES('old','board-1','claude','s',0,'h','/c',?,'Old','t','t',NULL,0)",
  ).run(JSON.stringify(record("x", "y", "t").selection));
  db.close();

  const opened = new ReviewStore(file, {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });

  try {
    expect(opened.askHistory.get("old")).toMatchObject({
      anchor: { board: "board-1" },
    });
  } finally {
    await opened.close();
  }
});

it("streams every project's threads with where each lives and the boards it changed, and follows new edits", async () => {
  const checkout = path.join(mkdtempSync(path.join(tmpdir(), "ask-")), "repo");
  execFileSync("git", ["init", "-q", checkout]);
  const { id: repositoryId } = store.registerRepository(checkout);

  const board = async (title: string, repository = repositoryId) =>
    (
      await store.execute(
        command({
          type: "create",
          title,
          target: { kind: "commits", ...pins, repositoryId: repository },
        }),
      )
    ).reviewId;

  const plan = await board("Plan");
  const pr = await board("PR");
  const other = path.join(path.dirname(checkout), "other");
  execFileSync("git", ["init", "-q", other]);

  const elsewhere = await board(
    "Elsewhere",
    store.registerRepository(other).id,
  );

  store.askHistory.save({
    ...record(plan, "thread", "2026-09-01T10:00:00.000Z"),
    projectId: store.projectOf(plan),
  });
  store.askHistory.save({
    ...record(elsewhere, "away", "2026-09-02T10:00:00.000Z"),
    projectId: store.projectOf(elsewhere),
  });

  const api = createReviewApi(
    store,
    {} as LocalReviewData,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      // No agent runs here; the stream only asks threads for their status.
      threads: new AskThreads(async () => {
        throw new Error("No agent in this test.");
      }),
      agents: async () => [],
    },
  );

  const abort = new AbortController();

  const response = await api.request(`/${pr}/ask/threads?watch`, {
    signal: abort.signal,
  });

  const reader = response
    .body!.pipeThrough(new TextDecoderStream())
    .getReader();

  const next = async () => {
    let line = "";

    while (!line.includes("\n")) line += (await reader.read()).value ?? "";

    return JSON.parse(line);
  };

  expect(await next()).toMatchObject({
    board: pr,
    project: store.projectOf(pr),
    threads: [
      {
        id: "away",
        projectId: store.projectOf(elsewhere),
        place: "other",
      },
      {
        id: "thread",
        projectId: store.projectOf(plan),
        place: "repo",
        anchor: { board: { reviewId: plan, title: "Plan" } },
        edited: [],
      },
    ],
  });

  await store.execute(
    command({
      type: "edit",
      reviewId: pr,
      edit: { type: "insert", content: { type: "markdown", markdown: "Ok." } },
    }),
    undefined,
    { threadId: "thread" },
  );

  expect(await next()).toMatchObject({
    threads: [
      { id: "away" },
      { id: "thread", edited: [{ reviewId: pr, title: "PR" }] },
    ],
  });
  abort.abort();
  await reader.cancel().catch(() => {});
});

it("follows as many threads as a review has open over one watch", async () => {
  const { reviewId } = await store.execute(
    command({
      type: "create",
      title: "Payments",
      target: { kind: "commits", ...pins },
    }),
  );

  const api = createReviewApi(
    store,
    {} as LocalReviewData,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      // No agent starts: none of the threads is running.
      threads: new AskThreads(() => {
        throw new Error("No agent starts here.");
      }),
      agents: async () => [],
    },
  );

  // More than a URL could carry; none is running, so each ends at once.
  const threads = Array.from({ length: 500 }, () => crypto.randomUUID());

  const response = await api.request(`/${reviewId}/ask/watch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threads }),
  });

  expect(response.status).toBe(200);

  const lines = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  expect(lines).toEqual(threads.map((threadId) => ({ threadId, ended: true })));
});

it("deleting a board ends its Ask threads and blocks reopening while saved history stays readable", async () => {
  const { reviewId } = await store.execute(
    command({
      type: "create",
      title: "Payments",
      target: { kind: "commits", ...pins },
    }),
  );

  store.askHistory.save(record(reviewId, "thread", "2026-09-01T10:00:00.000Z"));

  const launch = vi.fn<ConstructorParameters<typeof AskThreads>[0]>(
    async () => {
      throw new Error("Agent unavailable");
    },
  );

  const threads = new AskThreads(launch);

  const thread = threads.open({
    id: "thread",
    reviewId,
    question: { text: "Check this" },
    agent: "claude",
    cwd: "/checkout",
    head: "head",
    selection: { title: "Question" },
    context: "Context",
  });

  const closed = vi.fn<() => void>();
  thread.onClose(closed);

  const api = createReviewApi(
    store,
    {} as LocalReviewData,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { threads, agents: async () => [] },
  );

  const request = (route: string, body = {}) =>
    api.request(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    const response = await request(
      "/commands",
      command({ type: "lifecycle", state: "trash", reviewId }),
    );

    expect(response.status).toBe(200);
    expect(closed).toHaveBeenCalledOnce();
    expect(threads.get("thread")).toBeUndefined();
    const launches = launch.mock.calls.length;
    expect((await request(`/${reviewId}/ask/thread/open`)).status).toBe(409);
    expect(launch).toHaveBeenCalledTimes(launches);
    expect((await api.request(`/${reviewId}/ask/thread`)).status).toBe(200);

    const watch = await request(`/${reviewId}/ask/watch`, {
      threads: ["thread"],
    });

    expect(watch.status).toBe(200);
    expect(await watch.text()).toContain('"ended":true');
    expect(() => threads.sweep(Date.now() + 20 * 60_000)).not.toThrow();
  } finally {
    threads.closeAll();
  }
});

it("marks a thread unread once a turn ends after the reviewer last saw it", async () => {
  const { reviewId } = await store.execute(
    command({
      type: "create",
      title: "Payments",
      target: { kind: "commits", ...pins },
    }),
  );

  const api = createReviewApi(
    store,
    {} as LocalReviewData,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      threads: new AskThreads(async () => {
        throw new Error("No agent in this test.");
      }),
      agents: async () => [],
    },
  );

  const unread = async () => {
    const abort = new AbortController();

    const response = await api.request(`/${reviewId}/ask/threads?watch`, {
      signal: abort.signal,
    });

    const reader = response
      .body!.pipeThrough(new TextDecoderStream())
      .getReader();

    let line = "";

    while (!line.includes("\n")) line += (await reader.read()).value ?? "";
    abort.abort();
    await reader.cancel().catch(() => {});

    return JSON.parse(line).threads.map(
      (thread: { id: string; unread?: boolean }) => [
        thread.id,
        !!thread.unread,
      ],
    );
  };

  store.askHistory.save(record(reviewId, "seen", "2026-09-01T10:00:00.000Z"));
  store.askHistory.save(record(reviewId, "older", "2026-09-01T09:00:00.000Z"));
  store.askHistory.markViewed("seen", "2026-09-01T09:30:00.000Z");

  // A turn ended after it was seen; a thread never tracked is read.
  expect(await unread()).toEqual([
    ["seen", true],
    ["older", false],
  ]);

  const viewed = await api.request(`/${reviewId}/ask/seen/viewed`, {
    method: "POST",
  });

  expect(viewed.status).toBe(200);
  expect(await unread()).toEqual([
    ["seen", false],
    ["older", false],
  ]);
});

it("keeps when a thread was seen through its saves, and seeing it moves nothing", async () => {
  const { reviewId } = await store.execute(
    command({
      type: "create",
      title: "Payments",
      target: { kind: "commits", ...pins },
    }),
  );

  const history = store.askHistory;

  history.save(record(reviewId, "older", "2026-09-01T09:00:00.000Z"));
  history.save(record(reviewId, "newer", "2026-09-01T10:00:00.000Z"));
  history.markViewed("older", "2026-09-01T11:00:00.000Z");

  // Seeing it is not using it: it keeps its place and when it was used.
  expect(history.list(reviewId).map(({ id }) => id)).toEqual([
    "newer",
    "older",
  ]);
  expect(history.get("older")?.updatedAt).toBe("2026-09-01T09:00:00.000Z");

  // The agent's session changes and the thread is saved again.
  history.save({
    ...record(reviewId, "older", "2026-09-01T09:00:00.000Z"),
    sessionId: "another-session",
  });
  expect(history.viewedAt(["older", "newer"])).toEqual(
    new Map([["older", "2026-09-01T11:00:00.000Z"]]),
  );

  history.delete("older");
  expect(history.viewedAt(["older"])).toEqual(new Map());
});
