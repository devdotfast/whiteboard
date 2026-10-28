import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { sourceReferences } from "@dev.fast/whiteboard-document";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckoutGroups, type CheckoutProbe } from "./checkout-groups.js";
import {
  STORE_UPGRADES,
  STORE_VERSION,
  storeVersion,
} from "./store-migrations.js";
import { initializeReviewStoreSchema } from "./store-schema.js";
import { ReviewStore, projectOfCheckout } from "./store.js";

// Stores written by released versions, shrunk by
// scripts/build-store-fixture.ts, opened by today's store: what the
// upgrade must carry, and what it must survive.

const FIXTURES = fileURLToPath(
  new URL("../../test/fixtures/stores/", import.meta.url),
);

const providers = {
  validatePins: async () => {},
  validateSource: async () => {},
  validateResource: async () => {},
};

const opened: ReviewStore[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((store) => store.close()));
  vi.restoreAllMocks();
});

/** A copy of a fixture in a fresh home, with these checkouts made real. */
function home(fixture: string, checkouts: string[] = []) {
  const directory = mkdtempSync(path.join(tmpdir(), "store-upgrade-"));
  const database = path.join(directory, "review-api.db");

  copyFileSync(path.join(FIXTURES, fixture), database);

  const db = new DatabaseSync(database);

  for (const name of checkouts) {
    const checkout = path.join(directory, name);

    execFileSync("git", ["init", "-q", checkout]);
    db.prepare("UPDATE repositories SET path=? WHERE name=?").run(
      checkout,
      name,
    );
  }

  db.close();

  return { directory, database };
}

const open = (database: string) => {
  const store = new ReviewStore(database, providers);

  opened.push(store);

  return store;
};

/** What a store holds, read straight from its tables. */
function inventory(database: string) {
  const db = new DatabaseSync(database, { readOnly: true });

  const titles = db
    .prepare(
      `SELECT reviews.id, CASE WHEN json_valid(snapshot) THEN json_extract(snapshot,'$.title') END AS title
      FROM reviews LEFT JOIN versions ON versions.review_id=reviews.id AND versions.version=reviews.version
      ORDER BY title, reviews.id`,
    )
    .all()
    .map(({ title }) => String(title));

  const versions = Number(
    db.prepare("SELECT count(*) AS n FROM versions").get()!.n,
  );

  // Releases before Ask had no table for it.
  const threads = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='ask_conversations'",
    )
    .get()
    ? db
        .prepare("SELECT id FROM ask_conversations ORDER BY id")
        .all()
        .map(({ id }) => String(id))
    : [];

  db.close();

  return { titles, versions, threads };
}

const projectless = (database: string) => {
  const db = new DatabaseSync(database, { readOnly: true });

  const count = Number(
    db
      .prepare(
        "SELECT count(*) AS n FROM reviews WHERE project_id NOT IN (SELECT id FROM projects)",
      )
      .get()!.n,
  );

  db.close();

  return count;
};

/** Each table's columns and the store's indexes, in any order. */
function tablesAndIndexes(database: string) {
  const db = new DatabaseSync(database, { readOnly: true });

  const tables = Object.fromEntries(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map(({ name }) => [
        String(name),
        db
          .prepare("SELECT name FROM pragma_table_info(?) ORDER BY name")
          .all(String(name))
          .map((column) => String(column.name)),
      ]),
  );

  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name",
    )
    .all()
    .map(({ name }) => String(name));

  db.close();

  return { tables, indexes };
}

/** The last upgrade step a store ran. */
const versionOf = (database: string) => {
  const db = new DatabaseSync(database, { readOnly: true });

  const version = storeVersion(db);

  db.close();

  return version;
};

