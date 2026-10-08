/**
 * Messages between register.tsx and view.tsx. They cross Claude Code's surface boundary as JSON,
 * so colours are indexes into `Frame.colors`.
 */
import { z } from "zod";
import type { Target } from "@diffr/viewer/viewport/cell";
import type { Hover, KeyPress } from "@diffr/viewer/viewer";

export type Segment = [text: string, fg: number, bg: number, bold?: 1];

const action = z.union([
  z.strictObject({ fold: z.number().int(), file: z.number().int() }),
  /** A file header's viewed box. */
  z.strictObject({ viewedFile: z.number().int() }),
  z.strictObject({ file: z.number().int() }),
  z.strictObject({ jump: z.number().int() }),
  z.strictObject({ dir: z.string() }),
  /** A scrollbar row. */
  z.strictObject({ scrub: z.number().int() }),
  z.strictObject({ layout: z.literal(true) }),
  /** The title bar's files button: the tree, as a sidebar or in place of the diff. */
  z.strictObject({ files: z.literal(true) }),
]);
export type Action = z.infer<typeof action>;

const hover: z.ZodType<Hover> = z.union([
  z.strictObject({ file: z.number().int(), id: z.number().int(), armed: z.boolean() }),
  z.strictObject({ file: z.number().int(), header: z.literal(true) }),
]);

/** Claude Code's own key event; fields it may add later are dropped. */
const keyPress: z.ZodType<KeyPress> = z.object({
  key: z.string(),
  ctrl: z.literal(true).optional(),
  shift: z.literal(true).optional(),
  meta: z.literal(true).optional(),
});

const input = z.union([
  z.strictObject({ act: action, alt: z.literal(true).optional() }),
  z.strictObject({ press: keyPress }),
  /** A left press (or, with `extend`, a drag) at a pane cell: `y` counts from the frame's first line. */
  z.strictObject({ select: z.strictObject({ x: z.number().int(), y: z.number().int(), extend: z.literal(true).optional() }) }),
]);
export type Input = z.infer<typeof input>;

/**
 * Claude Code drops an undelivered post when a newer one arrives, so each post resends every
 * input not yet acknowledged. The hooks module skips the ones it has handled.
 */
const post = z.strictObject({
  instance: z.string(),
  inputs: z.array(z.tuple([z.number().int(), input])),
  hover: hover.nullable().optional(),
});
export type Post = z.infer<typeof post>;

/** Posts are untyped JSON from the view. */
export const parsePost = (data: unknown): Post => post.parse(data);

export interface Line {
  /** Colours that unstyled segments inherit, with `Frame.fg`. */
  bg: number;
  segments: Segment[];
  hits?: Target<Action>[];
  hovers?: Target<Hover>[];
}

export interface Frame {
  /** The last handled seq per view instance, so it stops resending. */
  acks?: Record<string, number>;
  /** Where this view's `lines` start in the whole frame: each band of lines is its own view. */
  offset?: number;
  colors: string[];
  fg: number;
  lines: Line[];
  /** The last drawn hover, so the view posts only changes. */
  hover: Hover | null;
}
