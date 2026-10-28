import {
  type EditSummary,
  documentSchema,
  editSchema,
} from "@dev.fast/whiteboard-document";
import { z } from "zod";

/** WebSocket subprotocol: the browser offers `[BOARD_PROTOCOL, jwt]`; the server echoes it. */
export const BOARD_PROTOCOL = "board.v1";

/** Loose so a newer server's fields pass. */
// SAFETY: written by summarizeEdit; every field the canvas reads is checked.
export const editSummarySchema = z
  .looseObject({
    type: z.string(),
    targetId: z.string(),
    blockId: z.string(),
    kind: z.string(),
    unit: z.string().optional(),
    linkId: z.string().optional(),
    fields: z.array(z.string()).optional(),
    units: z.array(z.string()).optional(),
    activityId: z.string().optional(),
    threadId: z.string().optional(),
  })
  .transform((summary) => summary as EditSummary);

const focusSchema = z.object({
  description: z.string(),
  targetId: z.string().optional(),
});

export const activitySnapshotSchema = z.object({
  workingCount: z.number(),
  expiresAt: z.number().nullable(),
  activities: z
    .array(
      z.object({
        activityId: z.string(),
        slot: z.number(),
        focus: focusSchema.optional(),
        surface: z.enum(["document", "lenses"]).optional(),
      }),
    )
    .optional(),
});

export type ActivitySnapshotWire = z.infer<typeof activitySnapshotSchema>;

export const boardSnapshotSchema = z.object({
  reviewId: z.string(),
  version: z.number(),
  title: z.string(),
  document: documentSchema,
  createdAt: z.string(),
  lastEdit: editSummarySchema.optional(),
});

export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;

export const boardLineSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("snapshot"),
    seq: z.number(),
    nextId: z.number(),
    snapshot: boardSnapshotSchema,
    activity: activitySnapshotSchema,
  }),
  z.object({
    kind: z.literal("op"),
    seq: z.number(),
    edit: editSchema,
    nextId: z.number(),
    summary: editSummarySchema.optional(),
    activityId: z.string().optional(),
    author: z.string(),
    at: z.number(),
    activity: activitySnapshotSchema,
  }),
  z.object({ kind: z.literal("activity"), activity: activitySnapshotSchema }),
  z.object({ kind: z.literal("title"), title: z.string() }),
]);

export type BoardLine = z.infer<typeof boardLineSchema>;

/** The server sets the author from the caller's token. */
export const editRequestSchema = z.object({
  edit: editSchema,
  /** The head the caller last saw: a different head is refused. */
  baseSeq: z.number().int().nonnegative().optional(),
  activityId: z.string().min(1).optional(),
  /** Idempotency key: a retry with the same id gets the first answer. */
  requestId: z.string().min(1).max(128).optional(),
});

export type EditRequest = z.infer<typeof editRequestSchema>;

export const editResultSchema = z.object({
  seq: z.number(),
  applied: z.object({
    targetId: z.string(),
    type: z.string(),
    children: z
      .array(z.object({ id: z.string(), type: z.string() }))
      .optional(),
    linkId: z.string().optional(),
  }),
  /** True when a retried requestId got its first answer back. */
  replayed: z.boolean().optional(),
});

export type EditResult = z.infer<typeof editResultSchema>;

/** Upserts by `activityId` (minted when omitted); `focus: null` clears, `end` removes. */
export const presenceRequestSchema = z.object({
  activityId: z.string().min(1).optional(),
  focus: z
    .strictObject({
      description: z.string().trim().min(1).max(160),
      targetId: z.string().min(1).optional(),
    })
    .nullable()
    .optional(),
  end: z.boolean().optional(),
});

export type PresenceRequest = z.infer<typeof presenceRequestSchema>;

export const presenceResultSchema = activitySnapshotSchema.extend({
  activityId: z.string().optional(),
});

export type PresenceResult = z.infer<typeof presenceResultSchema>;

export const titleRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export type TitleRequest = z.infer<typeof titleRequestSchema>;

export const boardReadSchema = boardSnapshotSchema.extend({
  nextId: z.number(),
  activity: activitySnapshotSchema,
});

export type BoardRead = z.infer<typeof boardReadSchema>;

export const createBoardRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  organizationId: z.string().min(1).optional(),
});

export type CreateBoardRequest = z.infer<typeof createBoardRequestSchema>;

export const createBoardResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  organizationId: z.string(),
  version: z.number(),
});

export type CreateBoardResult = z.infer<typeof createBoardResultSchema>;
