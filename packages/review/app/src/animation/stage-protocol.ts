// Messages between an animation block and its sandboxed stage. They travel
// on a MessagePort the block hands the stage with the runtime's source, so
// nothing else on the page can speak on the channel.

import type { JsonValue } from "@dev.fast/json";
import { z } from "zod";

/** What the stage's script reads about one frame. */
export interface StageFrame {
  key: string;
  title: string;
  caption?: string;
  /** The frame's own state, for a script that draws each frame from it. */
  data?: JsonValue;
  /** The code names the frame lists. */
  code?: string[];
}

/** What the stage's script reads about one of a clip's markers. */
export interface StageMarker {
  key: string;
  title: string;
  caption?: string;
  /** The code names the marker lists. */
  code?: string[];
}

/** A placed marker: where it sits on the active timeline, in milliseconds. */
export interface PlacedMarker {
  key: string;
  at: number;
}

export type StageColorScheme = "light" | "dark";

/** The first message on the port: everything the stage needs to draw. */
export interface StageInit {
  type: "init";
  /** An animation's frames, stepped through, or a clip's one timeline,
   * played. */
  mode: "frames" | "clip";
  html: string;
  /** The style kit: the CSS every stage loads before its markup. */
  kit: string;
  autoSize: boolean;
  /** An animation's frames; empty for a clip. */
  frames: StageFrame[];
  /** A clip's markers, as declared; empty for an animation. */
  markers: StageMarker[];
  /** A clip's scenario keys, which whiteboard.clip() accepts. */
  scenarios: string[];
  /** The names whiteboard.code() accepts. */
  code: string[];
  /** What hovering an element that opens each code says. */
  codeTitles: Record<string, string>;
  /** The block ids whiteboard.block() accepts. */
  blocks: string[];
  /** Whiteboard theme values, set as --wb-* properties on the stage root. */
  theme: Record<string, string>;
  /** Whether that theme is light or dark, for the stage's color-scheme. */
  colorScheme: StageColorScheme;
  /** The canvas's scale steps, set as --wb-* properties like the theme. */
  scale: Record<string, string>;
  /** @font-face rules for the canvas's bundled faces, as data: URLs: the
   * stage is its own document and may load no font from elsewhere. */
  fonts: string;
  reducedMotion: boolean;
  /** The block arrived from the agent's stream: build the stage but keep it
   * unseen until a `paint` message, then paint the first frame in and post
   * `painted`. False on a cold load, in history and under reduced motion. */
  paint: boolean;
  frame: number;
  /** The scenario the reader picked: the frame keys the stage starts on. */
  sequence?: string[];
  /** The clip scenario the reader picked: the timeline the stage starts on. */
  scenario?: string;
  /** Library sources the stage runs before its own scripts: anime.js. */
  libraries: string[];
}

export type HostMessage =
  | StageInit
  | {
      type: "frame";
      index: number;
      instant: boolean;
      direction: "forward" | "backward" | "none";
      adjacent: boolean;
    }
  | {
      type: "theme";
      theme: Record<string, string>;
      colorScheme: StageColorScheme;
    }
  /** The height the host's content in a slot takes. */
  | { type: "slot-size"; slot: string; height: number }
  /** The reader picked a scenario: play these frame keys, in order. */
  | { type: "sequence"; keys: string[] }
  /** The board's turn to draw this block came: paint the first frame in. */
  | { type: "paint" }
  /** A clip: play from the playhead, or from the start at the end. */
  | { type: "play" }
  | { type: "pause" }
  /** A clip: land on a marker, still playing if it was. */
  | { type: "seek"; marker: string }
  /** A clip: the reader picked a scenario, a timeline of its own. */
  | { type: "scenario"; key: string };

/** The tallest an auto-sized stage may report itself. */
export const STAGE_MAX_HEIGHT = 4000;

/** The most code and block placeholders a stage may lay out. */
export const STAGE_MAX_SLOTS = 200;

/** How far from the stage's origin a placeholder may sit, either way. */
export const SLOT_MAX_OFFSET = 100_000;

/** The widest and tallest a placeholder may be. */
export const SLOT_MAX_SIZE = 20_000;

/** Where one placeholder sits in the stage, so the host can draw over it. */
const slotLayoutSchema = z.strictObject({
  slot: z.string(),
  kind: z.enum(["code", "block"]),
  /** The code name or block id. */
  ref: z.string(),
  x: z.number().min(-SLOT_MAX_OFFSET).max(SLOT_MAX_OFFSET),
  y: z.number().min(-SLOT_MAX_OFFSET).max(SLOT_MAX_OFFSET),
  width: z.number().min(0).max(SLOT_MAX_SIZE),
  height: z.number().min(0).max(SLOT_MAX_SIZE),
  /** The product of the placeholder's and its ancestors' opacity. */
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
});

export type SlotLayout = z.infer<typeof slotLayoutSchema>;

/** The stage runs an agent's scripts, so the host parses what it sends. */
export const stageMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ready") }),
  z.strictObject({
    type: z.literal("size"),
    height: z.number().finite().nonnegative().max(STAGE_MAX_HEIGHT),
  }),
  z.strictObject({
    type: z.literal("slots"),
    slots: z.array(slotLayoutSchema).max(STAGE_MAX_SLOTS),
  }),
  /** Every animation the frame started has finished. */
  z.strictObject({ type: z.literal("settled"), index: z.number().int() }),
  /** A clip's timeline is built: its length and every placed marker, by
   * time. Sent again on a scenario change. */
  z.strictObject({
    type: z.literal("clip"),
    duration: z.number().finite().nonnegative(),
    markers: z
      .array(
        z.strictObject({
          key: z.string(),
          at: z.number().finite().nonnegative(),
        }),
      )
      .max(60),
  }),
  /** A clip's playhead, while it plays and whenever it stops or jumps. */
  z.strictObject({
    type: z.literal("time"),
    at: z.number().finite().nonnegative(),
    playing: z.boolean(),
  }),
  /** A clip's playhead reached this marker. */
  z.strictObject({ type: z.literal("marker"), key: z.string() }),
  /** A clip played to its end and paused there. */
  z.strictObject({ type: z.literal("ended") }),
  /** The first frame has painted in, after a `paint` message. */
  z.strictObject({ type: z.literal("painted") }),
  z.strictObject({ type: z.literal("goto"), key: z.string() }),
  z.strictObject({ type: z.literal("step"), delta: z.literal([-1, 1]) }),
  z.strictObject({
    type: z.literal("sequence"),
    keys: z.array(z.string()).min(1).max(60),
  }),
  z.strictObject({ type: z.literal("reveal"), name: z.string() }),
  z.strictObject({
    type: z.literal("error"),
    message: z.string().max(2000),
  }),
]);

export type StageMessage = z.infer<typeof stageMessageSchema>;

/** The bootstrap message the stage page waits for, with the port. */
export const STAGE_BOOT = "whiteboard-stage";
