import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { afterEach, expect, it, vi } from "vitest";
import type { z } from "zod";

import {
  ACTIVITY_TTL_MS,
  ReviewActivity,
  type activitySchema,
} from "./activity.js";
import { ReviewApiClient } from "./client.js";
import { createReviewApi } from "./http.js";
import { ReviewStore } from "./store.js";

type ActivityInput = z.input<typeof activitySchema>;

/** Omit per action: the input is a union over begin, renew and end. */
type WithoutLease = ActivityInput extends infer Input
  ? Input extends unknown
    ? Omit<Input, "leaseId">
    : never
  : never;

const databases: DatabaseSync[] = [];

const newActivity = () => {
  const db = new DatabaseSync(":memory:");
  databases.push(db);

  return new ReviewActivity(db);
};

afterEach(() => {
  vi.useRealTimers();

  for (const db of databases.splice(0)) db.close();
});

it("renews reported work, expires abandoned work, and does not end another author's activity", () => {
  vi.useFakeTimers();
  const activity = newActivity();
  const notify = vi.fn<Parameters<ReviewActivity["subscribe"]>[0]>();
  activity.subscribe(notify);

  const a = randomUUID(),
    b = randomUUID();

  const update = (leaseId: string, action: "begin" | "renew" | "end") =>
    activity.update("review", { leaseId, action });

  expect(update(a, "begin").workingCount).toBe(1);
  expect(update(a, "begin").workingCount).toBe(1);
  vi.advanceTimersByTime(ACTIVITY_TTL_MS / 2);
  update(a, "renew");
  expect(() => update(b, "begin")).toThrow(/another session/);
  expect(update(b, "end").workingCount).toBe(1);
  vi.advanceTimersByTime(ACTIVITY_TTL_MS / 2);
  expect(activity.read("review").workingCount).toBe(1);
  expect(update(a, "end").workingCount).toBe(0);
  expect(update(a, "end").workingCount).toBe(0);
  update(b, "begin");
  vi.advanceTimersByTime(ACTIVITY_TTL_MS);
  expect(activity.read("review")).toEqual({ workingCount: 0, expiresAt: null });
  expect(notify).toHaveBeenLastCalledWith("review");
  expect(() => update(b, "renew")).toThrow(/expired/);
  activity.update("another", { leaseId: randomUUID(), action: "begin" });
  expect(activity.read("review").workingCount).toBe(0);
  activity.close();
  expect(vi.getTimerCount()).toBe(0);
});

it("reports working transitions without heartbeats or focus changes", () => {
  vi.useFakeTimers();
  const activity = newActivity();
  const transitions = vi.fn<() => void>();
  activity.subscribeWorking(transitions);
  const leaseId = randomUUID();

  const update = (value: WithoutLease) =>
    activity.update("review", { leaseId, ...value });

  update({ action: "begin" });
  expect(activity.isWorking("review")).toBe(true);
  update({ action: "renew" });
  update({ action: "renew", focus: { description: "Reading the diff" } });
  update({ action: "begin", scope: "lenses" });
  expect(transitions).toHaveBeenCalledTimes(1);
  update({ action: "end" });
  expect(transitions).toHaveBeenCalledTimes(1);
  update({ action: "end", scope: "lenses" });
  expect(activity.isWorking("review")).toBe(false);
  expect(transitions).toHaveBeenCalledTimes(2);
  update({ action: "begin" });
  vi.advanceTimersByTime(ACTIVITY_TTL_MS);
  expect(activity.isWorking("review")).toBe(false);
  expect(transitions).toHaveBeenCalledTimes(4);
  activity.close();
});

