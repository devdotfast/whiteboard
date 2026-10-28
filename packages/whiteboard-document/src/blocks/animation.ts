import { z } from "zod";

import { ReviewInputError } from "../input-error.js";
import { anchorSchema } from "../lens-selection.js";
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

export const animationScenarioSchema = z.strictObject({
  key: handle.describe("Names the scenario."),
  label: z
    .string()
    .min(1)
    .max(32)
    .describe(
      "What the reader picks above the stage, e.g. Retried request. Keep it short.",
    ),
  frames: z
    .array(handle)
    .min(1)
    .max(60)
    .describe("The frame keys this scenario plays, in order."),
});

export type AnimationScenario = z.infer<typeof animationScenarioSchema>;

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
  scenarios: z
    .array(animationScenarioSchema)
    .min(2)
    .max(8)
    .optional()
    .describe(
      "Alternate paths through the frames. The whiteboard draws a labelled scenario picker above the stage and starts on the first one.",
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

    const scenarios = block.scenarios ?? [];

    if (
      new Set(scenarios.map((scenario) => scenario.key)).size !==
      scenarios.length
    )
      throw new ReviewInputError(
        "Animation scenario keys must be unique within the animation.",
      );

    for (const scenario of scenarios) {
      if (new Set(scenario.frames).size !== scenario.frames.length)
        throw new ReviewInputError(
          `Scenario "${scenario.key}" lists a frame twice.`,
        );

      const unknown = scenario.frames.find((key) => !keys.has(key));

      if (unknown)
        throw new ReviewInputError(
          `Scenario "${scenario.key}" names frame "${unknown}", which the animation does not declare.`,
        );
    }
  },
} satisfies BlockDefinition<AnimationBlock>;
