import type { DatabaseSync } from "node:sqlite";

export function initializeReviewStoreSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, version INTEGER NOT NULL, next_id INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS versions(review_id TEXT REFERENCES reviews(id), version INTEGER, snapshot TEXT NOT NULL,
      PRIMARY KEY(review_id,version));
    DROP TABLE IF EXISTS receipts;
    CREATE TABLE IF NOT EXISTS review_attention(review_id TEXT PRIMARY KEY REFERENCES reviews(id), viewed_at TEXT, dismissed_at TEXT);
    CREATE TABLE IF NOT EXISTS repositories(id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id),
      kind TEXT NOT NULL, mime_type TEXT NOT NULL, data BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS review_coverage(review_id TEXT REFERENCES reviews(id), file TEXT, fingerprint TEXT NOT NULL, coverage TEXT NOT NULL,
      PRIMARY KEY(review_id,file));
    DROP TABLE IF EXISTS review_viewed;
    CREATE TABLE IF NOT EXISTS comparison_stats(identity TEXT PRIMARY KEY, stats TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS server_identity(one INTEGER PRIMARY KEY CHECK(one=1), id TEXT NOT NULL);
    DROP TABLE IF EXISTS authoring_drafts;
  `);
}
