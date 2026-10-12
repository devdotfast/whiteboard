import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { CheckoutGroups } from "./checkout-groups.js";

import type { ReadAtCommit } from "./foreign-references.js";
import {
  planFromScratchpad,
  readScratchpadQuotes,
} from "./scratchpad-plan-upgrade.js";
import { hasTable } from "./store-schema.js";

// A store's one-time upgrades, in order. PRAGMA user_version holds the last
// one a store has run, so each runs once per store and a later launch runs
// none; a new store runs them all on its first open.
//
// A shipped step never changes: a fix is a new step at the end. Each step
// upgrades a store as a release before user_version left it, which may
// already have some of it done, or lack the tables it touches; so each
// checks what it needs before changing anything.

/** What a step may use besides the database. */
export interface StoreUpgradeContext {
  db: DatabaseSync;
  /** Groups the registered checkouts, reading their git metadata. */
  prepareCheckouts(): void;
  repositories(): { id: string }[];
  repositoryPath(repositoryId: string): string;
  /** A checkout's name as its project labels it, else its folder. */
  repositoryName(repositoryId: string): string;
  /** Undefined when the file can't be read; each file is read once. */
  fileAtCommit: ReadAtCommit;
  /** A checkout's project, made on first use. */
  projectOfRepository(repositoryId: string): string;
  /** The project of the board opened last, else firstRepositoryProject's. */
  fallbackProject(): string;
  /** The first checkout's project, else one with no repository. */
  firstRepositoryProject(): string;
}

interface StoreUpgrade {
  version: number;
  name: string;
  /** It groups the checkouts, which the store can work out before it
   * opens (`groupCheckoutsAhead`), else does before the write lock. */
  groupsCheckouts?: true;
  /** Slow reads to do before taking the write lock other hosts wait on. */
  beforeLock?(context: StoreUpgradeContext): void;
  /** For a table rebuild: foreign keys can't be turned off in a
   * transaction. */
  foreignKeysOff?: true;
  run(context: StoreUpgradeContext): void;
}

const columnsOf = (db: DatabaseSync, table: string) =>
  new Set(
    db
      .prepare("SELECT name FROM pragma_table_info(?)")
      .all(table)
      .map(({ name }) => String(name)),
  );

export const STORE_UPGRADES: readonly StoreUpgrade[] = [
  {
    version: 1,
    name: "retired-tables",
    // Tables earlier releases kept and nothing reads any more. Presences
    // replaced authoring_sessions; both last minutes, so it isn't moved.
    run: ({ db }) =>
      db.exec(`DROP TABLE IF EXISTS receipts;
        DROP TABLE IF EXISTS review_viewed;
        DROP TABLE IF EXISTS authoring_drafts;
        DROP TABLE IF EXISTS authoring_sessions;`),
  },
  {
    version: 2,
    name: "archive-to-trash",
    // Archive became Trash: archived boards get Trash's full recovery
    // window from the upgrade, since Archive kept them forever.
    run: ({ db }) => {
      if (!columnsOf(db, "review_attention").has("dismissed_at")) return;

      db.exec(
        "ALTER TABLE review_attention RENAME COLUMN dismissed_at TO deleted_at",
      );
      db.prepare(
        "UPDATE review_attention SET deleted_at=? WHERE deleted_at IS NOT NULL",
      ).run(new Date().toISOString());
    },
  },
  {
    version: 3,
    name: "board-projects",
    // Every board belongs to a project: its repository's, else the one of
    // the board opened last. With hundreds of checkouts, grouping them
    // reads a good deal of git metadata.
    groupsCheckouts: true,
    foreignKeysOff: true,
    run: ({
      db,
      repositories,
      projectOfRepository,
      firstRepositoryProject,
    }) => {
      // A child's parent is found by it.
      const parents = () =>
        db.exec(
          "CREATE INDEX IF NOT EXISTS reviews_parent ON reviews(parent_id)",
        );

      // A new store has the columns from the start.
      if (columnsOf(db, "reviews").has("project_id")) return parents();

      // A checkout names its project; stores from before projects lack
      // the column.
      if (!columnsOf(db, "repositories").has("project_id"))
        db.exec(
          "ALTER TABLE repositories ADD COLUMN project_id TEXT REFERENCES projects(id)",
        );

      // In creation order, which the rebuild keeps. A board whose current
      // version is missing is kept too, in the fallback project.
      const boards = db
        .prepare(
          `SELECT reviews.id, CASE WHEN json_valid(versions.snapshot) THEN COALESCE(json_extract(versions.snapshot,'$.target.repositoryId'),json_extract(versions.snapshot,'$.pins.repositoryId')) END AS repository_id,
            review_attention.viewed_at
          FROM reviews LEFT JOIN versions ON versions.review_id=reviews.id AND versions.version=reviews.version
          LEFT JOIN review_attention ON review_attention.review_id=reviews.id
          ORDER BY reviews.rowid`,
        )
        .all();

      const registered = new Set(repositories().map(({ id }) => id));
      const projects = new Map<string, string>();

      for (const { id, repository_id: repository } of boards)
        if (repository && registered.has(String(repository)))
          projects.set(String(id), projectOfRepository(String(repository)));

      // The project of the board opened last.
      const [opened] = boards
        .filter(({ id, viewed_at }) => viewed_at && projects.has(String(id)))
        .sort((a, b) => String(b.viewed_at).localeCompare(String(a.viewed_at)));

      let fallback = opened && projects.get(String(opened.id));

      const brokenReferences = () =>
        db
          .prepare("PRAGMA foreign_key_check")
          .all()
          .filter(({ parent }) => parent === "reviews").length;

      // Only references this rebuild breaks; older dangling rows stay.
      const broken = brokenReferences();

      // A child names its parent; deleting the parent moves it to top
      // level. No board had one before projects.
      db.exec(`CREATE TABLE reviews_with_projects(id TEXT PRIMARY KEY, version INTEGER NOT NULL, next_id INTEGER NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        parent_id TEXT REFERENCES reviews(id) ON DELETE SET NULL)`);

      const insert = db.prepare(
        "INSERT INTO reviews_with_projects(id,version,next_id,project_id) SELECT id,version,next_id,? FROM reviews WHERE id=?",
      );

      for (const { id } of boards)
        insert.run(
          projects.get(String(id)) ?? (fallback ??= firstRepositoryProject()),
          String(id),
        );
      db.exec(`DROP TABLE reviews;
        ALTER TABLE reviews_with_projects RENAME TO reviews;`);
      parents();

      if (brokenReferences() > broken)
        throw new Error("Giving boards projects broke a reference.");
    },
  },
  {
    version: 4,
    name: "scratchpad-plan",
    beforeLock: readScratchpadQuotes,
    run: planFromScratchpad,
  },
  {
    version: 5,
    name: "ask-permissions",
    // Auto mode keeps what an Ask thread may do without asking; threads
    // saved before it lack the column.
    run: ({ db }) => {
      const columns = columnsOf(db, "ask_conversations");

      if (columns.size > 0 && !columns.has("permissions"))
        db.exec("ALTER TABLE ask_conversations ADD COLUMN permissions TEXT");
    },
  },
];

