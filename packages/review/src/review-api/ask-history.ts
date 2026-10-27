import type { DatabaseSync } from "node:sqlite";

import {
  type AskAgentId,
  type AskEntry,
  type AskHistoryEntry,
  type AskOffer,
  type AskPermissions,
  askEntrySchema,
  askHistoryEntrySchema,
  askOfferSchema,
  askPermissionsSchema,
} from "@review/ask/thread-state.js";
import { z } from "zod";

import { ReviewInputError } from "./document.js";

/** A saved Ask conversation: its history entry, and how to reopen it. */
export const askRecordSchema = askHistoryEntrySchema.extend({
  /** The board the conversation started on, and the block if any. */
  anchor: z.object({ board: z.string(), block: z.string().optional() }),
  /** Absent for a shared board. */
  projectId: z.string().optional(),
  /** The ACP session the agent keeps the transcript under. */
  sessionId: z.string(),
  /** The review version asked about; its pins recreate the checkout. */
  version: z.number().int(),
  cwd: z.string(),
  /** What the panel showed last; absent until a turn ends or it closes. */
  entries: z.array(askEntrySchema).optional(),
  /** What the agent may do without asking, when it reopens. */
  permissions: askPermissionsSchema.optional(),
});

export type AskRecord = z.infer<typeof askRecordSchema>;

const rowSchema = z
  .object({
    id: z.string(),
    anchor_board: z.string(),
    anchor_block: z.string().nullable(),
    project_id: z.string().nullable(),
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
    bypass: z.number(),
    permissions: z.string().nullable(),
  })
  .transform((row) =>
    askRecordSchema.parse({
      id: row.id,
      anchor:
        row.anchor_block === null
          ? { board: row.anchor_board }
          : { board: row.anchor_board, block: row.anchor_block },
      projectId: row.project_id ?? undefined,
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
      // Saved before auto mode: bypassing permissions, or read-only.
      permissions:
        row.permissions ?? (row.bypass === 1 ? "bypass" : "read-only"),
    }),
  );

/** A thread's project is always its anchor board's. */
const THREAD_PROJECT_SQL =
  "(SELECT project_id FROM reviews WHERE reviews.id=ask_conversations.anchor_board)";

/** Every column of a thread, with its project. */
const THREAD_COLUMNS = `ask_conversations.*, ${THREAD_PROJECT_SQL} AS project_id`;

/** Saved Ask conversations by project, each anchored on the board it started
 * on. Deleting a board removes its threads by hand (removeReview). */