describe.each([
  "v0.0.34.db",
  "v0.2.0.db",
  "main-2ddf3eb.db",
  "main-4e32ec3f.db",
])("a store from %s", (fixture) => {
  it("keeps every board, version, title and thread, gives each board a project, and upgrades once", async () => {
    const { database } = home(fixture, ["alpha", "beta"]);
    const before = inventory(database);

    await open(database).close();
    opened.pop();

    const after = inventory(database);

    expect(after).toEqual(before);
    expect(projectless(database)).toBe(0);

    expect(versionOf(database)).toBe(STORE_VERSION);

    // Opening again changes nothing.
    await open(database).close();
    opened.pop();
    expect(inventory(database)).toEqual(after);
    expect(versionOf(database)).toBe(STORE_VERSION);
  });

  it("names who wrote each version from now on, and no one for one a release saved", async () => {
    const { database } = home(fixture, ["alpha", "beta"]);
    const store = open(database);

    const reader = new DatabaseSync(database, { readOnly: true });

    const reviewId = String(
      reader
        .prepare(
          `SELECT reviews.id FROM reviews JOIN versions ON versions.review_id=reviews.id AND versions.version=reviews.version
          WHERE json_extract(snapshot,'$.target.kind')='commits' ORDER BY reviews.id LIMIT 1`,
        )
        .get()!.id,
    );

    reader.close();

    // Releases saved an agent's command and a person's edit alike.
    for (const entry of store.history(reviewId)) {
      expect(entry.author).toBeUndefined();
      expect(entry.threadId).toBeUndefined();
    }

    await store.execute({
      operation: { type: "rename", reviewId, title: "Renamed" },
    });
    expect(store.history(reviewId).at(-1)?.author).toBe("agent");

    const db = new DatabaseSync(database);

    expect(() =>
      db
        .prepare("UPDATE versions SET author_kind='robot' WHERE review_id=?")
        .run(reviewId),
    ).toThrow(/author_kind/);
    db.close();
  });

  it("ends with the tables, columns and indexes of a new store", async () => {
    const { database } = home(fixture, ["alpha", "beta"]);

    const fresh = path.join(
      mkdtempSync(path.join(tmpdir(), "store-new-")),
      "review-api.db",
    );

    await open(database).close();
    await open(fresh).close();
    opened.splice(0);

    const upgraded = tablesAndIndexes(database);
    const made = tablesAndIndexes(fresh);

    // Tables a release kept on purpose, legacy_imports say, may stay.
    expect(upgraded.tables).toMatchObject(made.tables);
    expect(upgraded.indexes).toEqual(expect.arrayContaining(made.indexes));

    for (const retired of [
      "receipts",
      "review_viewed",
      "authoring_drafts",
      "authoring_sessions",
    ])
      expect(upgraded.tables).not.toHaveProperty(retired);
    expect(upgraded.indexes).not.toContain("versions_thread");
    expect(versionOf(fresh)).toBe(STORE_VERSION);
  });
});

it("numbers its upgrade steps from 1, with no gaps", () => {
  expect(STORE_UPGRADES.map(({ version }) => version)).toEqual(
    Array.from(STORE_UPGRADES, (_, index) => index + 1),
  );
});

it("converts a v0.2.0 pad's quotes of other repositories, so the plan quotes only its own", () => {
  const { database } = home("v0.2.0.db", ["alpha", "beta", "gamma-to-move"]);
  const store = open(database);

  const plan = store
    .list()
    .find((board) => board.title === "Scratchpad" && board.target);

  expect(plan).toBeDefined();
  const own = plan!.target!.repositoryId;

  for (const { version } of store.history(plan!.reviewId))
    for (const { source } of sourceReferences(
      store.read(plan!.reviewId, version).document,
      { tolerant: true },
    ))
      expect(source.pins?.repositoryId ?? own).toBe(own);
});

it("opens a store with an old version it can't parse", () => {
  const { database } = home("main-2ddf3eb.db");
  const db = new DatabaseSync(database);

  db.exec(`UPDATE versions SET snapshot='{"broken'
    WHERE rowid=(SELECT versions.rowid FROM versions JOIN reviews ON reviews.id=review_id
      WHERE versions.version < reviews.version LIMIT 1)`);
  db.close();

  expect(() => open(database)).not.toThrow();
});

