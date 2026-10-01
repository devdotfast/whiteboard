import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { ReviewInputError } from "./document.js";

const focusSchema = z.strictObject({
  description: z.string().trim().min(1).max(160),
  targetId: z.string().min(1).optional(),
});

/** Which page an agent last wrote on, so the app knows where its courier is. */
export type ActivitySurface = "document" | "lenses";

// One schema per action, so each agent tool states exactly what it needs.
export const activityBeginSchema = z.strictObject({
  focus: focusSchema.nullable().optional(),
});

export const activityUpdateSchema = z.strictObject({
  activityId: z.string().min(1),
  focus: focusSchema.nullable().optional(),
});

export const activityEndSchema = z.strictObject({
  activityId: z.string().min(1),
});

export const activitySchema = z.discriminatedUnion("action", [
  activityBeginSchema.extend({ action: z.literal("begin") }),
  activityUpdateSchema.extend({ action: z.literal("update") }),
  activityEndSchema.extend({ action: z.literal("end") }),
]);

export type ActivityFocus = z.infer<typeof focusSchema>;

/** One agent working on a review. */
export interface ActivityPresence {
  activityId: string;
  /** The agent's color: the lowest slot free when it began, kept until it ends. */
  slot: number;
  focus?: ActivityFocus;
  /** Where it last wrote; absent until its first attributed write. */
  surface?: ActivitySurface;
}

export interface ActivitySnapshot {
  /** Live presences. */
  workingCount: number;
  /** The latest expiry among live presences. */
  expiresAt: number | null;
  /** Each live presence, in the order they began. */
  activities?: ActivityPresence[];
}

// A presence lasts until end, or three minutes without an attributed write or
// an update, so a crashed agent stops showing within that long.
export const ACTIVITY_TTL_MS = 180_000;

