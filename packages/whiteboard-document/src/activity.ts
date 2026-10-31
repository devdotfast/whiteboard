import { z } from "zod";

export const focusSchema = z.strictObject({
  description: z.string().trim().min(1).max(160),
  targetId: z.string().min(1).optional(),
});

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

/** Which page an agent last wrote on, so the app knows where its courier is. */
export type ActivitySurface = "document" | "lenses";

export type ActivityFocus = z.infer<typeof focusSchema>;

/** One agent working on a review. */
export interface ActivityPresence {
  activityId: string;
  /** The agent's color: the lowest slot free when it began, kept until it ends. */
  slot: number;
  focus?: ActivityFocus;
  /** Where it last wrote; absent until its first attributed write. */
  surface?: ActivitySurface;
  /** Blocks reserved for it; others' edits on them or inside them are refused. */
  hold?: string[];
}

export interface ActivitySnapshot {
  /** Live presences. */
  workingCount: number;
  /** The latest expiry among live presences. */
  expiresAt: number | null;
  /** Each live presence, in the order they began. */
  activities?: ActivityPresence[];
}
