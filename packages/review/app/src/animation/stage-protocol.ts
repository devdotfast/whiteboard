// Messages between an animation block and its sandboxed stage. They travel
// on a MessagePort the block hands the stage with the runtime's source, so
// nothing else on the page can speak on the channel.

import { z } from "zod";

/** What the stage's script reads about one frame. */
export interface StageFrame {
  key: string;
  title: string;
  caption?: string;
}

/** The first message on the port: everything the stage needs to draw. */
export interface StageInit {
  type: "init";
  html: string;
  frames: StageFrame[];
  /** The names whiteboard.code() accepts. */
  code: string[];
  /** The block ids whiteboard.block() accepts. */
  blocks: string[];
  /** Whiteboard theme values, set as --wb-* properties on the stage root. */
  theme: Record<string, string>;
  reducedMotion: boolean;
  frame: number;
  /** Library sources the stage runs before its own scripts: anime.js. */
  libraries: string[];
}

export type HostMessage =
  | StageInit
  | { type: "frame"; index: number; instant: boolean }
  | { type: "theme"; theme: Record<string, string> }
  /** The height the host's content in a slot takes. */
  | { type: "slot-size"; slot: string; height: number };

/** Where one placeholder sits in the stage, so the host can draw over it. */
const slotLayoutSchema = z.strictObject({
  slot: z.string(),
  kind: z.enum(["code", "block"]),
  /** The code name or block id. */
  ref: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  /** The product of the placeholder's and its ancestors' opacity. */
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
});

export type SlotLayout = z.infer<typeof slotLayoutSchema>;

/** The stage runs an agent's scripts, so the host parses what it sends. */
export const stageMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ready") }),
  z.strictObject({
    type: z.literal("slots"),
    slots: z.array(slotLayoutSchema).max(200),
  }),
  /** Every animation the frame started has finished. */
  z.strictObject({ type: z.literal("settled"), index: z.number().int() }),
  z.strictObject({ type: z.literal("goto"), key: z.string() }),
  z.strictObject({ type: z.literal("step"), delta: z.literal([-1, 1]) }),
  z.strictObject({ type: z.literal("reveal"), name: z.string() }),
  z.strictObject({
    type: z.literal("error"),
    message: z.string().max(2000),
  }),
]);

export type StageMessage = z.infer<typeof stageMessageSchema>;

/** The bootstrap message the stage page waits for, with the port. */
export const STAGE_BOOT = "whiteboard-stage";
