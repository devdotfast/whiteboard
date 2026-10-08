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
  /** A scope's viewed box: marks or unmarks that fold-state id. */
  z.strictObject({ viewed: z.number().int(), file: z.number().int() }),
  /** A file header's viewed box. */
  z.strictObject({ viewedFile: z.number().int() }),
  z.strictObject({ file: z.number().int() }),
  z.strictObject({ jump: z.number().int() }),
  z.strictObject({ dir: z.string() }),
  /** A scrollbar row. */
  z.strictObject({ scrub: z.number().int() }),
  z.strictObject({ layout: z.literal(true) }),
]);
export type Action = z.infer<typeof action>;

const hover: z.ZodType<Hover> = z.strictObject({ file: z.number().int(), id: z.number().int(), armed: z.boolean() });

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
  /** Columns dragged; positive pans right. */
  z.strictObject({ pan: z.number().int() }),
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
  colors: string[];
  fg: number;
  lines: Line[];
  /** The last drawn hover, so the view posts only changes. */
  hover: Hover | null;
}
