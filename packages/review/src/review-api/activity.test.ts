import { DatabaseSync } from "node:sqlite";

import { afterEach, expect, it, vi } from "vitest";

import { ACTIVITY_TTL_MS, ReviewActivity } from "./activity.js";
import { ReviewApiClient } from "./client.js";
import { createReviewApi } from "./http.js";
import { ReviewStore } from "./store.js";

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

it("keeps one presence per agent, ends only the one named, and expires abandoned ones", () => {
  vi.useFakeTimers();
  const activity = newActivity();
  const notify = vi.fn<Parameters<ReviewActivity["subscribe"]>[0]>();
  activity.subscribe(notify);

  const begin = (reviewId = "review") =>
    activity.update(reviewId, { action: "begin" }).activityId!;

  const a = begin(),
    b = begin();

  expect(activity.read("review").activities).toEqual([
    { activityId: a, slot: 0 },
    { activityId: b, slot: 1 },
  ]);
  vi.advanceTimersByTime(ACTIVITY_TTL_MS / 2);
  activity.update("review", { action: "update", activityId: a });
  expect(
    activity.update("review", { action: "end", activityId: b }).workingCount,
  ).toBe(1);
  expect(
    activity.update("review", { action: "end", activityId: b }).workingCount,
  ).toBe(1);
  // A freed color goes to the next agent.
  expect(activity.read("review").activities?.[0]?.slot).toBe(0);
  expect(begin()).not.toBe(a);
  expect(activity.read("review").activities?.map(({ slot }) => slot)).toEqual([
    0, 1,
  ]);
  vi.advanceTimersByTime(ACTIVITY_TTL_MS);
  expect(activity.read("review")).toEqual({ workingCount: 0, expiresAt: null });
  expect(notify).toHaveBeenLastCalledWith("review");
  expect(() =>
    activity.update("review", { action: "update", activityId: a }),
  ).toThrow(/expired/);
  begin("another");
  expect(activity.read("review").workingCount).toBe(0);
  activity.close();
  expect(vi.getTimerCount()).toBe(0);
});

it("reports working transitions without heartbeats or focus changes", () => {
  vi.useFakeTimers();
  const activity = newActivity();
  const transitions = vi.fn<() => void>();
  activity.subscribeWorking(transitions);

  const first = activity.update("review", { action: "begin" }).activityId!;
  expect(activity.isWorking("review")).toBe(true);
  activity.update("review", { action: "update", activityId: first });
  activity.update("review", {
    action: "update",
    activityId: first,
    focus: { description: "Reading the diff" },
  });

  const second = activity.update("review", { action: "begin" }).activityId!;
  expect(transitions).toHaveBeenCalledTimes(1);
  activity.update("review", { action: "end", activityId: first });
  expect(transitions).toHaveBeenCalledTimes(1);
  activity.update("review", { action: "end", activityId: second });
  expect(activity.isWorking("review")).toBe(false);
  expect(transitions).toHaveBeenCalledTimes(2);
  activity.update("review", { action: "begin" });
  vi.advanceTimersByTime(ACTIVITY_TTL_MS);
  expect(activity.isWorking("review")).toBe(false);
  expect(transitions).toHaveBeenCalledTimes(4);
  activity.close();
});

it("streams activity separately from document versions and closes the stream on deletion", async () => {
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
    store.execute({ operation });

  const { reviewId } = await command({
    type: "create",
    title: "Activity",
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
  });

  const changed = vi.fn<Parameters<ReviewStore["subscribe"]>[0]>();
  store.subscribe(changed);
  const abort = new AbortController();
  const stream = client.watch(reviewId, abort.signal);

  try {
    expect((await stream.next()).value).toMatchObject({
      activity: { workingCount: 0 },
    });

    const input = { focus: { description: "Drafting outline" } };

    const { activityId } = await client.post<{ activityId: string }>(
      `/${reviewId}/activity/begin`,
      input,
    );

    expect((await stream.next()).value).toMatchObject({
      activity: {
        workingCount: 1,
        activities: [{ activityId, slot: 0, focus: input.focus }],
      },
    });
    expect(changed).not.toHaveBeenCalled();
    expect(store.history(reviewId)).toHaveLength(1);
    const reconnect = client.watch(reviewId, abort.signal);
    expect((await reconnect.next()).value).toMatchObject({
      activity: { workingCount: 1, activities: [{ focus: input.focus }] },
    });
    await reconnect.return(undefined);
    await store.execute({ operation: { type: "delete", reviewId } });
    // A reader may already have buffered a pre-deletion snapshot.
    await expect(async () => {
      for await (const _snapshot of stream) {
      }
    }).rejects.toThrow(Error);
    await expect(
      client.post(`/${reviewId}/activity/begin`, input),
    ).rejects.toThrow(/not found/i);
    expect(store.activity.read(reviewId).workingCount).toBe(0);
  } finally {
    abort.abort();
    await store.close();
  }
});

