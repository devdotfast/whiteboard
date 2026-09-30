import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { ReviewApiClient } from "./client";
import { createReviewApi } from "./http";
import { ReviewStore } from "./store";

it("shares one live connection across reviews, reconnects, and isolates a deleted review", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "review-live-tabs-"));

  const store = new ReviewStore(path.join(directory, "review.db"), {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });

  const command = <Operation>(operation: Operation) =>
    store.execute({ commandId: randomUUID(), operation });

  const app = createReviewApi(store);

  const requests: {
    signal: AbortSignal;
    stream: TransformStreamDefaultController<Uint8Array>;
  }[] = [];

  const request = async (url: string, init?: RequestInit) => {
    const response = await app.request(
      url.replace("http://review.test/reviews-api", ""),
      init,
    );

    if (!url.includes("/watch?")) return response;

    return new Response(
      response.body!.pipeThrough(
        new TransformStream({
          start(stream) {
            requests.push({ signal: init!.signal!, stream });
          },
        }),
      ),
      { headers: response.headers, status: response.status },
    );
  };

  // Canvas configs contain per-review fields; those must not split connections.
  const client = (tab: string) =>
    new ReviewApiClient(
      { serverUrl: "http://review.test", token: "token", ...{ tab } },
      request,
    );

  const aborts = Array.from({ length: 3 }, () => new AbortController());
  const following: Promise<void>[] = [];
  const seen = new Map<string, unknown>();
  const errors = new Map<string, string>();

  try {
    const pins = { repositoryId: "repo", base: "base", head: "head" };
    const a = (await command({ type: "create", title: "A", pins })).reviewId;
    const b = (await command({ type: "create", title: "B", pins })).reviewId;

    const follow = (key: string, id: string | null, index: number) => {
      following.push(
        client(key).follow(
          id,
          aborts[index]!.signal,
          (value) => {
            seen.set(key, value);
            errors.delete(key);
          },
          (error) => {
            errors.set(key, String(error));
          },
        ),
      );
    };

    follow("a", a, 0);
    follow("b", b, 1);
    follow("catalog", null, 2);
    await vi.waitFor(() => expect(seen.size).toBe(3));
    expect(requests.filter((item) => !item.signal.aborted)).toHaveLength(1);
    expect(seen.get("a")).toMatchObject({ title: "A", version: 0 });
    expect(seen.get("catalog")).toHaveLength(2);

    await command({ type: "rename", reviewId: a, title: "A updated" });
    await vi.waitFor(() =>
      expect(seen.get("a")).toMatchObject({ title: "A updated", version: 1 }),
    );
    expect(seen.get("b")).toMatchObject({ title: "B", version: 0 });
    const leaseId = randomUUID();
    store.activity.update(b, { action: "begin", leaseId });
    await vi.waitFor(() =>
      expect(seen.get("b")).toMatchObject({ activity: { workingCount: 1 } }),
    );

    requests.at(-1)!.stream.error(new Error("Network interrupted"));
    store.activity.update(b, { action: "end", leaseId });
    await vi.waitFor(() =>
      expect(errors.get("b")).toContain("Network interrupted"),
    );
    await command({
      type: "rename",
      reviewId: b,
      title: "Changed while disconnected",
    });
    await vi.waitFor(
      () =>
        expect(seen.get("b")).toMatchObject({
          title: "Changed while disconnected",
        }),
      { timeout: 3000 },
    );

    await command({ type: "delete", reviewId: a });
    await vi.waitFor(() => expect(errors.get("a")).toBeTruthy());
    await command({ type: "rename", reviewId: b, title: "Still live" });
    await vi.waitFor(() =>
      expect(seen.get("b")).toMatchObject({ title: "Still live" }),
    );
    expect(errors.has("b")).toBe(false);
    aborts[0]!.abort();
    await vi.waitFor(() =>
      expect(requests.filter((item) => !item.signal.aborted)).toHaveLength(1),
    );
  } finally {
    aborts.forEach((abort) => abort.abort());
    await Promise.all(following);
    expect(requests.every((item) => item.signal.aborted)).toBe(true);
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("finishes an in-flight render before another tab replaces the shared stream", async () => {
  const streams: string[] = [];

  const request = async (url: string) => {
    streams.push(url);

    const subscriptions = JSON.parse(
      new URL(url).searchParams.get("subscriptions")!,
    );

    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              subscriptions
                .map(({ reviewId }: { reviewId: string }) =>
                  JSON.stringify({
                    kind: "review",
                    reviewId,
                    value: streams.length,
                  }),
                )
                .join("\n") + "\n",
            ),
          );
        },
      }),
    );
  };

  const client = new ReviewApiClient(
    { serverUrl: "http://review.test", token: "token" },
    request,
  );

  const a = new AbortController(),
    b = new AbortController();

  let release!: () => void;

  const rendering = new Promise<void>((resolve) => {
    release = resolve;
  });

  const rendered: unknown[] = [];
  let started = false;

  const first = client.follow(
    "a",
    a.signal,
    async (value) => {
      started = true;
      await rendering;
      rendered.push(value);
    },
    (error) => {
      throw error;
    },
  );

  let second: Promise<void> | undefined;

  try {
    await vi.waitFor(() => expect(started).toBe(true));
    second = client.follow(
      "b",
      b.signal,
      () => {},
      (error) => {
        throw error;
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(streams).toHaveLength(1);
    release();
    await vi.waitFor(() => expect(rendered).toEqual([1, 2]));
  } finally {
    release();
    a.abort();
    b.abort();
    await Promise.all([first, second]);
  }
});

