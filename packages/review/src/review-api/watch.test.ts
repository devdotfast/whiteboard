import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { type IncomingMessage, createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ReviewStreamLine } from "@dev.fast/review-protocol";
import { getRequestListener } from "@hono/node-server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createReviewApi } from "./http.js";
import { LocalReviewData } from "./local-data.js";
import { ReviewStore, SCRATCHPAD_ID } from "./store.js";

const pins = { repositoryId: "repo", base: "base", head: "head" };

let directory: string, store: ReviewStore;

const cleanup: (() => void | Promise<void>)[] = [];

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "review-watch-"));
  store = new ReviewStore(path.join(directory, "review.db"), {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });
});

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
  await store.close();
  rmSync(directory, { recursive: true, force: true });
});

const command = <Operation>(operation: Operation) =>
  store.execute({ commandId: randomUUID(), operation });

const create = async (title: string) =>
  (await command({ type: "create", title, pins })).reviewId;

const rename = (reviewId: string, title: string) =>
  command({ type: "rename", reviewId, title });

/** A real HTTP reader of the stream, so a paused reader applies real backpressure. */
async function open(
  subscriptions: { reviewId: string | null; mode?: string }[],
  data?: LocalReviewData,
) {
  const app = createReviewApi(store, data);
  const server = createServer(getRequestListener(app.fetch));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const response = await new Promise<IncomingMessage>((resolve, reject) =>
    get(
      `http://127.0.0.1:${port}/watch?subscriptions=${encodeURIComponent(JSON.stringify(subscriptions))}`,
      resolve,
    ).on("error", reject),
  );

  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        response.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  expect(response.statusCode).toBe(200);
  response.setEncoding("utf8");
  const lines: ReviewStreamLine[] = [];
  let pending = "";
  response.on("data", (chunk: string) => {
    pending += chunk;
    let end: number;

    while ((end = pending.indexOf("\n")) !== -1) {
      lines.push(JSON.parse(pending.slice(0, end)));
      pending = pending.slice(end + 1);
    }
  });

  /** Waits for `count` more lines and returns them. */
  const take = async (count: number) => {
    await vi.waitFor(() => expect(lines.length).toBeGreaterThanOrEqual(count));

    return lines.splice(0, count);
  };

  return { response, lines, take };
}

const label = (line: ReviewStreamLine) =>
  line.kind === "list"
    ? `list:${line.mode}`
    : `review:${line.reviewId}:${"error" in line ? "error" : "value"}`;

it("sends one line per subscribed item on connect, however often it is subscribed", async () => {
  const a = await create("A");
  const b = await create("B");

  const stream = await open([
    { reviewId: a },
    { reviewId: null, mode: "structural" },
    { reviewId: b, mode: "textual" },
    { reviewId: a, mode: "textual" },
    { reviewId: null },
  ]);

  const first = await stream.take(3);
  expect(first.map(label).sort()).toEqual(
    ["list:structural", `review:${a}:value`, `review:${b}:value`].sort(),
  );
  expect(first.find((line) => line.kind === "list")).toMatchObject({
    reviews: expect.arrayContaining(
      ["A", "B"].map((title) => expect.objectContaining({ title })),
    ),
  });
  expect(
    first.find((line) => line.kind === "review" && line.reviewId === a),
  ).toMatchObject({
    value: { reviewId: a, title: "A", activity: { workingCount: 0 } },
  });

  // The next change arrives next: nothing else was queued behind the first lines.
  store.activity.update(b, { action: "begin", leaseId: randomUUID() });
  expect((await stream.take(2)).map(label)).toEqual([
    "list:structural",
    `review:${b}:value`,
  ]);
});

