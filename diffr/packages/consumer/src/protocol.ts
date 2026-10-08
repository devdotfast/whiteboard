/** Portable pane frames, cell targets and input. Colours index Frame.colors. */
import { z } from "zod";
import type { Target } from "@diffr/viewer/viewport/cell";
import type { Hover, KeyPress } from "@diffr/viewer/viewer";

export type Segment = [text: string, fg: number, bg: number, bold?: 1];

export const action = z.union([
  z.strictObject({ fold: z.number().int(), file: z.number().int() }),
  /** A file header's viewed box. */
  z.strictObject({ viewedFile: z.number().int() }),
  z.strictObject({ file: z.number().int() }),
  z.strictObject({ jump: z.number().int() }),
  z.strictObject({ dir: z.string() }),
  /** A scrollbar row. */
  z.strictObject({ scrub: z.number().int() }),
  z.strictObject({ layout: z.literal(true) }),
  /** The status line's ? keys, or any click on the key list: show or hide the list. */
  z.strictObject({ help: z.literal(true) }),
  /** A file in the Ctrl-P picker. */
  z.strictObject({ pick: z.number().int() }),
  /** The title bar's files button: the tree, as a sidebar or in place of the diff. */
  z.strictObject({ files: z.literal(true) }),
  /** The selection bar's Add to chat button. */
  z.strictObject({ chat: z.literal(true) }),
]);
export type Action = z.infer<typeof action>;

export const hover: z.ZodType<Hover> = z.union([
  z.strictObject({ file: z.number().int(), id: z.number().int(), armed: z.boolean() }),
  z.strictObject({ file: z.number().int(), header: z.literal(true) }),
]);

/** Key events shared by terminal consumers. */
export const keyPress: z.ZodType<KeyPress> = z.object({
  key: z.string(),
  ctrl: z.literal(true).optional(),
  shift: z.literal(true).optional(),
  meta: z.literal(true).optional(),
});

export const input = z.union([
  z.strictObject({ act: action, alt: z.literal(true).optional() }),
  z.strictObject({ press: keyPress }),
  /** A left press (or, with `extend`, a drag) at a pane cell: `y` counts from the frame's first line. */
  z.strictObject({ select: z.strictObject({ x: z.number().int(), y: z.number().int(), extend: z.literal(true).optional() }) }),
]);
export type Input = z.infer<typeof input>;

export interface Line {
  /** Colours that unstyled segments inherit, with `Frame.fg`. */
  bg: number;
  segments: Segment[];
  hits?: Target<Action>[];
  hovers?: Target<Hover>[];
}

export interface Frame {
  colors: string[];
  fg: number;
  lines: Line[];
  /** The last drawn hover, so the view posts only changes. */
  hover: Hover | null;
}
