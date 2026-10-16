import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import type { JsonValue } from "@dev.fast/json";
import { migrateStoredDocument } from "@review/stored-document-migration.js";

import { type Block, sourceReferences } from "./document.js";
import { snapshotForeignReferences } from "./foreign-references.js";
import type { StoreUpgradeContext } from "./store-migrations.js";
import { BOARD_REPOSITORY_ID_SQL, columnsOf } from "./store-schema.js";

// The old global scratchpad becomes a plan titled "Scratchpad", history
// kept, in the project of the repository its blocks quote most, else of the
// repository opened last. A board quotes only its own repository, so its
// quotes of others become snapshots.

const OLD_SCRATCHPAD_ID = "scratchpad";

const hasScratchpadVersions = ({ db }: StoreUpgradeContext) =>
  Boolean(
    db
      .prepare("SELECT 1 FROM versions WHERE review_id=? LIMIT 1")
      .get(OLD_SCRATCHPAD_ID),
  );

type PadSnapshot = { document: JsonValue[]; [key: string]: JsonValue };

/** A pad version's snapshot with its document in today's form (old pads
 * held anchors as objects); undefined for one that won't parse. */
function parsePadVersion(text: string): PadSnapshot | undefined {
  try {
    // SAFETY: versions holds snapshots validated when they were saved.
    const snapshot = JSON.parse(text) as PadSnapshot;
    const document = migrateStoredDocument(snapshot.document);

    snapshot.document = Array.isArray(document) ? document : [];

    return snapshot;
  } catch {
    return undefined;
  }
}

/** Each pad version as parsed, by version, for one open. The run, inside
 * the write lock, reads the rows again: it reuses a parse only of text that
 * hasn't changed since. */
const parsedPads = new WeakMap<
  StoreUpgradeContext,
  Map<number, { text: string; snapshot: PadSnapshot | undefined }>
>();

function padVersion(
  context: StoreUpgradeContext,
  version: number,
  text: string,
) {
  let parsed = parsedPads.get(context);

  if (!parsed) parsedPads.set(context, (parsed = new Map()));
  const known = parsed.get(version);

  if (known?.text === text) return known.snapshot;

  const snapshot = parsePadVersion(text);

  parsed.set(version, { text, snapshot });

  return snapshot;
}

/** The pad's versions, oldest first, each parsed once per open. */
const scratchpadVersions = (context: StoreUpgradeContext) =>
  context.db
    .prepare(
      "SELECT version,snapshot FROM versions WHERE review_id=? ORDER BY version",
    )
    .all(OLD_SCRATCHPAD_ID)
    .map((row) => ({
      version: Number(row.version),
      snapshot: padVersion(context, Number(row.version), String(row.snapshot)),
    }));

/** The pad's newest version that parses, reading no further back. */
function latestScratchpadDocument(context: StoreUpgradeContext) {
  for (const row of context.db
    .prepare(
      "SELECT version,snapshot FROM versions WHERE review_id=? ORDER BY version DESC",
    )
    .iterate(OLD_SCRATCHPAD_ID)) {
    const snapshot = padVersion(
      context,
      Number(row.version),
      String(row.snapshot),
    );

    if (snapshot) return snapshot.document;
  }

  return undefined;
}

/** The checkout the pad quotes most, else the one opened last. Only a
 * checkout that still exists: a plan opens on it. */
