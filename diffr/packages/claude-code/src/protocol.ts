/** Reliable messages across Claude Code's JSON surface boundary. */
import { z } from "zod";
import { input, hover, type Frame as PaneFrame } from "@diffr/consumer/protocol";
export type { Action, Input, Line, Segment } from "@diffr/consumer/protocol";

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

export interface Frame extends PaneFrame {
  /** Last handled input sequence per view instance. */
  acks?: Record<string, number>;
  /** Each band starts at this line in the full pane. */
  offset?: number;
}