export class AskHistory {
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly db: DatabaseSync,
    /** The store's rule for writing about a board: one in Trash is
     * read-only. */
    private readonly writable: (reviewId: string) => void = () => {},
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS ask_conversations(
      id TEXT PRIMARY KEY,
      anchor_board TEXT NOT NULL,
      anchor_block TEXT,
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
      bypass INTEGER NOT NULL DEFAULT 0,
      permissions TEXT,
      viewed_at TEXT,
      UNIQUE(agent, session_id));`);

    db.exec(
      "CREATE INDEX IF NOT EXISTS ask_conversations_review ON ask_conversations(anchor_board, updated_at)",
    );

    // What each agent offered last, so a new question can pick a model and
    // effort, and a command, before its agent starts.
    db.exec(
      "CREATE TABLE IF NOT EXISTS ask_agent_offers(agent TEXT PRIMARY KEY, offer TEXT NOT NULL)",
    );
    // And with each model it ran, since the efforts on offer depend on it.
    db.exec(
      "CREATE TABLE IF NOT EXISTS ask_agent_model_offers(agent TEXT NOT NULL, model TEXT NOT NULL, offer TEXT NOT NULL, PRIMARY KEY(agent, model))",
    );
  }

  /** Calls back when a conversation is saved, renamed, used or deleted. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  private assertThreadWritable(id: string) {
    const record = this.get(id);

    if (record) this.writable(record.anchor.board);
  }
  save(record: AskRecord) {
    this.writable(record.anchor.board);
    this.db
      .prepare(
        // Its columns, not the row: when it was last seen, and what the
        // panel showed, stay.
        `INSERT INTO ask_conversations(id,anchor_board,anchor_block,agent,session_id,version,head,cwd,selection,title,created_at,updated_at,bypass,permissions)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET anchor_board=excluded.anchor_board, anchor_block=excluded.anchor_block,
          agent=excluded.agent, session_id=excluded.session_id, version=excluded.version, head=excluded.head,
          cwd=excluded.cwd, selection=excluded.selection, title=excluded.title, created_at=excluded.created_at,
          updated_at=excluded.updated_at, bypass=excluded.bypass, permissions=excluded.permissions`,
      )
      .run(
        record.id,
        record.anchor.board,
        record.anchor.block ?? null,
        record.agent,
        record.sessionId,
        record.version,
        record.head,
        record.cwd,
        JSON.stringify(record.selection),
        record.title,
        record.createdAt,
        record.updatedAt,
        record.permissions === "bypass" ? 1 : 0,
        record.permissions ?? null,
      );
    this.changed();
  }

  /** What the agent may do without asking when the conversation reopens. */
  setPermissions(id: string, permissions: AskPermissions) {
    this.assertThreadWritable(id);
    this.db
      .prepare(
        "UPDATE ask_conversations SET bypass=?, permissions=? WHERE id=?",
      )
      .run(permissions === "bypass" ? 1 : 0, permissions, id);
  }

  /** Points a conversation at a new session, when its agent could not
   * reopen the one it had. */
  updateSession(id: string, sessionId: string) {
    this.assertThreadWritable(id);
    this.db
      .prepare("UPDATE ask_conversations SET session_id=? WHERE id=?")
      .run(sessionId, id);
  }

  /** Keeps what the panel shows, so a reopen need not wait on the agent. */
  saveEntries(id: string, entries: AskEntry[]) {
    this.assertThreadWritable(id);
    this.db
      .prepare("UPDATE ask_conversations SET entries=? WHERE id=?")
      .run(JSON.stringify(entries), id);
    this.changed();
  }

  /** The agent's name for the conversation, which the list shows. */
  rename(id: string, title: string) {
    this.assertThreadWritable(id);
    this.db
      .prepare("UPDATE ask_conversations SET title=? WHERE id=?")
      .run(title.slice(0, 200), id);
    this.changed();
  }

  saveOffer(agent: AskAgentId, offer: AskOffer) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO ask_agent_offers(agent, offer) VALUES(?, ?)",
      )
      .run(agent, JSON.stringify(offer));
    this.saveModelOffer(agent, offer);
  }

  /** Keeps what the agent offers with the offer's model, without making
   * it what the agent offered last. */
  saveModelOffer(agent: AskAgentId, offer: AskOffer) {
    const model = offer.choices.model?.current;

    if (!model) return;
    this.db
      .prepare(
        "INSERT OR REPLACE INTO ask_agent_model_offers(agent, model, offer) VALUES(?, ?, ?)",
      )
      .run(agent, model, JSON.stringify(offer));
  }

  /** What the agent offered last, or last with the model given. */
  offer(agent: AskAgentId, model?: string): AskOffer | undefined {
    const row = z
      .object({ offer: z.string() })
      .safeParse(
        model === undefined
          ? this.db
              .prepare("SELECT offer FROM ask_agent_offers WHERE agent=?")
              .get(agent)
          : this.db
              .prepare(
                "SELECT offer FROM ask_agent_model_offers WHERE agent=? AND model=?",
              )
              .get(agent, model),
      ).data;

    return row && askOfferSchema.safeParse(JSON.parse(row.offer)).data;
  }

  touch(id: string, at = new Date().toISOString()) {
    this.assertThreadWritable(id);
    this.db
      .prepare("UPDATE ask_conversations SET updated_at=? WHERE id=?")
      .run(at, id);
    this.changed();
  }

  /** Conversations in a board's project, or started on the board when it
   * has none. Newest first. */
  list(board: string, projectId?: string) {
    // The project's boards by their index on project_id, then their
    // threads by ask_conversations_review.
    return this.entries(
      "anchor_board=? OR anchor_board IN (SELECT id FROM reviews WHERE project_id=?)",
      board,
      projectId ?? null,
    );
  }

  /** Every project's conversations, newest first. */
  listAll() {
    return this.entries("1");
  }

  private entries(
    where: string,
    ...params: (string | null)[]
  ): (AskHistoryEntry & { projectId?: string; viewedAt?: string })[] {
    // A transcript can be long: SQLite finds its first question, and the
    // rest of it is left unread.
    return this.db
      .prepare(
        `SELECT id, anchor_board, anchor_block, ${THREAD_PROJECT_SQL} AS project_id, agent, session_id, version, head, cwd, selection, title,
          created_at, updated_at, NULL AS entries, bypass, permissions, viewed_at,
          (SELECT json_extract(value,'$.text') FROM json_each(entries)
            WHERE json_extract(value,'$.kind')='user' LIMIT 1) AS question
        FROM ask_conversations WHERE ${where} ORDER BY updated_at DESC`,
      )
      .all(...params)
      .map((row) => {
        const {
          anchor,
          sessionId: _sessionId,
          version: _version,
          cwd: _cwd,
          entries: _entries,
          permissions: _permissions,
          ...entry
        } = rowSchema.parse(row);

        const question = z.string().nullable().parse(row.question) ?? "";

        if (question.trim()) entry.question = question;

        const viewedAt = z.string().nullable().parse(row.viewed_at);

        return { ...entry, anchor, ...(viewedAt !== null && { viewedAt }) };
      });
  }

  get(id: string): AskRecord | undefined {
    const row = this.db
      .prepare(`SELECT ${THREAD_COLUMNS} FROM ask_conversations WHERE id=?`)
      .get(id);

    return row ? rowSchema.parse(row) : undefined;
  }

  /** The reviewer saw the thread, on screen with the app focused. Only
   * when it was seen changes: not its order, nor when it was used. */
  markViewed(id: string, at = new Date().toISOString()) {
    this.db
      .prepare("UPDATE ask_conversations SET viewed_at=? WHERE id=?")
      .run(at, id);
    this.changed();
  }

  /** Forgets the threads that started on a board gone for good. */
  removeReview(reviewId: string) {
    this.db
      .prepare("DELETE FROM ask_conversations WHERE anchor_board=?")
      .run(reviewId);
    this.changed();
  }

  delete(id: string) {
    this.assertThreadWritable(id);
    this.db.prepare("DELETE FROM ask_conversations WHERE id=?").run(id);
    this.changed();
  }
}
