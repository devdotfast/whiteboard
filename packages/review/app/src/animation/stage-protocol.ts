// Messages between an animation block and its sandboxed stage. They travel
// on a MessagePort the block hands the stage with the runtime's source, so
// nothing else on the page can speak on the channel.

import type { JsonValue } from "@dev.fast/json";
import * as z from "zod";

/** What the stage's script reads about one frame. */
export interface StageFrame {
  key: string;
  title: string;
  /** The word or two on the step bar. */
  label?: string;
  caption?: string;
  /** The frame's own state, for a script that draws each frame from it. */
  data?: JsonValue;
  /** The code names the frame lists. */
  code?: string[];
  /** A diagram frame's movements: tokens the stage sends along wires. */
  moves?: StageMove[];
}

/** One movement in a diagram's step, between two nodes by id. */
export interface StageMove {
  from: string;
  to: string;
  /** The wire it rides, by id, when two join the same nodes. */
  edge?: string;
  /** The move goes wrong: its token is drawn as an error. */
  failed?: boolean;
  /** The message never arrives: its token stops halfway, faded. */
  lost?: boolean;
  label?: string;
  reply?: boolean;
  delay?: number;
}

/** What a diagram's stage needs besides what every stage gets. */
export interface DiagramStage {
  /** The markup and styles placed in the stage before the script runs. */
  html?: string;
  /** The JavaScript module that draws with `wb`. */
  script?: string;
  /** Space around the drawing, in CSS pixels. */
  inset: number;
  /** The least size a hand-placed drawing gave; the stage grows to what is
   * drawn. */
  size?: { width?: number; height?: number };
  /** How wide the board's column is, in CSS pixels, or 0 when unknown. */
  room: number;
  /** Each scenario's key, label and frame keys, for `wb.scenario`. */
  scenarios: { key: string; label: string; frames: string[] }[];
  /** A played diagram's chapters, in order; empty for one with frames. */
  chapters: {
    key: string;
    title: string;
    caption?: string;
    duration: number;
    code?: string[];
  }[];
}

/** A library a diagram's stage loads on first use. */

/** Splits three.js's source into its core and its module, which imports
 * the core: the stage loads each from a blob of its own. */
export const THREE_SPLIT = "\n/*wb:three.module*/\n";

export type StageLibrary = "elk" | "plot" | "three";

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
  /** A hidden copy that steps through every frame of its scenario and
   * reports the tallest, so the stage the reader sees can take that height
   * before they reach it. */
  measure?: boolean;
  /** The heights the host's content takes in each slot, for a measuring
   * copy, which has no content of its own drawn over it. */
  slotSizes?: Record<string, number>;
  /** Set for a diagram, whose stage runs `wb` instead of html. */
  diagram?: DiagramStage;
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
  /** A diagram's timeline: move the playhead to `at` milliseconds, still
   * playing if it was. */
  | { type: "scrub"; at: number }
  /** A clip: the reader picked a scenario, a timeline of its own. */
  | { type: "scenario"; key: string }
  /** A diagram: play the step's moves again. */
  | { type: "replay" }
  /** A diagram: the source of a library it asked for. */
  | { type: "library"; name: StageLibrary; source: string };

/** The tallest an auto-sized stage may report itself. */
export const STAGE_MAX_HEIGHT = 4000;

/** The narrowest a stage lays out: the board's reading width. In a
 * narrower block it keeps this width and scrolls sideways, rather than
 * squeezing a drawing made for the board. */
export const STAGE_MIN_WIDTH = 720;

/** The widest a stage may ask to stay, scrolling sideways in a narrower
 * block. */
export const STAGE_MAX_WIDTH = 4000;

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
  /** The stage's content height, when it sizes itself, and the width its
   * content reaches past its right edge, or 0 when it fits. The host keeps
   * the stage at least as wide as any width it reported. */
  z.strictObject({
    type: z.literal("size"),
    height: z.number().finite().nonnegative().max(STAGE_MAX_HEIGHT).optional(),
    width: z.number().finite().nonnegative().max(STAGE_MAX_WIDTH),
  }),
  /** A measuring copy's tallest frame. */
  z.strictObject({
    type: z.literal("measured"),
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
  /** A diagram needs a library: ELK for layout, Plot for charts, three.js
   * for a 3D scene. */
  z.strictObject({
    type: z.literal("library"),
    name: z.enum(["elk", "plot", "three"]),
  }),
  /** A diagram's claims about the code: each drawn thing's label and the
   * code names that back it, none when nothing does. */
  z.strictObject({
    type: z.literal("claims"),
    claims: z
      .array(
        z.strictObject({
          label: z.string().max(200),
          names: z.array(z.string().max(64)).max(16),
        }),
      )
      .max(2000),
  }),
  /** What a diagram drew wrong: overlaps, moves without a wire, unknown
   * code names. Empty when it is clear. */
  z.strictObject({
    type: z.literal("findings"),
    findings: z.array(z.string().max(500)).max(100),
  }),
  /** Escape pressed inside a diagram's stage. */
  z.strictObject({ type: z.literal("escape") }),
]);

export type StageMessage = z.infer<typeof stageMessageSchema>;

/** The bootstrap message the stage page waits for, with the port. */
export const STAGE_BOOT = "whiteboard-stage";
