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
  /** A frame key, or a clip's marker key; omitted, the first stop; "all"
   * for every stop of every scenario. */
  frame: z.string().min(1).optional(),
});

/** Renders every stop: each scenario's frames in its order, then any frame
 * no scenario lists; a clip's markers or a played diagram's chapters. */
export const RENDER_ALL = "all";

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

/** The stop a render shows: a frame of an animation or diagram, a marker
 * of a clip, a chapter of a played diagram, or a still diagram whole. */
export interface RenderTarget {
  type: "animation" | "clip" | "diagram";
  key: string;
}

type StageBlock = Extract<Element, { type: "animation" | "clip" | "diagram" }>;

/** The one stop a diagram without frames or a timeline renders at. */
export const STILL_STOP = "diagram";

const isStageBlock = (element: Element): element is StageBlock =>
  element.type === "animation" ||
  element.type === "clip" ||
  element.type === "diagram";

/** A stage block's stops in order, what one is called, and the first a
 * reader sees. */
function stopsOf(target: StageBlock) {
  if (target.type === "clip") {
    const keys = target.markers.map((marker) => marker.key);

    return { noun: "marker", keys, first: keys[0] };
  }

  if (target.type === "diagram" && target.timeline) {
    const keys = target.timeline.chapters.map((chapter) => chapter.key);

    return { noun: "chapter", keys, first: keys[0] };
  }

  if (target.type === "diagram" && !target.frames)
    return { noun: "frame", keys: [STILL_STOP], first: STILL_STOP };

  const keys = (target.frames ?? []).map((item) => item.key);

  return {
    noun: "frame",
    keys,
    first: target.scenarios?.[0]?.frames[0] ?? keys[0],
  };
}

/** Every stop of a block, in the order a reader meets them: each scenario's
 * frames, keyed "scenario:frame" so the canvas shows them in that scenario,
 * then any frame no scenario lists. */
export interface RenderStop {
  key: string;
  /** The scenario to show it in, when it has scenarios. */
  scenario?: string;
}

export interface RenderStops {
  type: RenderTarget["type"];
  stops: RenderStop[];
}

export function renderStops(snapshot: Snapshot, targetId: string): RenderStops {
  const { type, key } = renderTarget(snapshot, targetId, undefined);

  const target = elements(snapshot.document).find(
    (element): element is StageBlock =>
      element.id === targetId && isStageBlock(element),
  );

  if (!target) return { type, stops: [] };
  const { keys } = stopsOf(target);

  if (target.type === "clip" || !target.scenarios?.length)
    return { type, stops: key ? keys.map((stop) => ({ key: stop })) : [] };

  const listed = target.scenarios.flatMap((scenario) =>
    scenario.frames.map((frame) => ({ key: frame, scenario: scenario.key })),
  );

  const unlisted = keys
    .filter((frame) => !listed.some((stop) => stop.key === frame))
    .map((frame) => ({ key: frame }));

  return { type, stops: [...listed, ...unlisted] };
}

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
      `${targetId} is a ${target.type}; only an animation, a clip or a diagram renders a frame.`,
    );

  const { noun, keys, first } = stopsOf(target);

  if (frame === undefined) {
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