it("finishes an Ask history upgrade a crash left halfway", () => {
  const { database } = home("v0.2.0.db");
  const db = new DatabaseSync(database);

  db.exec(
    "ALTER TABLE ask_conversations RENAME COLUMN review_id TO anchor_board",
  );
  db.close();

  const store = open(database);
  const threads = inventory(database).threads;

  expect(threads.length).toBeGreaterThan(0);
  expect(store.askHistory.get(threads[0]!)).toBeDefined();
});

it("groups 440 checkouts, most of them deleted, in under five seconds", async () => {
  const { database } = home("main-2ddf3eb.db", [
    "alpha",
    "beta",
    "gamma-to-move",
    "alpha-clone",
    "detached",
  ]);

  const db = new DatabaseSync(database);

  for (let index = 0; index < 430; index++) {
    db.prepare("INSERT INTO repositories(id,path,name) VALUES(?,?,?)").run(
      `gone-${index}`,
      `/fixture/gone/worktree-${index}`,
      `worktree-${index}`,
    );
    db.prepare("INSERT INTO reviews VALUES(?,0,1)").run(`gone-board-${index}`);
    db.prepare(
      "INSERT INTO versions(review_id,version,snapshot) VALUES(?,0,?)",
    ).run(
      `gone-board-${index}`,
      JSON.stringify({
        reviewId: `gone-board-${index}`,
        version: 0,
        title: `Gone ${index}`,
        target: { kind: "worktree", repositoryId: `gone-${index}` },
        document: [],
        createdAt: "2026-09-30T00:00:00.000Z",
      }),
    );
  }

  db.close();

  const started = Date.now();

  await open(database).close();
  opened.pop();

  expect(Date.now() - started).toBeLessThan(5_000);
  expect(projectless(database)).toBe(0);
});

it("reports the upgrade step that failed, and why", () => {
  const { database } = home("main-2ddf3eb.db");
  const db = new DatabaseSync(database);

  // The rebuild's scratch table, as a crash could leave it.
  db.exec("CREATE TABLE reviews_with_projects(id TEXT)");
  db.close();

  vi.spyOn(console, "error").mockImplementation(() => {});

  expect(() => open(database)).toThrow(
    /step 3 \(board-projects\) failed and was rolled back\. table reviews_with_projects already exists/,
  );
});

it("asks each checkout on disk at most twice, and never while holding the write lock", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "store-upgrade-"));
  const db = new DatabaseSync(":memory:");

  initializeReviewStoreSchema(db);

  // Even checkouts are on disk; each lists the next, deleted, as a worktree.
  const checkouts = Array.from({ length: 60 }, (_, index) => {
    const root = path.join(directory, `checkout-${index}`);

    if (index % 2 === 0) mkdirSync(root);
    db.prepare("INSERT INTO repositories(id,path,name) VALUES(?,?,?)").run(
      `checkout-${index}`,
      root,
      `checkout-${index}`,
    );

    return root;
  });

  let calls = 0;
  let locked = 0;

  const ask = () => {
    calls++;

    if (db.isTransaction) locked++;
  };

  const index = (root: string) => Number(root.split("-").at(-1));

  const probe: CheckoutProbe = {
    groupAt: (root) => {
      ask();

      return { key: `group-${index(root) % 6}`, label: "group" };
    },
    worktreesOf: (root) => {
      ask();

      return {
        commonDir: `${root}/.git`,
        worktrees: [checkouts[index(root) + 1]!],
      };
    },
    commitsIn: () => {
      ask();

      return new Set();
    },
  };

  const groups = new CheckoutGroups(db, probe);

  groups.prepare();
  db.exec("BEGIN IMMEDIATE");

  const projects = checkouts.map((_, at) =>
    projectOfCheckout(db, `checkout-${at}`, groups),
  );

  db.exec("COMMIT");

  expect(calls).toBeLessThanOrEqual(2 * checkouts.length);
  expect(locked).toBe(0);

  // A deleted worktree is in the project of the checkout that lists it.
  for (let at = 1; at < checkouts.length; at += 2)
    expect(projects[at]).toBe(projects[at - 1]);
  // Checkouts on disk join by group.
  expect(projects[0]).toBe(projects[6]);
  expect(projects[0]).not.toBe(projects[2]);
});

