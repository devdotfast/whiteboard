import { z } from "zod";

export const focusSchema = z.strictObject({
  description: z.string().trim().min(1).max(160),
  targetId: z.string().min(1).optional(),
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
}

export interface ActivitySnapshot {
  /** Live presences. */
  workingCount: number;
  /** The latest expiry among live presences. */
  expiresAt: number | null;
  /** Each live presence, in the order they began. */
  activities?: ActivityPresence[];
}
