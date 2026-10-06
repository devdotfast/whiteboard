// Shrinks a whiteboard store written by an older release into a small
// fixture for store-upgrade.test.ts, keeping what an upgrade has to carry:
// every board, its first and last two versions, the scratchpad, Ask
// threads, attention and coverage. Checkout paths become `/fixture/<name>`;
// a test points the ones it needs at real checkouts.
//
//   tsx scripts/build-store-fixture.ts <old-store.db> <fixture.db>
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [source, out] = process.argv.slice(2);

if (!source || !out) {
  console.error("usage: build-store-fixture.ts <old-store.db> <fixture.db>");
  process.exit(2);
}

rmSync(out, { force: true });

new DatabaseSync(source, { readOnly: true }).prepare("VACUUM INTO ?").run(out);

const db = new DatabaseSync(out);

const tables = new Set(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map(({ name }) => String(name)),
);

db.exec("PRAGMA foreign_keys=OFF");

for (const { id, version } of db
  .prepare("SELECT id, version FROM reviews")
  .all())
  db.prepare(
    "DELETE FROM versions WHERE review_id=? AND version NOT IN (0, ?, ?)",
  ).run(String(id), Number(version), Number(version) - 1);

// What only takes room.
for (const table of [
  "receipts",
  "legacy_imports",
  "comparison_stats",
  "resources",
])
  if (tables.has(table)) db.exec(`DELETE FROM ${table}`);

// A thread's transcript isn't what an upgrade moves.
if (tables.has("ask_conversations"))
  db.exec("UPDATE ask_conversations SET entries=NULL");

db.exec(`UPDATE repositories SET path='/fixture/'||name;
  PRAGMA journal_mode=DELETE;
  VACUUM;`);

db.close();
