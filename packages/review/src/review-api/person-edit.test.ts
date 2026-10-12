import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { rangeAnchor } from "@review/lens-selection.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { elements } from "./document.js";
import { createReviewApi } from "./http.js";
import {
  FOCUS_LEASE_TTL_MS,
  type ReviewProviders,
  ReviewStore,
} from "./store.js";

let directory: string,
  store: ReviewStore,
  api: ReturnType<typeof createReviewApi>;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "review-person-edit-"));
  vi.stubEnv("DEV_REVIEW_HOME", directory);

  const providers: ReviewProviders = {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  };

  store = new ReviewStore(path.join(directory, "reviews.db"), providers);
  api = createReviewApi(store);
});

afterEach(async () => {
  vi.useRealTimers();
  await store.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

const post = async <Body>(route: string, body?: Body) => {
  const response = await api.request(route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  return { status: response.status, body: await response.json() };
};

const createBoard = async (title = "Plan") => {
  const checkout = path.join(directory, "checkout");

  mkdirSync(checkout, { recursive: true });
  const { id: repositoryId } = store.registerRepository(checkout);

  const { reviewId } = await store.execute({
    operation: {
      type: "create",
      title,
      target: { kind: "project", repositoryId },
    },
  });

  return reviewId;
};

const agentEdit = <Edit>(reviewId: string, edit: Edit) =>
  store.execute({ operation: { type: "edit", reviewId, edit } });

const insert = async <Content>(
  reviewId: string,
  content: Content,
  parentId?: string,
) =>
  (
    await agentEdit(reviewId, {
      type: "insert",
      content,
      ...(parentId && { parentId }),
    })
  ).targetId!;

it("saves a person's board as their own version, giving new blocks ids by clientKey", async () => {
  const reviewId = await createBoard();
  const kept = await insert(reviewId, { type: "markdown", markdown: "Kept." });
  const before = store.read(reviewId);

  const saved = await post(`/${reviewId}/person-edit`, {
    baseVersion: before.version,
    title: "Renamed",
    document: [
      { id: kept, type: "markdown", markdown: "Kept, and changed." },
      {
        type: "section",
        title: "New",
        clientKey: "s",
        children: [{ type: "markdown", markdown: "Inside.", clientKey: "m" }],
      },
    ],
  });

  expect(saved.status).toBe(200);
  expect(saved.body).toMatchObject({ reviewId, version: before.version + 1 });
  const { s, m } = saved.body.ids;

  const after = store.read(reviewId);

  expect(after.title).toBe("Renamed");
  expect(elements(after.document).map(({ id }) => id)).toEqual([kept, s, m]);
  expect(JSON.stringify(after.document)).not.toContain("clientKey");
  expect(after.lastEdit).toBeUndefined();
  expect(after.personEdit?.changed.toSorted()).toEqual([kept, s, m].toSorted());

  // An agent's next version describes only its own edit.
  await insert(reviewId, { type: "markdown", markdown: "Agent." });
  expect(store.read(reviewId).personEdit).toBeUndefined();

  const history = await api.request(`/${reviewId}/history`);

  expect(
    ((await history.json()) as { author: string }[]).map(
      ({ author }) => author,
    ),
  ).toEqual(["agent", "agent", "you", "agent"]);
});

it("refuses a save from a stale version or with a repeated id, and saves nothing for no change", async () => {
  const reviewId = await createBoard();
  const block = await insert(reviewId, { type: "markdown", markdown: "One." });
  const { version, title, document } = store.read(reviewId);

  const stale = await post(`/${reviewId}/person-edit`, {
    baseVersion: version - 1,
    title,
    document: [],
  });

  expect(stale).toEqual({
    status: 409,
    body: {
      error: `The board changed since version ${version - 1}; it is now at version ${version}. Merge the latest version and save again.`,
    },
  });

  const repeated = await post(`/${reviewId}/person-edit`, {
    baseVersion: version,
    title,
    document: [...document, { id: block, type: "markdown", markdown: "Two." }],
  });

  expect(repeated.status).toBe(400);

  expect(
    await post(`/${reviewId}/person-edit`, {
      baseVersion: version,
      title,
      document,
    }),
  ).toEqual({ status: 200, body: { reviewId, version, ids: {} } });
  expect(store.read(reviewId).version).toBe(version);
});

it("refuses an agent's edit to the block a person is editing until the lease ends", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const reviewId = await createBoard();

  const leased = await insert(reviewId, {
    type: "markdown",
    markdown: "Mine.",
  });

  const other = await insert(reviewId, {
    type: "markdown",
    markdown: "Other.",
  });

  const section = await insert(reviewId, {
    type: "section",
    title: "Group",
    children: [],
  });

  const focus = (blockId: string | null) =>
    post(`/${reviewId}/focus`, { clientId: "canvas", blockId });

  expect(await focus(leased)).toEqual({ status: 200, body: { ok: true } });
  const { version } = store.read(reviewId);

  for (const edit of [
    { type: "update", targetId: leased, changes: { markdown: "Theirs." } },
    { type: "remove", targetId: leased },
  ])
    await expect(agentEdit(reviewId, edit)).rejects.toThrow(
      `The user is editing this block (${leased}). Edit another block, or try again after they move on.`,
    );
  expect(store.read(reviewId).version).toBe(version);

  // Other blocks, a move of the leased block, and a leased section's
  // children stay open to agents.
  await agentEdit(reviewId, {
    type: "update",
    targetId: other,
    changes: { markdown: "Fine." },
  });
  await agentEdit(reviewId, { type: "move", targetId: leased, afterId: other });
  await focus(section);
  await insert(reviewId, { type: "markdown", markdown: "Child." }, section);

  // A person's own save is never refused.
  const current = store.read(reviewId);

  await store.personEdit(reviewId, {
    baseVersion: current.version,
    title: current.title,
    document: current.document.filter(({ id }) => id !== section),
  });

  await focus(leased);
  vi.advanceTimersByTime(FOCUS_LEASE_TTL_MS);
  await agentEdit(reviewId, {
    type: "update",
    targetId: leased,
    changes: { markdown: "Later." },
  });

  await focus(leased);
  await focus(null);
  await agentEdit(reviewId, { type: "remove", targetId: leased });
  expect(elements(store.read(reviewId).document).map(({ id }) => id)).toEqual([
    other,
  ]);
});

it("refuses an agent's restore, retarget or move to Trash that would change a block a person is editing", async () => {
  const reviewId = await createBoard();

  const leased = await insert(reviewId, {
    type: "markdown",
    markdown: "Before.",
  });

  await agentEdit(reviewId, {
    type: "update",
    targetId: leased,
    changes: { markdown: "After." },
  });
  await post(`/${reviewId}/focus`, { clientId: "canvas", blockId: leased });

  const { version } = store.read(reviewId);
  const held = `The user is editing this block (${leased}).`;

  await expect(
    store.execute({
      operation: { type: "restore", reviewId, version: version - 1 },
    }),
  ).rejects.toThrow(held);
  await expect(
    store.execute({
      operation: { type: "lifecycle", state: "trash", reviewId },
    }),
  ).rejects.toThrow(held);
  expect(store.read(reviewId).version).toBe(version);

  // A retarget that repins the quote a person holds.
  const { id: repositoryId } = store.registerRepository(
    path.join(directory, "checkout"),
  );

  const pinned = (
    await store.execute({
      operation: {
        type: "create",
        title: "Pinned",
        target: {
          kind: "commits",
          repositoryId,
          base: "a".repeat(40),
          head: "b".repeat(40),
        },
      },
    })
  ).reviewId;

  const quote = await insert(pinned, {
    type: "code_peek",
    source: rangeAnchor({ side: "head", file: "a.ts", fromLine: 1, toLine: 2 }),
  });

  await post(`/${pinned}/focus`, { clientId: "canvas", blockId: quote });
  await expect(
    store.execute({
      operation: {
        type: "set_target",
        reviewId: pinned,
        target: { kind: "project", repositoryId },
      },
    }),
  ).rejects.toThrow(`The user is editing this block (${quote}).`);

  // A person's own restore or delete goes ahead.
  await store.execute(
    { operation: { type: "restore", reviewId, version: version - 1 } },
    undefined,
    { person: true },
  );
  expect(store.read(reviewId).version).toBe(version + 1);
});

it("doesn't credit a person's save to the thread whose change came before it", async () => {
  const reviewId = await createBoard();

  await store.execute(
    { operation: { type: "rename", reviewId, title: "The thread's" } },
    undefined,
    { threadId: "thread" },
  );
  expect(store.read(reviewId).threadId).toBe("thread");

  const current = store.read(reviewId);

  await store.personEdit(reviewId, {
    baseVersion: current.version,
    title: "Mine now",
    document: current.document,
  });

  expect(store.read(reviewId).threadId).toBeUndefined();
});

it("lists a board whose repository is gone without naming its internal id", async () => {
  const reviewId = await createBoard();
  const db = new DatabaseSync(path.join(directory, "reviews.db"));

  db.exec("DELETE FROM repositories;");
  db.close();

  expect(
    store.list().find((board) => board.reviewId === reviewId)?.repositoryName,
  ).toBe("(unknown repository)");
});

it("discards only an untouched Untitled board", async () => {
  const empty = await createBoard("Untitled");

  expect(store.read(empty).document).toEqual([]);
  expect(await post(`/${empty}/discard`)).toEqual({
    status: 200,
    body: { deleted: true },
  });
  expect(store.has(empty)).toBe(false);

  const written = await createBoard("Untitled");

  await insert(written, { type: "markdown", markdown: "Kept." });

  const named = await createBoard("Named");

  const parent = await createBoard("Untitled");
  const child = await createBoard("Child");

  await store.execute({
    operation: { type: "set_parent", reviewId: child, parentId: parent },
  });

  for (const id of [written, named, parent]) {
    expect(await store.discard(id)).toEqual({ deleted: false });
    expect(store.has(id)).toBe(true);
  }
});

it("keeps an id ⌘Z brought back, and gives an agent's next insert a fresh one", async () => {
  const reviewId = await createBoard();
  const block = await insert(reviewId, { type: "markdown", markdown: "Gone." });
  const { version, title } = store.read(reviewId);

  await post(`/${reviewId}/person-edit`, {
    baseVersion: version,
    title,
    document: [],
  });

  const restored = await post(`/${reviewId}/person-edit`, {
    baseVersion: version + 1,
    title,
    // A canvas bug's id above the board's counter moves the counter too.
    document: [
      { id: block, type: "markdown", markdown: "Gone." },
      { id: "block-90", type: "markdown", markdown: "Far ahead." },
    ],
  });

  expect(restored.status).toBe(200);

  const fresh = await insert(reviewId, {
    type: "markdown",
    markdown: "Agent.",
  });

  expect(fresh).not.toBe(block);
  expect(Number(fresh.split("-")[1])).toBeGreaterThan(90);
});

it("saves a ⌘Z that brings back a link to a board deleted since", async () => {
  const reviewId = await createBoard();
  const other = await createBoard("Other");
  const linked = `[the other board](whiteboard:board/${other})`;
  const block = await insert(reviewId, { type: "markdown", markdown: linked });
  const { title } = store.read(reviewId);

  await post(`/${reviewId}/person-edit`, {
    baseVersion: store.read(reviewId).version,
    title,
    document: [],
  });
  await store.execute({
    operation: { type: "lifecycle", state: "trash", reviewId: other },
  });
  await store.execute({ operation: { type: "delete", reviewId: other } });

  const restored = await post(`/${reviewId}/person-edit`, {
    baseVersion: store.read(reviewId).version,
    title,
    document: [{ id: block, type: "markdown", markdown: linked }],
  });

  expect(restored.status).toBe(200);

  // A board that never existed is still refused.
  const invented = await post(`/${reviewId}/person-edit`, {
    baseVersion: store.read(reviewId).version,
    title,
    document: [{ type: "markdown", markdown: "[x](whiteboard:board/nope)" }],
  });

  expect(invented.status).toBe(400);
});

it("waits for a closing canvas to let go before discarding, and keeps a board still open", async () => {
  const reviewId = await createBoard("Untitled");

  await post(`/${reviewId}/focus`, { clientId: "a", blockId: null });
  const discarding = post(`/${reviewId}/discard`);

  // The canvas saves what was typed, then closes the board.
  await post(`/${reviewId}/person-edit`, {
    baseVersion: 0,
    title: "Untitled",
    document: [{ type: "markdown", markdown: "Typed.", clientKey: "k" }],
  });
  await post(`/${reviewId}/focus`, {
    clientId: "a",
    blockId: null,
    open: false,
  });

  expect((await discarding).body).toEqual({ deleted: false });
  expect(store.has(reviewId)).toBe(true);
});

it("credits a person's new board, rename and restore to them", async () => {
  const checkout = path.join(directory, "checkout");

  mkdirSync(checkout, { recursive: true });
  store.registerRepository(checkout);
  const person = { "content-type": "application/json", "x-review-person": "1" };

  const command = async <Operation>(operation: Operation) =>
    (
      await api.request("/commands", {
        method: "POST",
        headers: person,
        body: JSON.stringify({ operation }),
      })
    ).json() as Promise<{ reviewId: string }>;

  const { reviewId } = await command({
    type: "create",
    title: "Untitled",
    target: { kind: "project", repositoryPath: checkout },
    open: false,
  });

  await command({ type: "rename", reviewId, title: "Named" });
  await command({ type: "restore", reviewId, version: 0 });
  await store.execute({
    operation: { type: "rename", reviewId, title: "By an agent" },
  });

  const history = (await (
    await api.request(`/${reviewId}/history`)
  ).json()) as {
    author: string;
  }[];

  expect(history.map(({ author }) => author)).toEqual([
    "you",
    "you",
    "you",
    "agent",
  ]);
});
