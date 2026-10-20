import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { rangeAnchor } from "@review/lens-selection.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReviewApiClient } from "./client.js";
import { ReviewInputError } from "./document.js";
import { createReviewApi } from "./http.js";
import { type Author, ReviewStore } from "./store.js";

// The rules every board write keeps, whichever writer sends it: stated at
// the store's interface, for every kind of change.

let directory: string, store: ReviewStore;

/** Commits the board's repository has, by prefix. */
const commits = new Set(["a".repeat(40), "b".repeat(40), "c".repeat(40)]);

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "board-writes-"));
  store = new ReviewStore(path.join(directory, "reviews.db"), {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
    resolveCommit: async (_repository, commit) =>
      [...commits].find((full) => full.startsWith(commit)),
  });
});

afterEach(async () => {
  await store.close();
  rmSync(directory, { recursive: true, force: true });
});

const agent: Author = { kind: "agent" };

const person: Author = { kind: "person" };

const checkout = (name: string) => {
  const root = path.join(directory, name);

  mkdirSync(root, { recursive: true });

  return store.registerRepository(root).id;
};

const clone = (name: string, origin: string) => {
  const root = path.join(directory, name);

  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "remote", "add", "origin", origin]);

  return store.registerRepository(root).id;
};

const create = async (repositoryId: string, title = "Plan") =>
  (
    await store.execute({
      operation: {
        type: "create",
        title,
        target: {
          kind: "commits",
          repositoryId,
          base: "a".repeat(40),
          head: "b".repeat(40),
        },
      },
    })
  ).reviewId;

const run = <Operation>(operation: Operation, author: Author = agent) =>
  store.execute({ operation }, undefined, author);

/** A person moves a board to Trash, then deletes it from there. */
const trashThenDelete = async (reviewId: string) => {
  await run({ type: "lifecycle", state: "trash", reviewId }, person);
  await run({ type: "delete", reviewId }, person);
};

const insert = async <Content>(reviewId: string, content: Content) =>
  (await run({ type: "edit", reviewId, edit: { type: "insert", content } }))
    .targetId!;

const hold = (reviewId: string, blockId: string) =>
  store.focus(reviewId, { clientId: "canvas", blockId });

/** A board with a held quote, an earlier version where it read differently,
 * and every kind of change an author could send it. */
async function heldBoard() {
  const app = checkout("app");
  const reviewId = await create(app);

  const quote = await insert(reviewId, {
    type: "code_peek",
    source: rangeAnchor({ side: "head", file: "a.ts", fromLine: 1, toLine: 2 }),
  });

  const earlier = store.read(reviewId).version;

  await run({
    type: "edit",
    reviewId,
    edit: {
      type: "update",
      targetId: quote,
      changes: {
        source: rangeAnchor({
          side: "head",
          file: "a.ts",
          fromLine: 3,
          toLine: 4,
        }),
      },
    },
  });
  hold(reviewId, quote);

  const touching = {
    edit: { type: "edit", reviewId, edit: { type: "remove", targetId: quote } },
    restore: { type: "restore", reviewId, version: earlier },
    // Losing its pins repins the quote.
    set_target: {
      type: "set_target",
      reviewId,
      target: { kind: "project", repositoryId: app },
    },
    // Trash makes the board read-only, so it touches every block.
    trash: { type: "lifecycle", state: "trash", reviewId },
  };

  const untouching = {
    rename: { type: "rename", reviewId, title: "Renamed" },
    edit: {
      type: "edit",
      reviewId,
      edit: {
        type: "insert",
        content: { type: "markdown", markdown: "More." },
      },
    },
    attention: { type: "attention", reviewId, action: "view" },
  };

  return { reviewId, quote, touching, untouching };
}

