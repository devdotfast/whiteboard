// An agent's look at an animation it wrote: one frame of it (or a clip at
// one marker), shown by the attached Desktop as the reader sees it and
// captured as a PNG. The server checks the stop against the document; the
// Desktop shows and captures it.

import {
  type Element,
  ReviewInputError,
  elements,
} from "@dev.fast/whiteboard-document";
import * as z from "zod";

import type { Snapshot } from "./store.js";

export const renderQuerySchema = z.object({
  targetId: z.string().min(1),
  /** A frame key, or a clip's marker key; omitted, the first stop. */
  frame: z.string().min(1).optional(),
});

/** What the Desktop answers: the stop it showed, and the figure's PNG. */
export const renderedFrameSchema = z.object({
  frame: z.object({
    key: z.string(),
    title: z.string(),
    position: z.number().int().nonnegative(),
    count: z.number().int().positive(),
  }),
  scenario: z.string().optional(),
  /** The figure ran past the window, so the capture cuts it. */
  clipped: z.boolean(),
  /** The error the stage reported, if its script threw. */
  error: z.string().nullable(),
  /** The capture, base64. */
  png: z.string().min(1),
});

export type RenderedFrame = z.infer<typeof renderedFrameSchema>;

export interface RenderRequest {
  reviewId: string;
  targetId: string;
  frame: string;
}

/** The host's way to a Desktop that shows the frame and captures it. */
export type RenderAnimation = (
  request: RenderRequest,
) => Promise<RenderedFrame>;

/** The stop a render shows: a frame of an animation, or a marker of a clip. */
export interface RenderTarget {
  type: "animation" | "clip";
  key: string;
}

type StageBlock = Extract<Element, { type: "animation" | "clip" }>;

const isStageBlock = (element: Element): element is StageBlock =>
  element.type === "animation" || element.type === "clip";

/** The stop to render: `frame` checked against the block's frames or markers, or
 * the first stop of the first scenario when omitted. */
export function renderTarget(
  snapshot: Snapshot,
  targetId: string,
  frame: string | undefined,
): RenderTarget {
  const target = elements(snapshot.document).find(
    (element) => element.id === targetId,
  );

  if (!target)
    throw new ReviewInputError("Target not found in this version.", 404);

  if (!isStageBlock(target))
    throw new ReviewInputError(
      `${targetId} is a ${target.type}; only an animation or a clip renders a frame.`,
    );

  const noun = target.type === "clip" ? "marker" : "frame";

  const keys =
    target.type === "clip"
      ? target.markers.map((marker) => marker.key)
      : target.frames.map((item) => item.key);

  if (frame === undefined) {
    const first =
      target.type === "animation"
        ? (target.scenarios?.[0]?.frames[0] ?? keys[0])
        : keys[0];

    if (first === undefined)
      throw new ReviewInputError(`${targetId} has no ${noun}s to render.`);

    return { type: target.type, key: first };
  }

  if (!keys.includes(frame))
    throw new ReviewInputError(
      `${frame} is not a ${noun} of ${targetId}. Its ${noun}s: ${keys.join(", ")}.`,
    );

  return { type: target.type, key: frame };
}