it("delivers each line only to the listeners it is about", async () => {
  const store = new ReviewStore(":memory:", {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });

  const app = createReviewApi(store);

  const client = new ReviewApiClient(
    { serverUrl: "http://review.test", token: "token" },
    async (url, init) =>
      app.request(url.replace("http://review.test/reviews-api", ""), init),
  );

  const command = <Operation>(operation: Operation) =>
    store.execute({ commandId: randomUUID(), operation });

  const pins = { repositoryId: "repo", base: "base", head: "head" };
  const a = (await command({ type: "create", title: "A", pins })).reviewId;
  const b = (await command({ type: "create", title: "B", pins })).reviewId;
  const abort = new AbortController();

  const seen = {
    a: [] as { reviewId: string; title: string }[],
    b: [] as { reviewId: string; title: string }[],
  };

  const follow = (key: "a" | "b", id: string) =>
    client.follow<{ reviewId: string; title: string }>(
      id,
      abort.signal,
      (value) => {
        seen[key].push(value);
      },
      (error) => {
        throw error;
      },
    );

  const following = [follow("a", a)];

  try {
    await vi.waitFor(() => expect(seen.a).toHaveLength(1));
    following.push(follow("b", b));
    await vi.waitFor(() => expect(seen.b).toHaveLength(1));
    // The second tab replaces the shared stream, which resends A once.
    await vi.waitFor(() => expect(seen.a).toHaveLength(2));
    const delivered = seen.a.length;

    for (const title of ["B1", "B2", "B3"]) {
      await command({ type: "rename", reviewId: b, title });
      await vi.waitFor(() => expect(seen.b.at(-1)?.title).toBe(title));
    }

    expect(seen.a).toHaveLength(delivered);
    await command({ type: "rename", reviewId: a, title: "A1" });
    await vi.waitFor(() => expect(seen.a.at(-1)?.title).toBe("A1"));
    expect(seen.a).toHaveLength(delivered + 1);
    expect(seen.a.every((value) => value.reviewId === a)).toBe(true);
    expect(seen.b.every((value) => value.reviewId === b)).toBe(true);
  } finally {
    abort.abort();
    await Promise.all(following);
    await store.close();
  }
});