describe("a held block", () => {
  it("refuses an agent's change that touches it, whatever the kind", async () => {
    const { reviewId, quote, touching } = await heldBoard();
    const { version } = store.read(reviewId);

    for (const operation of Object.values(touching))
      await expect(run(operation)).rejects.toThrow(
        `The user is editing this block (${quote}).`,
      );

    expect(store.read(reviewId).version).toBe(version);
  });

  it("leaves an agent's change elsewhere on the board alone", async () => {
    const { untouching } = await heldBoard();

    for (const operation of Object.values(untouching))
      await expect(run(operation)).resolves.toBeDefined();
  });

  it("refuses an agent's delete from Trash while a person still holds a block", async () => {
    const { reviewId, quote } = await heldBoard();

    await run({ type: "lifecycle", state: "trash", reviewId }, person);
    await expect(run({ type: "delete", reviewId })).rejects.toThrow(
      `The user is editing this block (${quote}).`,
    );
    expect(store.has(reviewId)).toBe(true);

    await run({ type: "delete", reviewId }, person);
    expect(store.has(reviewId)).toBe(false);
  });

  it("never refuses a person", async () => {
    const { reviewId, touching } = await heldBoard();

    for (const kind of ["edit", "restore", "set_target", "trash"] as const)
      await run(touching[kind], person);

    await run({ type: "delete", reviewId }, person);
    expect(store.has(reviewId)).toBe(false);
  });
});

describe("attribution", () => {
  it("names a thread on its version and never on a person's", async () => {
    const app = checkout("app");
    const reviewId = await create(app);

    await store.askHistory.save({
      id: "thread",
      anchor: { board: reviewId },
      projectId: store.projectOf(reviewId),
      agent: "claude",
      sessionId: "session",
      version: 0,
      head: "7fd03b8",
      cwd: directory,
      title: "Question",
      selection: { title: "Line", target: { kind: "text", quote: "Q." } },
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      permissions: "read-only",
    });

    await run(
      { type: "rename", reviewId, title: "The thread's" },
      { kind: "agent", threadId: "thread" },
    );
    expect(store.read(reviewId).threadId).toBe("thread");

    await run({ type: "rename", reviewId, title: "Mine" }, person);
    expect(store.read(reviewId).threadId).toBeUndefined();

    await run(
      { type: "rename", reviewId, title: "The thread's again" },
      { kind: "agent", threadId: "thread" },
    );

    const current = store.read(reviewId);

    await store.personEdit(reviewId, {
      baseVersion: current.version,
      title: "Mine again",
      document: current.document,
    });
    expect(store.read(reviewId).threadId).toBeUndefined();
  });
});

