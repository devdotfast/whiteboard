import * as z from "zod";

/**
 * The data an agent writes for one animation block. Deliberately small: the
 * lab grows it one field at a time, and nothing outside this folder depends
 * on its shape yet.
 *
 * Motion comes in two forms, and a block uses one. Frames are distinct
 * states the reader steps through, with the script animating each
 * transition. A timeline is one continuous motion the reader plays, pauses
 * and scrubs; the host keeps the clock and the script draws whatever moment
 * it is told. A block with a timeline ignores its frames.
 */
export interface AnimationBlockData {
  title: string;
  description?: string;
  /** The drawing's size in CSS px. `inset` is the space around it, inside
   * the stage's edge: 24 by default, 0 for a drawing that fills the stage
   * to its edges, like a three.js scene. Coordinates start inside it. */
  stage: { width: number; height: number; inset?: number };
  /** The model's JavaScript, run in the stage with `wb` in scope. */
  script: string;
  /** Variations of the same animation. The script reads the chosen one as
   * `wb.scenario`; the reader picks between them when there are several. */
  scenarios?: Scenario[];
  /** States the reader steps through in order. The script reads the
   * current one as `wb.frame` and animates each change. */
  frames?: Frame[];
  /** One continuous motion, told in chapters. The script draws the moment
   * it is given through `wb.onTime`. */
  timeline?: Timeline;
  /** The code the diagram stands for, by name. The script links a node or
   * wire to a name (`wb.node({ code })`, `wb.code(element, name)`) and a
   * frame lists the names its step walks through. */
  code?: Record<string, CodeRef>;
}

/** Where a claim in the diagram is true in the code, and how to tell it
 * still is. */
export interface CodeRef {
  /** `head/<path>#L<start>-L<end>`: the lines that back the claim. A wire
   * points at its call site, the line where one side calls the other, not
   * at either side's definition. */
  anchor: string;
  /** Text those lines must contain for the claim to hold, copied from one
   * line of the code: `playback.Manifest(`, `topic: "video.ready"`. Pick
   * the part that would change if the claim stopped being true, like the
   * callee's name. When it is no longer in the range, the claim shows as
   * changed. */
  evidence: string;
  /** What this code does, in a few words, for the code view's heading. */
  title?: string;
}

export interface Timeline {
  /** In order; the timeline lasts as long as its chapters together. */
  chapters: Chapter[];
}

export interface Chapter {
  /** Stable id the script branches on. */
  id: string;
  /** A short name under the track, a word or two. */
  label?: string;
  /** One line under the player while this chapter plays. */
  caption?: string;
  /** How long it lasts, in milliseconds. */
  duration: number;
  /** Anything the script needs for this part of the motion. */
  data?: unknown;
}

export interface Scenario {
  /** Stable id the script branches on. */
  id: string;
  /** What the reader sees in the picker. */
  label: string;
  /** Steps of its own, in place of the block's frames, for a scenario
   * that walks through something different: one request's hops, say. */
  frames?: Frame[];
  /** Anything the script needs for this scenario. */
  data?: unknown;
}

export interface Frame {
  /** Stable id the script branches on. */
  id: string;
  /** A short name for the step rail, a word or two. */
  label?: string;
  /** One line under the rail saying what this state shows. */
  caption?: string;
  /** Names in the block's `code` that this step walks through, shown
   * beside the stage as the reader steps: one per movement, so a fan-out
   * lists each call. */
  code?: string[];
  /** Anything the script needs to draw this state: for a step, the
   * movements that happen in it, which run together. */
  data?: unknown;
}

/** What the reader has chosen, as the stage sees it. */
export interface StageState {
  scenario: Scenario | null;
  frame: Frame | null;
  /** The frame's position, from 0; -1 without frames. */
  frameIndex: number;
}

/** Where a timeline is: a time and the chapter it falls in. */
export interface TimelinePosition {
  /** Milliseconds from the start. */
  time: number;
  chapter: Chapter;
  chapterIndex: number;
  /** Milliseconds since the chapter started. */
  chapterTime: number;
}

/** The chapter a time falls in; the end belongs to the last chapter. */
export function positionAt(
  timeline: Timeline,
  time: number,
): TimelinePosition | null {
  let start = 0;

  for (const [chapterIndex, chapter] of timeline.chapters.entries()) {
    const last = chapterIndex === timeline.chapters.length - 1;

    if (time < start + chapter.duration || last)
      return {
        time,
        chapter,
        chapterIndex,
        chapterTime: Math.min(time - start, chapter.duration),
      };

    start += chapter.duration;
  }

  return null;
}

export function timelineDuration(timeline: Timeline) {
  return timeline.chapters.reduce(
    (total, chapter) => total + chapter.duration,
    0,
  );
}

/** One thing the reader picked on the stage for the model's context. */
export interface SelectedItem {
  /** Stable id: `node:<id>` and `edge:<id>` for React Flow, the node's id
   * for `wb.node`, or whatever a script gave `wb.selectable`. */
  id: string;
  label: string;
  /** What it is: "node", "edge", a `wb.node` kind, or the script's own. */
  kind: string;
}

/** What the host sends the stage. */
export type StageMessage =
  | { type: "wb:state"; state: StageState }
  | { type: "wb:time"; time: number }
  | { type: "wb:select-mode"; on: boolean }
  | { type: "wb:select-remove"; id: string }
  | { type: "wb:select-clear" }
  /** Run the current step again: its listeners hear it as a new frame. */
  | { type: "wb:replay" }
  | {
      type: "wb:verify";
      on: boolean;
      /** Each code name's state; a name missing here is not defined. */
      status: Record<string, "checked" | "changed">;
      /** Names the current step walks through, ringed on the stage. */
      focus: string[];
    };

/** A node or wire on the stage that claims something about the code. */
export interface Claim {
  label: string;
  /** Its code names; empty when nothing backs it yet. */
  names: string[];
}

const text = z.string().max(500);

const names = z.array(z.string().max(200)).max(50);

// The stage never needs more room than this, and NaN or Infinity would
// break the frame's size.
const extent = z.number().finite().min(1).max(20_000);

/** What a stage may tell its block. The stage runs an agent's script, so
 * the block parses every message and drops anything else. */
export const stageEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("wb:selection"),
    items: z
      .array(z.object({ id: text, label: text, kind: z.string().max(100) }))
      .max(200),
  }),
  z.object({ type: z.literal("wb:select-exit") }),
  z.object({
    type: z.literal("wb:claims"),
    claims: z.array(z.object({ label: text, names })).max(2_000),
  }),
  z.object({ type: z.literal("wb:size"), width: extent, height: extent }),
  z.object({ type: z.literal("wb:reveal"), label: text, names }),
]);