it("sends a list line only for what changed in the list", async () => {
  const a = await create("A");
  const b = await create("B");
  const data = new LocalReviewData(store);
  cleanup.push(() => data.close());
  vi.spyOn(data, "resolveSource").mockImplementation(async (snapshot) => ({
    snapshot,
    pins: snapshot.pins!,
  }));
  vi.spyOn(data, "changes").mockImplementation((async (
    _pins: typeof pins,
    file?: string,
  ) => (file ? "" : [])) as typeof data.changes);

  const stream = await open(
    [{ reviewId: null }, { reviewId: a }, { reviewId: b }],
    data,
  );

  await stream.take(3);

  // Starting work changes the list's working flag.
  store.activity.update(a, { action: "begin", leaseId: randomUUID() });
  expect((await stream.take(2)).map(label)).toEqual([
    "list:structural",
    `review:${a}:value`,
  ]);

  // A coverage tick reaches every review; the textual counts it stores are
  // not in this structural list, and a catalog notice alone changes nothing.
  await data.coverage(a, pins, "textual");
  expect((await stream.take(2)).map(label).sort()).toEqual(
    [`review:${a}:value`, `review:${b}:value`].sort(),
  );
  store.invalidateCatalog();

  // An edit changes the entry's version, so it sends the list too.
  await command({
    type: "edit",
    reviewId: b,
    edit: { type: "insert", content: { type: "markdown", markdown: "Hi" } },
  });
  expect((await stream.take(2)).map(label).sort()).toEqual(
    ["list:structural", `review:${b}:value`].sort(),
  );

  await rename(b, "B renamed");
  const renamed = await stream.take(2);
  expect(renamed.map(label).sort()).toEqual(
    ["list:structural", `review:${b}:value`].sort(),
  );
  expect(renamed.find((line) => line.kind === "list")).toMatchObject({
    reviews: expect.arrayContaining([
      expect.objectContaining({ title: "B renamed" }),
    ]),
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(stream.lines).toEqual([]);
});

it("reports a missing or deleted review as an error line and keeps the stream open", async () => {
  const a = await create("A");
  const b = await create("B");

  const stream = await open([
    { reviewId: a },
    { reviewId: b },
    { reviewId: SCRATCHPAD_ID },
  ]);

  const first = await stream.take(3);
  expect(first.map(label).sort()).toEqual(
    [
      `review:${a}:value`,
      `review:${b}:value`,
      `review:${SCRATCHPAD_ID}:error`,
    ].sort(),
  );
  expect(
    first.find(
      (line) => line.kind === "review" && line.reviewId === SCRATCHPAD_ID,
    ),
  ).toMatchObject({ error: expect.stringMatching(/not found/i) });

  await command({ type: "delete", reviewId: a });
  expect(await stream.take(1)).toEqual([
    { kind: "review", reviewId: a, error: expect.stringMatching(/not found/i) },
  ]);

  await rename(b, "B still live");
  expect(await stream.take(1)).toMatchObject([
    { kind: "review", reviewId: b, value: { title: "B still live" } },
  ]);

  // A review that appears later starts sending its state.
  await store.ensureScratchpad();
  expect(await stream.take(1)).toMatchObject([
    {
      kind: "review",
      reviewId: SCRATCHPAD_ID,
      value: { reviewId: SCRATCHPAD_ID, kind: "scratchpad" },
    },
  ]);
});

it("gives a reader that stops reading the latest state once, not a backlog", async () => {
  const a = await create("A");
  // Large lines fill the socket buffers after a few updates.
  await command({
    type: "edit",
    reviewId: a,
    edit: {
      type: "insert",
      content: { type: "markdown", markdown: "x".repeat(1024 * 1024) },
    },
  });

  const stream = await open([{ reviewId: a }]);
  await stream.take(1);
  stream.response.pause();
  const leaseId = randomUUID();
  const updates = 40;

  // Activity updates are cheap to make, and each one resends the whole review.
  for (let index = 1; index <= updates; index++) {
    store.activity.update(a, {
      action: index === 1 ? "begin" : "renew",
      leaseId,
      focus: { description: `Step ${index}` },
    });
    // Let the server try to send each update on its own.
    await new Promise((resolve) => setImmediate(resolve));
  }

  stream.response.resume();
  const steps: string[] = [];

  await vi.waitFor(
    () => {
      for (const line of stream.lines.splice(0))
        if (line.kind === "review" && "value" in line)
          steps.push(
            (line.value.activity as { focuses?: { description: string }[] })
              .focuses?.[0]?.description ?? "",
          );
      expect(steps.at(-1)).toBe(`Step ${updates}`);
    },
    { timeout: 10_000 },
  );
  expect(steps.filter((step) => step === `Step ${updates}`)).toHaveLength(1);
  expect(steps.length).toBeLessThan(updates / 2);
});