describe("a board's project", () => {
  it("changes only with its repository, never to the board opened last", async () => {
    const gone = checkout("gone");
    const parent = await create(gone, "Parent");
    const child = await create(gone, "Child");

    await run({ type: "set_parent", reviewId: child, parentId: parent });
    const project = store.projectOf(child);

    const away = await create(checkout("away"), "Away");

    await run({ type: "attention", reviewId: away, action: "view" });

    // The checkout's registration is lost, as an old store can lose it.
    const db = new DatabaseSync(path.join(directory, "reviews.db"));

    db.prepare("DELETE FROM repositories WHERE id=?").run(gone);
    db.close();

    await run({ type: "rename", reviewId: child, title: "Renamed" });
    await insert(child, { type: "markdown", markdown: "More." });

    const current = store.read(child);

    await store.personEdit(child, {
      baseVersion: current.version,
      title: "Mine",
      document: current.document,
    });

    expect(store.projectOf(child)).toBe(project);
    expect(store.relations(child).parentId).toBe(parent);
    expect(
      store.list().find((board) => board.reviewId === child)?.repositoryName,
    ).toBe("(unknown repository)");

    // A new repository moves it.
    await run({
      type: "set_target",
      reviewId: child,
      target: { kind: "project", repositoryId: checkout("next") },
    });
    expect(store.projectOf(child)).not.toBe(project);
  });

  it("files checkouts of one repository on any forge together, by the origin they share", () => {
    const ssh = clone("ssh", "git@gitlab.example.com:Team/Service.git");
    const https = clone("https", "https://gitlab.example.com/team/service");

    const port = clone(
      "port",
      "ssh://git@gitlab.example.com:2222/Team/service.git",
    );

    const fork = clone("fork", "git@gitlab.example.com:other/service.git");

    const project = store.projectOfRepository(ssh);

    expect(store.projectOfRepository(https)).toBe(project);
    expect(store.projectOfRepository(port)).toBe(project);
    expect(store.projectOfRepository(fork)).not.toBe(project);
    expect(store.checkoutProject(ssh)?.name).toBe("Team/Service");
    expect(
      store.checkoutsOf("https://gitlab.example.com/Team/Service.git").sort(),
    ).toEqual([ssh, https, port].sort());
  });

  it("files Azure DevOps clones by organization, project and repository", () => {
    const https = clone("https", "https://Org@dev.azure.com/Org/Shop/_git/Api");
    const ssh = clone("ssh", "git@ssh.dev.azure.com:v3/org/shop/api");

    const legacy = clone(
      "legacy",
      "https://org.visualstudio.com/Shop/_git/Api",
    );

    const other = clone("other", "https://dev.azure.com/other/Shop/_git/Api");

    const project = store.projectOfRepository(https);

    expect(store.projectOfRepository(ssh)).toBe(project);
    expect(store.projectOfRepository(legacy)).toBe(project);
    expect(store.projectOfRepository(other)).not.toBe(project);
  });

  it("takes the project named on create, and refuses one that doesn't exist", async () => {
    const app = checkout("app");
    const other = await create(checkout("other"), "Other");
    const named = store.projectOf(other);

    const { reviewId } = await store.execute({
      operation: {
        type: "create",
        title: "Filed elsewhere",
        target: { kind: "project", repositoryId: app },
        projectId: named,
      },
    });

    expect(store.projectOf(reviewId)).toBe(named);
    expect(store.projectOf(reviewId)).not.toBe(store.projectOfRepository(app));

    await expect(
      store.execute({
        operation: {
          type: "create",
          title: "Lost",
          target: { kind: "project", repositoryId: app },
          projectId: "no-such-project",
        },
      }),
    ).rejects.toThrow(ReviewInputError);
    expect(store.list().map((board) => board.title)).not.toContain("Lost");
  });

  it("files a board whose checkout isn't registered under Whiteboards, never under the board opened last", async () => {
    const away = await create(checkout("away"), "Away");

    await run({ type: "attention", reviewId: away, action: "view" });

    const loose = await create("never-registered", "Loose");
    const again = await create("never-registered", "Loose again");

    expect(store.projectOf(loose)).not.toBe(store.projectOf(away));
    expect(store.projectOf(again)).toBe(store.projectOf(loose));
    expect(
      store.list().find((board) => board.reviewId === loose)?.project?.name,
    ).toBe("Whiteboards");
  });
});

describe("a person's save", () => {
  it("saves nothing when, normalized, it changes nothing", async () => {
    const reviewId = await create(checkout("app"));

    await insert(reviewId, {
      type: "markdown",
      markdown: "See [it](whiteboard:source/head/a.ts#L1).",
    });

    const current = store.read(reviewId);

    // The same board, its link in the old spelling a save respells.
    const document = [
      {
        ...current.document[0]!,
        markdown: "See [it](review-source:head/a.ts#L1).",
      },
    ];

    await store.personEdit(reviewId, {
      baseVersion: current.version,
      title: current.title,
      document,
    });
    expect(store.read(reviewId).version).toBe(current.version);
  });
});

describe("links", () => {
  it("checks only the links a change adds, so a link gone dead never blocks an edit", async () => {
    const reviewId = await create(checkout("app"));

    const linked = await insert(reviewId, {
      type: "markdown",
      markdown: `See [it](whiteboard:source/${"c".repeat(12)}/a.ts#L1).`,
    });

    // The commit is gone from the repository since.
    commits.delete("c".repeat(40));

    await insert(reviewId, { type: "markdown", markdown: "Unrelated." });
    await run({ type: "rename", reviewId, title: "Still saves" });
    await run({
      type: "edit",
      reviewId,
      edit: { type: "remove", targetId: linked },
    });

    await expect(
      insert(reviewId, {
        type: "markdown",
        markdown: `See [it](whiteboard:source/${"d".repeat(12)}/a.ts#L1).`,
      }),
    ).rejects.toThrow(
      `Commit ${"d".repeat(12)} is not in the board's repository.`,
    );

    commits.add("c".repeat(40));
  });

  it("ignores a commit that only a code sample names", async () => {
    const reviewId = await create(checkout("app"));

    await insert(reviewId, {
      type: "markdown",
      markdown: `Not a link: \`[it](whiteboard:source/${"e".repeat(12)}/a.ts#L1)\`.`,
    });

    expect(store.read(reviewId).document).toHaveLength(1);
  });

  it("keeps the link index with every write, a delete included", async () => {
    const app = checkout("app");
    const target = await create(app, "Target");
    const linking = await create(app, "Linking");

    await insert(linking, {
      type: "markdown",
      markdown: `See [the target](whiteboard:board/${target}).`,
    });
    expect(store.linkingBoards(target)).toEqual([linking]);

    await trashThenDelete(linking);
    expect(store.linkingBoards(target)).toEqual([]);
  });
});

