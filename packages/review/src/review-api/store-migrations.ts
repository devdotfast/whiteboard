import type { DatabaseSync } from "node:sqlite";

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
}

interface StoreUpgrade {
  version: number;
  name: string;
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
    }
  }
}
