import type { DatabaseSync } from "node:sqlite";

/** A board version's repository in SQL over `versions.snapshot`, as
 * `boardRepositoryId` reads it: its target's, else its pins'. */
export const BOARD_REPOSITORY_ID_SQL =
  "CASE WHEN json_valid(versions.snapshot) THEN COALESCE(json_extract(versions.snapshot,'$.target.repositoryId'),json_extract(versions.snapshot,'$.pins.repositoryId')) END";

export const hasTable = (db: DatabaseSync, table: string) =>
  Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table),
  );

export function initializeReviewStoreSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, version INTEGER NOT NULL, next_id INTEGER NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id), parent_id TEXT REFERENCES reviews(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS versions(review_id TEXT REFERENCES reviews(id), version INTEGER, snapshot TEXT NOT NULL,
      PRIMARY KEY(review_id,version));
    CREATE TABLE IF NOT EXISTS review_attention(review_id TEXT PRIMARY KEY REFERENCES reviews(id), viewed_at TEXT, deleted_at TEXT);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS repositories(id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id));
    CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id),
      kind TEXT NOT NULL, mime_type TEXT NOT NULL, data BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS review_coverage(review_id TEXT REFERENCES reviews(id), file TEXT, fingerprint TEXT NOT NULL, coverage TEXT NOT NULL,
      PRIMARY KEY(review_id,file));
    CREATE TABLE IF NOT EXISTS comparison_stats(identity TEXT PRIMARY KEY, stats TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS server_identity(one INTEGER PRIMARY KEY CHECK(one=1), id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS board_dependencies(review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      depends_on TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, PRIMARY KEY(review_id,depends_on));
    CREATE INDEX IF NOT EXISTS board_dependencies_depends_on ON board_dependencies(depends_on);
    -- A link goes with the board it is on. Where it points stays plain
    -- text, no foreign key: a link to a deleted board stays, dangling.
    CREATE TABLE IF NOT EXISTS board_links(from_review TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, from_block TEXT NOT NULL,
      to_review TEXT NOT NULL, to_block TEXT);
    CREATE INDEX IF NOT EXISTS board_links_from ON board_links(from_review);
    CREATE INDEX IF NOT EXISTS board_links_to ON board_links(to_review);
  `);
}
