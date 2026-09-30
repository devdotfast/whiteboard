import type { DatabaseSync } from "node:sqlite";

import {
  type AskAgentId,
  type AskChoices,
  type AskEntry,
  type AskHistoryEntry,
  askChoicesSchema,
  askEntrySchema,
  askHistoryEntrySchema,
} from "@review/ask/thread-state.js";
import { z } from "zod";

/** A saved Ask conversation: its history entry, and how to reopen it. */
export const askRecordSchema = askHistoryEntrySchema.extend({
  reviewId: z.string(),
  /** The ACP session the agent keeps the transcript under. */
  sessionId: z.string(),
  /** The review version asked about; its pins recreate the checkout. */
  version: z.number().int(),
  cwd: z.string(),
  /** What the panel showed last; absent until a turn ends or it closes. */
  entries: z.array(askEntrySchema).optional(),
});

export type AskRecord = z.infer<typeof askRecordSchema>;

const rowSchema = z
  .object({
    id: z.string(),
    review_id: z.string(),
    agent: z.string(),
    session_id: z.string(),
    version: z.number(),
    head: z.string(),
    cwd: z.string(),
    selection: z.string(),
    title: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    entries: z.string().nullable(),
  })
  .transform((row) =>
    askRecordSchema.parse({
      id: row.id,
      reviewId: row.review_id,
      agent: row.agent,
      sessionId: row.session_id,
      version: row.version,
      head: row.head,
      cwd: row.cwd,
      selection: JSON.parse(row.selection),
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      entries: row.entries === null ? undefined : JSON.parse(row.entries),
    }),
  );

/** Saved Ask conversations, per review. Shared reviews are not in
 * `reviews`, so there is no foreign key; deleting a review deletes its rows. */
export class AskHistory {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS ask_conversations(
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      session_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      head TEXT NOT NULL,
      cwd TEXT NOT NULL,
      selection TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      entries TEXT,
      UNIQUE(agent, session_id));
    CREATE INDEX IF NOT EXISTS ask_conversations_review ON ask_conversations(review_id, updated_at);`);

    // What each agent offered last, so a new question can pick a model and
    // effort before its agent starts.
    db.exec(
      "CREATE TABLE IF NOT EXISTS ask_agent_choices(agent TEXT PRIMARY KEY, choices TEXT NOT NULL)",
    );
  }

  save(record: AskRecord) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ask_conversations(id,review_id,agent,session_id,version,head,cwd,selection,title,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        record.id,
        record.reviewId,
        record.agent,
        record.sessionId,
        record.version,
        record.head,
        record.cwd,
        JSON.stringify(record.selection),
        record.title,
        record.createdAt,
        record.updatedAt,
      );
  }

  /** Points a conversation at a new session, when its agent could not
   * reopen the one it had. */
  updateSession(id: string, sessionId: string) {
    this.db
      .prepare("UPDATE ask_conversations SET session_id=? WHERE id=?")
      .run(sessionId, id);
  }

  /** Keeps what the panel shows, so a reopen need not wait on the agent. */
  saveEntries(id: string, entries: AskEntry[]) {
    this.db
      .prepare("UPDATE ask_conversations SET entries=? WHERE id=?")
      .run(JSON.stringify(entries), id);
  }

  saveChoices(agent: AskAgentId, choices: AskChoices) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO ask_agent_choices(agent, choices) VALUES(?, ?)",
      )
      .run(agent, JSON.stringify(choices));
  }

  choices(agent: AskAgentId): AskChoices | undefined {
    const row = z
      .object({ choices: z.string() })
      .safeParse(
        this.db
          .prepare("SELECT choices FROM ask_agent_choices WHERE agent=?")
          .get(agent),
      ).data;

    return row && askChoicesSchema.safeParse(JSON.parse(row.choices)).data;
  }

  touch(id: string, at = new Date().toISOString()) {
    this.db
      .prepare("UPDATE ask_conversations SET updated_at=? WHERE id=?")
      .run(at, id);
  }

  /** Newest first. */
  list(reviewId: string): AskHistoryEntry[] {
    return this.db
      .prepare(
        "SELECT * FROM ask_conversations WHERE review_id=? ORDER BY updated_at DESC",
      )
      .all(reviewId)
      .map((row) => {
        const {
          reviewId: _reviewId,
          sessionId: _sessionId,
          version: _version,
          cwd: _cwd,
          entries: _entries,
          ...entry
        } = rowSchema.parse(row);

        return entry;
      });
  }

  get(id: string): AskRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM ask_conversations WHERE id=?")
      .get(id);

    return row ? rowSchema.parse(row) : undefined;
  }

  delete(id: string) {
    this.db.prepare("DELETE FROM ask_conversations WHERE id=?").run(id);
  }
}
