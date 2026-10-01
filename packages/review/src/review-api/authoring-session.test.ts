import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ACTIVITY_TTL_MS } from "./activity.js";
import { type AuthoringTool, callAuthoringTool } from "./agent-client.js";
import { ReviewApiClient } from "./client.js";
import { createReviewApi } from "./http.js";
import { type ReviewProviders, ReviewStore } from "./store.js";

const pins = { repositoryId: "repo", base: "base", head: "head" };

const command = <Operation>(operation: Operation) => ({ operation });

let directory: string,
  database: string,
  a: ReviewStore,
  b: ReviewStore,
  reviewId: string;

let providers: ReviewProviders;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "review-session-"));
  database = path.join(directory, "reviews.db");
  providers = {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  };
  a = new ReviewStore(database, providers);
  b = new ReviewStore(database, providers);
  ({ reviewId } = await a.execute(
    command({ type: "create", title: "Initial", pins }),
  ));
});

afterEach(async () => {
  vi.useRealTimers();
  await a.close();
  await b.close();
  await rm(directory, { recursive: true, force: true });
});

it("credits each edit to the agent that made it, renewing only that agent, and never refuses a write", async () => {
  vi.useFakeTimers();

  const begin = (description: string) =>
    a.activity.update(reviewId, {
      action: "begin",
      focus: { description },
    }).activityId!;

  const first = begin("Writing the summary"),
    second = begin("Grouping files");

  const present = () =>
    b.activity.read(reviewId).activities?.map(({ activityId }) => activityId);

  expect(b.activity.read(reviewId).activities?.map(({ slot }) => slot)).toEqual(
    [0, 1],
  );

  const insert = (markdown: string, activityId?: string) =>
    command({
      type: "edit",
      reviewId,
      edit: { type: "insert", content: { type: "markdown", markdown } },
      activityId,
    });

  vi.advanceTimersByTime(ACTIVITY_TTL_MS / 2);
  await b.execute(insert("One", first));
  expect(a.read(reviewId).lastEdit?.activityId).toBe(first);
  expect(
    b.activity.read(reviewId).activities?.find((p) => p.activityId === first)
      ?.surface,
  ).toBe("document");

  // Another agent's presence never blocks a write, named or not.
  await b.execute(command({ type: "rename", reviewId, title: "Anyone" }));
  await b.execute(insert("Two"));
  // With two agents present, an unnamed edit is no one's.
  expect(a.read(reviewId).lastEdit?.activityId).toBeUndefined();

  // A rejected edit credits and renews nothing.
  await expect(
    b.execute(
      command({
        type: "edit",
        reviewId,
        edit: { type: "remove", targetId: "gone" },
        activityId: second,
      }),
    ),
  ).rejects.toMatchObject({ status: 400 });

  // Only the accepted edit renewed its agent.
  vi.advanceTimersByTime(ACTIVITY_TTL_MS / 2);
  expect(present()).toEqual([first]);

  // With one agent left, an unnamed edit is its.
  await b.execute(insert("Three"));
  expect(a.read(reviewId).lastEdit?.activityId).toBe(first);

  // Once it expires, an edit naming it still applies and is no one's.
  vi.advanceTimersByTime(ACTIVITY_TTL_MS);
  await b.execute(insert("Four", first));
  expect(a.read(reviewId).lastEdit?.activityId).toBeUndefined();
  expect(b.activity.read(reviewId).workingCount).toBe(0);
});

it("rejects a stale one-off edit when another connection commits during validation", async () => {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();

  providers.validateSource = async () => {
    entered.resolve();
    await release.promise;
  };

  const pending = a.execute(
    command({
      type: "edit",
      reviewId,
      edit: {
        type: "insert",
        content: {
          type: "code_peek",
          source: "head/a.ts#L1",
        },
      },
    }),
  );

  const rejected = pending.catch((error: Error) => error);
  await entered.promise;
  await b.execute(
    command({ type: "rename", reviewId, title: "Committed first" }),
  );
  release.resolve();
  expect(await rejected).toMatchObject({ status: 409 });
  expect(a.read(reviewId)).toMatchObject({
    title: "Committed first",
    version: 1,
    document: [],
  });
});