export const STORE_VERSION = STORE_UPGRADES.at(-1)!.version;

export const storeVersion = (db: DatabaseSync) =>
  Number(db.prepare("PRAGMA user_version").get()!.user_version);

/** Runs every step the store hasn't, each in its own transaction with the
 * version it reaches, so a failed step rolls back alone and stops the store
 * opening, naming the step; the ones before it stay done. A store at a
 * later version than this build knows is left as it is. */
export function upgradeStore(context: StoreUpgradeContext) {
  const { db } = context;

  for (const step of STORE_UPGRADES) {
    if (storeVersion(db) >= step.version) continue;

    if (step.groupsCheckouts) context.prepareCheckouts();
    step.beforeLock?.(context);

    if (step.foreignKeysOff) db.exec("PRAGMA foreign_keys=OFF");

    db.exec("BEGIN IMMEDIATE");

    try {
      // Another host on this home may have run it while this one waited.
      if (storeVersion(db) < step.version) {
        step.run(context);
        db.exec(`PRAGMA user_version=${step.version}`);
      }

      db.exec("COMMIT");
    } catch (error) {
      // SQLite may have rolled back already, on a full disk say; the error
      // that made it is the one to report.
      if (db.isTransaction) db.exec("ROLLBACK");
      throw new Error(
        `Could not upgrade the whiteboard store: step ${step.version} (${step.name}) failed and was rolled back. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      if (step.foreignKeysOff) db.exec("PRAGMA foreign_keys=ON");
    }
  }
}

/** How the store's checkouts group, worked out before it opens, asking
 * several repositories at once, when an upgrade still to run needs it;
 * undefined otherwise, or when the store can't be read so, and the step
 * works it out itself. */
export async function groupCheckoutsAhead(
  databasePath: string,
): Promise<ReadonlyMap<string, string> | undefined> {
  if (!existsSync(databasePath)) return undefined;

  let db: DatabaseSync | undefined;

  try {
    db = new DatabaseSync(databasePath, { timeout: 5000 });
    const version = storeVersion(db);

    if (
      !STORE_UPGRADES.some(
        (step) => step.groupsCheckouts && step.version > version,
      ) ||
      !columnsOf(db, "repositories").size
    )
      return undefined;

    const groups = new CheckoutGroups(db);

    await groups.prepareConcurrently();

    return groups.prepared;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}