function scratchpadRepository(context: StoreUpgradeContext) {
  const exists = (repositoryId: string) => {
    try {
      return existsSync(context.repositoryPath(repositoryId));
    } catch {
      return false;
    }
  };

  const counts = new Map<string, number>();

  // SAFETY: a stored pad's blocks, in today's form.
  const latest = latestScratchpadDocument(context) as Block[] | undefined;

  for (const { source } of sourceReferences(latest ?? [], {
    tolerant: true,
  })) {
    const repositoryId = source.pins?.repositoryId;

    if (repositoryId && exists(repositoryId))
      counts.set(repositoryId, (counts.get(repositoryId) ?? 0) + 1);
  }

  const [quoted] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];

  if (quoted) return quoted;

  const viewed = context.db
    .prepare(
      `SELECT ${BOARD_REPOSITORY_ID_SQL} AS repository
      FROM review_attention
      JOIN reviews ON reviews.id=review_attention.review_id
      JOIN versions ON versions.review_id=reviews.id AND versions.version=reviews.version
      WHERE review_attention.viewed_at IS NOT NULL AND repository IS NOT NULL
      ORDER BY review_attention.viewed_at DESC`,
    )
    .all()
    .map(({ repository }) => String(repository));

  return [...viewed, ...context.repositories().map(({ id }) => id)].find(
    exists,
  );
}

const snapshots = (
  context: StoreUpgradeContext,
  own: string,
  document: JsonValue[],
  allocate: (prefix: string) => string,
) =>
  snapshotForeignReferences(
    document,
    own,
    context.fileAtCommit,
    context.repositoryName,
    allocate,
  );

/** Reads the files the pad quotes, which the context keeps, before the
 * write lock other hosts on this home wait on. */
export function readScratchpadQuotes(context: StoreUpgradeContext) {
  if (!hasScratchpadVersions(context)) return;

  const quoting = scratchpadRepository(context);

  if (quoting)
    for (const { snapshot } of scratchpadVersions(context))
      if (snapshot)
        snapshots(context, quoting, snapshot.document, (prefix) => prefix);
}

export function planFromScratchpad(context: StoreUpgradeContext) {
  const { db } = context;

  // A pad row with no versions has nothing to keep; it stays as it is.
  if (!hasScratchpadVersions(context)) return;

  const own = scratchpadRepository(context);
  const id = randomUUID();

  db.prepare(
    "INSERT INTO reviews(id,version,next_id,project_id) SELECT ?,version,next_id,? FROM reviews WHERE id=?",
  ).run(
    id,
    own ? context.projectOfRepository(own) : context.fallbackProject(),
    OLD_SCRATCHPAD_ID,
  );

  let nextId = Number(
    db.prepare("SELECT next_id FROM reviews WHERE id=?").get(id)!.next_id,
  );

  const old = scratchpadVersions(context);

  // The run changes the snapshots it took; nothing parses them again.
  parsedPads.delete(context);

  // Every version moves over; one that no longer parses, as it is.
  db.prepare("UPDATE versions SET review_id=? WHERE review_id=?").run(
    id,
    OLD_SCRATCHPAD_ID,
  );

  for (const { version, snapshot } of old) {
    if (!snapshot) continue;

    delete snapshot.kind;

    snapshot.reviewId = id;
    snapshot.title = "Scratchpad";

    if (own) {
      snapshot.target = { kind: "project", repositoryId: own };
      snapshot.document = snapshots(
        context,
        own,
        snapshot.document,
        (prefix) => `${prefix}-${++nextId}`,
      );
    }

    context.rewriteVersion(id, version, snapshot);
  }

  db.prepare("UPDATE reviews SET next_id=? WHERE id=?").run(nextId, id);

  // Tables a store makes after its upgrades may not exist yet. A thread's
  // board is its review_id until ask-threads-by-project renames it, which
  // a development build may have done already.
  for (const [table, ...names] of [
    ["ask_conversations", "review_id", "anchor_board"],
    ["authoring_presences", "review_id"],
    ["review_coverage", "review_id"],
    ["review_attention", "review_id"],
  ]) {
    const columns = columnsOf(db, table!);
    const column = names.find((name) => columns.has(name));

    if (column)
      db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).run(
        id,
        OLD_SCRATCHPAD_ID,
      );
  }

  db.prepare("DELETE FROM reviews WHERE id=?").run(OLD_SCRATCHPAD_ID);
}
