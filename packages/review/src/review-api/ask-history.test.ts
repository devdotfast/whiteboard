import { DatabaseSync } from "node:sqlite";

import { AskThreads } from "@review/ask/threads.js";
import { AskHistory, type AskRecord } from "@review/review-api/ask-history.js";
import { createReviewApi } from "@review/review-api/http.js";
import type { LocalReviewData } from "@review/review-api/local-data.js";
import { ReviewStore } from "@review/review-api/store.js";
import { afterEach, beforeEach, expect, it } from "vitest";

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

const record = (
  reviewId: string,
  id: string,
  updatedAt: string,
): AskRecord => ({
  id,
  reviewId,
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
  bypass: false,
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
  expect(history.get("older")).toEqual(
    record(reviewId, "older", "2026-09-01T12:30:00.000Z"),
  );

  history.delete("newer");
  expect(history.get("newer")).toBeUndefined();

  await store.execute(command({ type: "delete", reviewId }));
  expect(history.list(reviewId)).toEqual([]);
  expect(history.list("shared-review").map(({ id }) => id)).toEqual(["shared"]);
});

it("keeps what the panel showed, and what each agent offered", () => {
  const db = new DatabaseSync(":memory:");

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
    undefined,
    { threads: {} as AskThreads, agents: async () => [] },
  );

  const response = await api.request(`/${reviewId}/ask/thread`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ entries });

  expect((await api.request(`/another-review/ask/thread`)).status).toBe(404);
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