describe("a board in Trash", () => {
  it("refuses every change, from anyone, until it is restored", async () => {
    const app = checkout("app");
    const reviewId = await create(app);
    const other = await create(app, "Other");
    const quote = await insert(reviewId, { type: "markdown", markdown: "A." });

    await run({ type: "lifecycle", state: "trash", reviewId }, person);
    const { version } = store.read(reviewId);

    for (const author of [agent, person])
      for (const operation of [
        { type: "rename", reviewId, title: "Renamed" },
        {
          type: "edit",
          reviewId,
          edit: { type: "remove", targetId: quote },
        },
        { type: "restore", reviewId, version: 0 },
        { type: "set_parent", reviewId, parentId: other },
        { type: "attention", reviewId, action: "view" },
      ])
        await expect(run(operation, author)).rejects.toThrow(
          "This whiteboard was moved to Trash",
        );

    await expect(
      store.personEdit(reviewId, {
        baseVersion: version,
        title: "Mine",
        document: store.read(reviewId).document,
      }),
    ).rejects.toThrow("This whiteboard was moved to Trash");
    expect(store.read(reviewId).version).toBe(version);

    await run({ type: "lifecycle", state: "active", reviewId }, person);
    await run({ type: "rename", reviewId, title: "Back" });
    expect(store.read(reviewId).title).toBe("Back");
  });

  it("takes its threads, and when each was seen, with it when deleted", async () => {
    const reviewId = await create(checkout("app"));

    await store.askHistory.save({
      id: "thread",
      anchor: { board: reviewId },
      projectId: store.projectOf(reviewId),
      agent: "claude",
      sessionId: "session",
      version: 0,
      head: "7fd03b8",
      cwd: directory,
      title: "Question",
      selection: { title: "Line", target: { kind: "text", quote: "Q." } },
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      permissions: "read-only",
    });
    store.askHistory.markViewed("thread");

    await trashThenDelete(reviewId);
    expect(store.askHistory.get("thread")).toBeUndefined();
  });

  it("is the only place a board is deleted from", async () => {
    const reviewId = await create(checkout("app"));

    await expect(run({ type: "delete", reviewId }, person)).rejects.toThrow(
      "Move this whiteboard to Trash before deleting it.",
    );
    await trashThenDelete(reviewId);
    expect(store.has(reviewId)).toBe(false);
  });
});

describe("a person's command from the app", () => {
  it("is the person's: it moves a board with a held block to Trash, which an agent can't", async () => {
    const reviewId = await create(checkout("app"));
    const quote = await insert(reviewId, { type: "markdown", markdown: "A." });

    hold(reviewId, quote);

    const api = createReviewApi(store);

    const client = new ReviewApiClient(
      { serverUrl: "http://review.test", token: "t" },
      async (url, init) =>
        api.request(new URL(url).pathname.replace(/^\/reviews-api/, ""), init),
    );

    const trash = { type: "lifecycle", state: "trash", reviewId };

    await expect(
      client.post("/commands", { operation: trash }),
    ).rejects.toThrow(`The user is editing this block (${quote}).`);

    // The canvas's Markdown save, a person's edit of the held block.
    const edit = {
      type: "edit",
      reviewId,
      edit: {
        type: "update",
        targetId: quote,
        changes: { markdown: "B." },
      },
    };

    await expect(client.post("/commands", { operation: edit })).rejects.toThrow(
      `The user is editing this block (${quote}).`,
    );
    await client.personCommand(edit);
    expect(store.history(reviewId).at(-1)?.author).toBe("you");

    await client.personCommand(trash);
    expect(store.summary(reviewId)?.trashedAt).toEqual(expect.any(String));
  });
});