it("streams activity separately from document versions and reports deletion on the stream", async () => {
  const store = new ReviewStore(":memory:", {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });

  const api = createReviewApi(store);

  const client = new ReviewApiClient(
    { serverUrl: "http://review.test", token: "test" },
    async (url, init) => api.request(url.replace("/reviews-api", ""), init),
  );

  const command = <Operation>(operation: Operation) =>
    store.execute({ commandId: randomUUID(), operation });

  const { reviewId } = await command({
    type: "create",
    title: "Activity",
    pins: { repositoryId: "repo", base: "base", head: "head" },
  });

  const changed = vi.fn<Parameters<ReviewStore["subscribe"]>[0]>();
  store.subscribe(changed);
  const abort = new AbortController();
  const stream = client.watch([{ reviewId }], abort.signal);

  try {
    expect((await stream.next()).value).toMatchObject({
      value: { activity: { workingCount: 0 } },
    });

    const input = {
      leaseId: randomUUID(),
      focus: { description: "Drafting outline" },
    };

    await client.post(`/${reviewId}/activity/begin`, input);
    expect((await stream.next()).value).toMatchObject({
      value: { activity: { workingCount: 1, focuses: [input.focus] } },
    });
    expect(changed).not.toHaveBeenCalled();
    expect(store.history(reviewId)).toHaveLength(1);
    const reconnect = client.watch([{ reviewId }], abort.signal);
    expect((await reconnect.next()).value).toMatchObject({
      value: { activity: { workingCount: 1, focuses: [input.focus] } },
    });
    await reconnect.return(undefined);
    await store.execute({
      commandId: randomUUID(),
      leaseId: input.leaseId,
      operation: { type: "delete", reviewId },
    });
    expect((await stream.next()).value).toEqual({
      kind: "review",
      reviewId,
      error: expect.stringMatching(/not found/i),
    });
    await expect(
      client.post(`/${reviewId}/activity/begin`, input),
    ).rejects.toThrow(/not found/i);
    expect(store.activity.read(reviewId).workingCount).toBe(0);
  } finally {
    abort.abort();
    await stream.return(undefined);
    await store.close();
  }
});

it("retains, changes and clears the owner's focus until its lease expires", () => {
  vi.useFakeTimers();
  const activity = newActivity();
  const leaseId = randomUUID();
  const other = randomUUID();
  const focus = { description: "Adding evidence", targetId: "section-1" };
  activity.update("review", { action: "begin", leaseId, focus });
  expect(
    activity.update("review", { action: "renew", leaseId }).focuses,
  ).toEqual([focus]);
  expect(() =>
    activity.update("review", {
      action: "begin",
      leaseId: other,
      focus: { description: "Drafting summary" },
    }),
  ).toThrow(/another session/);
  const next = { description: "Drawing save flow", targetId: "section-2" };
  expect(
    activity.update("review", { action: "renew", leaseId, focus: next })
      .focuses,
  ).toEqual([next]);
  expect(
    activity.update("review", { action: "renew", leaseId, focus: null })
      .focuses,
  ).toBeUndefined();
  activity.update("review", { action: "end", leaseId: other });
  expect(activity.read("review").focuses).toBeUndefined();
  activity.update("review", { action: "renew", leaseId, focus });
  vi.advanceTimersByTime(ACTIVITY_TTL_MS);
  expect(activity.read("review").focuses).toBeUndefined();
  activity.close();
});

it("streams completion and expiry to the catalog without an open canvas", async () => {
  vi.useFakeTimers();

  const store = new ReviewStore(":memory:", {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });

  const api = createReviewApi(store);

  const { reviewId } = await store.execute({
    commandId: randomUUID(),
    operation: {
      type: "create",
      title: "Background review",
      pins: { repositoryId: "repo", base: "base", head: "head" },
    },
  });

  const client = new ReviewApiClient(
    { serverUrl: "http://review.test", token: "test" },
    async (url, init) => api.request(url.replace("/reviews-api", ""), init),
  );

  const abort = new AbortController();

  const stream = client.watch([{ reviewId: null }], abort.signal);

  const next = async () => {
    const line = (await stream.next()).value;

    return line?.kind === "list" ? line.reviews : line;
  };

  const expected = (working: boolean) => [
    expect.objectContaining({ reviewId, working }),
  ];

  const leaseId = randomUUID();

  try {
    expect(await next()).toEqual(expected(false));
    store.activity.update(reviewId, { action: "begin", leaseId });
    expect(await next()).toEqual(expected(true));
    // One line per transition: no repeat, nothing for renewals or focus.
    store.activity.update(reviewId, { action: "renew", leaseId });
    store.activity.update(reviewId, {
      action: "renew",
      leaseId,
      focus: { description: "Reading the diff" },
    });
    store.activity.update(reviewId, { action: "end", leaseId });
    expect(await next()).toEqual(expected(false));
    store.activity.update(reviewId, { action: "begin", leaseId });
    expect(await next()).toEqual(expected(true));
    await vi.advanceTimersByTimeAsync(ACTIVITY_TTL_MS);
    expect(await next()).toEqual(expected(false));
  } finally {
    abort.abort();
    await stream.return(undefined);
    await store.close();
  }
});
