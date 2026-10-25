import { anchorSchema } from "@review/lens-selection.js";
import { ReviewInputError } from "@review/review-api/input-error.js";
import { z } from "zod";

import {
  type BlockDefinition,
  defineBlock,
  elementPins,
  label,
  text,
} from "./definition.js";

/** A name the stage's script passes to the `whiteboard` shim. */
const handle = z
  .string()
  .regex(
    /^[A-Za-z][\w-]{0,63}$/,
    "Use a short name: a letter, then letters, digits, _ or -.",
  );

export const animationFrameSchema = z.strictObject({
  key: handle.describe(
    "Names the frame for the stage: data-frame on <html>, data-enter/data-exit, and whiteboard.on(key, ...).",
  ),
  title: label,
  label: z
    .string()
    .min(1)
    .max(24)
    .optional()
    .describe(
      "A short name for the step strip under the stage, e.g. PUSH. Give every frame one, or none.",
    ),
  caption: text
    .optional()
    .describe("One or two short sentences shown under the stage."),
  duration: z
    .number()
    .int()
    .min(300)
    .max(30_000)
    .optional()
    .describe("Milliseconds this frame stays up while playing. Default 3000."),
});

export type AnimationFrame = z.infer<typeof animationFrameSchema>;

export const animationSchema = defineBlock("animation", {
  title: label,
  html: text
    .min(1)
    .max(200_000)
    .describe(
      'The stage\'s body markup: elements, <style> and <script>. It runs in a sandboxed frame with a global `whiteboard` shim; see session_get_instructions({topic:"animation"}).',
    ),
  frames: z
    .array(animationFrameSchema)
    .min(1)
    .max(60)
    .describe(
      "Every possible frame. Stage scripts may select an ordered branch with whiteboard.setSequence(keys); keys stay unique and stable.",
    ),
  code: z
    .record(handle, anchorSchema)
    .default({})
    .describe(
      "Source ranges the stage shows as code peeks, by name: whiteboard.code(name).",
    ),
  height: z
    .union([z.literal("auto"), z.number().int().min(120).max(1200)])
    .default("auto")
    .describe(
      "Fit the stage to its content by default, or set a fixed height in CSS pixels.",
    ),
  pins: elementPins,
});

export type AnimationBlock = z.infer<typeof animationSchema>;

export const animation = {
  type: "animation",
  schema: animationSchema,
  check(block: AnimationBlock) {
    const keys = new Set(block.frames.map((frame) => frame.key));

    if (keys.size !== block.frames.length)
      throw new ReviewInputError(
        "Animation frame keys must be unique within the animation.",
      );

    const labelled = block.frames.filter((frame) => frame.label).length;

    if (labelled && labelled !== block.frames.length)
      throw new ReviewInputError(
        "Give every animation frame a label, or none: the step strip needs one per frame.",
      );
  },
} satisfies BlockDefinition<AnimationBlock>;