export class ReviewActivity {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<(reviewId: string) => void>();
  private readonly working = new Set<string>();
  private readonly workingListeners = new Set<() => void>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly assertReview?: (reviewId: string) => void,
  ) {
    // Presences replace the per-scope leases; both last minutes, so the old
    // table is dropped rather than migrated.
    db.exec(`CREATE TABLE IF NOT EXISTS authoring_presences(
      activity_id TEXT PRIMARY KEY, review_id TEXT NOT NULL, slot INTEGER NOT NULL,
      started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, focus TEXT, surface TEXT);
      DROP TABLE IF EXISTS authoring_sessions;`);

    for (const row of db
      .prepare(
        "SELECT DISTINCT review_id FROM authoring_presences WHERE expires_at>?",
      )
      .all(Date.now())) {
      this.working.add(String(row.review_id));
      this.scheduleExpiry(String(row.review_id));
    }
  }
  subscribe(listener: (reviewId: string) => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Fires only when a review starts or stops being authored, never on
   * renewals or focus changes. */
  subscribeWorking(listener: () => void) {
    this.workingListeners.add(listener);

    return () => {
      this.workingListeners.delete(listener);
    };
  }
  isWorking(reviewId: string) {
    return this.working.has(reviewId);
  }
  private changed(reviewId: string) {
    const working =
      this.db
        .prepare(
          "SELECT 1 FROM authoring_presences WHERE review_id=? AND expires_at>? LIMIT 1",
        )
        .get(reviewId, Date.now()) !== undefined;

    if (working !== this.working.has(reviewId)) {
      if (working) this.working.add(reviewId);
      else this.working.delete(reviewId);

      for (const notify of this.workingListeners) notify();
    }

    for (const notify of this.listeners) notify(reviewId);
  }
  private live(reviewId: string) {
    return this.db
      .prepare(
        "SELECT activity_id,slot,expires_at,focus,surface FROM authoring_presences WHERE review_id=? AND expires_at>? ORDER BY rowid",
      )
      .all(reviewId, Date.now());
  }

  read(reviewId: string): ActivitySnapshot {
    const live = this.live(reviewId);

    const snapshot: ActivitySnapshot = {
      workingCount: live.length,
      expiresAt: live.length
        ? Math.max(...live.map((row) => Number(row.expires_at)))
        : null,
    };

    if (live.length)
      snapshot.activities = live.map((row) => {
        const presence: ActivityPresence = {
          activityId: String(row.activity_id),
          slot: Number(row.slot),
        };

        if (row.focus)
          presence.focus = focusSchema.parse(JSON.parse(String(row.focus)));

        if (row.surface === "document" || row.surface === "lenses")
          presence.surface = row.surface;

        return presence;
      });

    return snapshot;
  }

  /** Inside the caller's write transaction: the presence a write belongs to,
   * renewed and moved to the write's surface. The named one if it is live;
   * otherwise, with none named, the review's only presence. A write is never
   * refused for this. Call `extended` once the transaction commits. */
  attribute(
    reviewId: string,
    surface: ActivitySurface,
    activityId?: string,
  ): string | undefined {
    const live = this.live(reviewId);

    const owner =
      activityId === undefined
        ? live.length === 1
          ? String(live[0]!.activity_id)
          : undefined
        : live.some((row) => row.activity_id === activityId)
          ? activityId
          : undefined;

    if (owner === undefined) return undefined;
    this.db
      .prepare(
        "UPDATE authoring_presences SET expires_at=?,surface=? WHERE activity_id=?",
      )
      .run(Date.now() + ACTIVITY_TTL_MS, surface, owner);

    return owner;
  }

  /** Move the expiry timer after a committed `attribute`. */
  extended(reviewId: string) {
    this.scheduleExpiry(reviewId);
    this.changed(reviewId);
  }
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Activity boundary: activitySchema.parse below validates incoming JSON.
  update(reviewId: string, value: unknown) {
    const input = activitySchema.parse(value);
    const now = Date.now();

    let activityId: string;

    this.db.exec("BEGIN IMMEDIATE");

    try {
      this.assertReview?.(reviewId);

      if (input.action === "begin") {
        activityId = randomUUID();

        const taken = new Set(
          this.live(reviewId).map((row) => Number(row.slot)),
        );

        let slot = 0;

        while (taken.has(slot)) slot += 1;
        this.db
          .prepare(
            "INSERT INTO authoring_presences(activity_id,review_id,slot,started_at,expires_at,focus) VALUES(?,?,?,?,?,?)",
          )
          .run(
            activityId,
            reviewId,
            slot,
            now,
            now + ACTIVITY_TTL_MS,
            input.focus ? JSON.stringify(input.focus) : null,
          );
      } else {
        activityId = input.activityId;

        if (input.action === "end") {
          // Ending twice, or ending an expired presence, is harmless.
          this.db
            .prepare(
              "DELETE FROM authoring_presences WHERE activity_id=? AND review_id=?",
            )
            .run(activityId, reviewId);
        } else {
          const renewed = this.db
            .prepare(
              `UPDATE authoring_presences SET expires_at=?${input.focus === undefined ? "" : ",focus=?"}
              WHERE activity_id=? AND review_id=? AND expires_at>?`,
            )
            .run(
              ...[
                now + ACTIVITY_TTL_MS,
                ...(input.focus === undefined
                  ? []
                  : [
                      input.focus === null ? null : JSON.stringify(input.focus),
                    ]),
                activityId,
                reviewId,
                now,
              ],
            );

          if (renewed.changes === 0)
            throw new ReviewInputError(
              "This activity ended or expired. Begin a new one.",
              409,
            );
        }
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    this.scheduleExpiry(reviewId);

    this.changed(reviewId);

    const result: ActivitySnapshot & { activityId?: string } =
      this.read(reviewId);

    if (input.action === "begin") result.activityId = activityId;

    return result;
  }

  /** One timer per review, for its soonest-expiring presence. */
  private scheduleExpiry(reviewId: string) {
    clearTimeout(this.timers.get(reviewId));
    this.timers.delete(reviewId);

    const next = this.db
      .prepare(
        "SELECT MIN(expires_at) AS expires_at FROM authoring_presences WHERE review_id=? AND expires_at>?",
      )
      .get(reviewId, Date.now());

    if (next?.expires_at === null || next?.expires_at === undefined) return;

    const timer = setTimeout(
      () => {
        this.scheduleExpiry(reviewId);
        this.changed(reviewId);
      },
      Math.max(1, Number(next.expires_at) - Date.now()),
    );

    timer.unref?.();
    this.timers.set(reviewId, timer);
  }

  /** Called when another database connection commits session changes. */
  refresh() {
    const ids = new Set(this.timers.keys());

    for (const row of this.db
      .prepare(
        "SELECT DISTINCT review_id FROM authoring_presences WHERE expires_at>?",
      )
      .all(Date.now()))
      ids.add(String(row.review_id));

    for (const id of ids) {
      this.scheduleExpiry(id);
      this.changed(id);
    }
  }

  /** The store deletes the session atomically with its review before notifying. */
  deleted(reviewId: string) {
    clearTimeout(this.timers.get(reviewId));
    this.timers.delete(reviewId);
    this.changed(reviewId);
  }
  close() {
    this.listeners.clear();
    this.workingListeners.clear();

    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