it("gives a deleted checkout inside another repository's folder the project of the repository its boards pinned", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "store-upgrade-"));
  const db = new DatabaseSync(":memory:");

  initializeReviewStoreSchema(db);

  const outer = path.join(directory, "outer");
  const other = path.join(directory, "other");

  mkdirSync(outer);
  mkdirSync(other);

  const checkouts = {
    outer,
    other,
    // Both deleted, both once inside outer's folder.
    vendored: path.join(outer, "vendor", "lib"),
    stray: path.join(outer, "stray"),
  };

  for (const [id, root] of Object.entries(checkouts))
    db.prepare("INSERT INTO repositories(id,path,name) VALUES(?,?,?)").run(
      id,
      root,
      id,
    );

  const pinned = "a".repeat(40);

  db.exec(`INSERT INTO projects VALUES('project','Project');
    INSERT INTO reviews(id,version,next_id,project_id) VALUES('board',0,1,'project');`);
  db.prepare(
    "INSERT INTO versions(review_id,version,snapshot,author_kind) VALUES('board',0,?,'agent')",
  ).run(
    JSON.stringify({
      pins: { repositoryId: "vendored", head: pinned },
    }),
  );

  const probe: CheckoutProbe = {
    groupAt: (root) => ({ key: root, label: path.basename(root) }),
    worktreesOf: (root) => ({ commonDir: `${root}/.git`, worktrees: [] }),
    commitsIn: (commonDir, commits) =>
      new Set(commonDir === `${other}/.git` ? commits : []),
  };

  const groups = new CheckoutGroups(db, probe);
  const project = (id: string) => projectOfCheckout(db, id, groups);

  // The commits are other's, though the folder was outer's.
  expect(project("vendored")).toBe(project("other"));
  // Nothing ties stray to outer's repository.
  expect(project("stray")).not.toBe(project("outer"));
  expect(project("stray")).not.toBe(project("other"));
});

it("finds a deleted checkout's repository by its boards' older commits when their current ones leave it in doubt", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "store-upgrade-"));
  const db = new DatabaseSync(":memory:");

  initializeReviewStoreSchema(db);

  const first = path.join(directory, "first");
  const second = path.join(directory, "second");

  mkdirSync(first);
  mkdirSync(second);

  for (const [id, root] of Object.entries({
    first,
    second,
    gone: path.join(directory, "gone"),
  }))
    db.prepare("INSERT INTO repositories(id,path,name) VALUES(?,?,?)").run(
      id,
      root,
      id,
    );

  const [older, current] = ["a".repeat(40), "b".repeat(40)];

  db.exec(`INSERT INTO projects VALUES('project','Project');
    INSERT INTO reviews(id,version,next_id,project_id) VALUES('board',1,1,'project');`);

  for (const [version, head] of [older, current].entries())
    db.prepare(
      "INSERT INTO versions(review_id,version,snapshot,author_kind) VALUES('board',?,?,'agent')",
    ).run(version, JSON.stringify({ pins: { repositoryId: "gone", head } }));

  // The first repository has only the older commit, the second only the
  // current one: both have the checkout's commits, and the first ranks
  // before the second.
  const probe: CheckoutProbe = {
    groupAt: (root) => ({ key: root, label: path.basename(root) }),
    worktreesOf: (root) => ({ commonDir: `${root}/.git`, worktrees: [] }),
    commitsIn: (commonDir, commits) =>
      new Set(
        commits.filter(
          (commit) =>
            commit === (commonDir === `${first}/.git` ? older : current),
        ),
      ),
  };

  const together = new CheckoutGroups(db, probe);

  await together.prepareConcurrently();
  expect(together.ownerOf("gone")).toBe("first");
  expect(new CheckoutGroups(db, probe).ownerOf("gone")).toBe("first");
});