it("keeps each agent's focus until it changes, clears or expires", () => {
  vi.useFakeTimers();
  const activity = newActivity();
  const focus = { description: "Adding evidence", targetId: "section-1" };

  const mine = activity.update("review", {
    action: "begin",
    focus,
  }).activityId!;

  const other = activity.update("review", {
    action: "begin",
    focus: { description: "Grouping files" },
  }).activityId!;

  const focusOf = (activityId: string) =>
    activity
      .read("review")
      .activities?.find((presence) => presence.activityId === activityId)
      ?.focus;

  activity.update("review", { action: "update", activityId: mine });
  expect(focusOf(mine)).toEqual(focus);

  const next = { description: "Drawing save flow", targetId: "section-2" };
  activity.update("review", {
    action: "update",
    activityId: mine,
    focus: next,
  });
  expect(focusOf(mine)).toEqual(next);
  expect(focusOf(other)).toEqual({ description: "Grouping files" });
  activity.update("review", {
    action: "update",
    activityId: mine,
    focus: null,
  });
  expect(focusOf(mine)).toBeUndefined();
  activity.update("review", { action: "update", activityId: mine, focus });
  vi.advanceTimersByTime(ACTIVITY_TTL_MS);
  expect(activity.read("review").activities).toBeUndefined();
  activity.close();
});

it.each([false, true])(
  "streams completion and expiry to the catalog without an open canvas (multiplexed=%s)",
  async (multiplexed) => {
    vi.useFakeTimers();

    const store = new ReviewStore(":memory:", {
      validatePins: async () => {},
      validateSource: async () => {},
      validateResource: async () => {},
    });

    const api = createReviewApi(store);

    const { reviewId } = await store.execute({
      operation: {
        type: "create",
        title: "Background review",
        target: {
          kind: "commits",
          repositoryId: "repo",
          base: "base",
          head: "head",
        },
      },
    });

    const client = new ReviewApiClient(
      { serverUrl: "http://review.test", token: "test" },
      async (url, init) => api.request(url.replace("/reviews-api", ""), init),
    );

    const abort = new AbortController();

    const stream = client.watch(
      multiplexed ? [{ reviewId: null }] : null,
      abort.signal,
    );

    const next = async () => {
      const value = (await stream.next()).value;

      return multiplexed ? (value as { value: unknown }[])[0]!.value : value;
    };

    const expected = (working: boolean) => [
      expect.objectContaining({ reviewId, working }),
    ];

    try {
      expect(await next()).toEqual(expected(false));

      const { activityId } = store.activity.update(reviewId, {
        action: "begin",
      });

      expect(await next()).toEqual(expected(true));
      // One line per transition: no repeat, nothing for renewals or focus.
      store.activity.update(reviewId, {
        action: "update",
        activityId: activityId!,
      });
      store.activity.update(reviewId, {
        action: "update",
        activityId: activityId!,
        focus: { description: "Reading the diff" },
      });
      store.activity.update(reviewId, {
        action: "end",
        activityId: activityId!,
      });
      expect(await next()).toEqual(expected(false));
      store.activity.update(reviewId, { action: "begin" });
      expect(await next()).toEqual(expected(true));
      await vi.advanceTimersByTimeAsync(ACTIVITY_TTL_MS);
      expect(await next()).toEqual(expected(false));
    } finally {
      abort.abort();
      await stream.return(undefined);
      await store.close();
    }
  },
);
