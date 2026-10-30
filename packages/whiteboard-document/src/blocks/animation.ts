import { z } from "zod";

import { ReviewInputError } from "../input-error.js";
import { type Anchor, anchorSchema } from "../lens-selection.js";
import {
  type BlockDefinition,
  defineBlock,
  elementPins,
  label,
  text,
} from "./definition.js";

/** A name the animation's script passes to the `whiteboard` API. */
const handle = z
  .string()
  .regex(
    /^[A-Za-z][\w-]{0,63}$/,
    "Use a short name: a letter, then letters, digits, _ or -.",
  );

/** Characters of serialized JSON one frame's data may hold. */
const frameDataLimit = 20_000;

export const animationFrameSchema = z.strictObject({
  key: handle.describe(
    "Names the frame for the html: data-frame on <html>, data-enter/data-exit, and whiteboard.on(key, ...).",
  ),
  title: label,
  label: z
    .string()
    .min(1)
    .max(24)
    .optional()
    .describe(
      "A short name for the step strip under the animation, e.g. PUSH. Give every frame one, or none.",
    ),
  caption: text
    .optional()
    .describe("One or two short sentences shown under the animation."),
  duration: z
    .number()
    .int()
    .min(300)
    .max(30_000)
    .optional()
    .describe("Milliseconds this frame stays up while playing. Default 3000."),
  data: z
    .json()
    .optional()
    .refine(
      (value) =>
        value === undefined || JSON.stringify(value).length <= frameDataLimit,
      `Keep a frame's data under ${frameDataLimit / 1000} KB.`,
    )
    .describe(
      "This frame's state, as JSON the html's script draws: frame.data in whiteboard.on handlers, whiteboard.frame and whiteboard.frames.",
    ),
  code: z
    .array(handle)
    .min(1)
    .max(8)
    .optional()
    .describe(
      "The code this frame shows, by name in the block's code. The html's script reads it as frame.code.",
    ),
});

export type AnimationFrame = z.infer<typeof animationFrameSchema>;

export const animationScenarioSchema = z.strictObject({
  key: handle.describe("Names the scenario."),
  label: z
    .string()
    .min(1)
    .max(32)
    .describe(
      "What the reader picks above the animation, e.g. Retried request. Keep it short.",
    ),
  frames: z
    .array(handle)
    .min(1)
    .max(60)
    .describe("The frame keys this scenario plays, in order."),
});

export type AnimationScenario = z.infer<typeof animationScenarioSchema>;

const animationCodeSchema = z.union([
  anchorSchema,
  z.strictObject({
    source: anchorSchema,
    label: z
      .string()
      .min(1)
      .max(48)
      .describe("What the range is, e.g. checkoutAnimation."),
  }),
]);

/** One of an animation's named ranges, with its label when it has one. */
export function animationCode(entry: z.infer<typeof animationCodeSchema>): {
  source: Anchor;
  label?: string;
} {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- entry is already parsed: this picks between the schema's two forms.
  return typeof entry === "string" ? { source: entry } : entry;
}

export const animationSchema = defineBlock("animation", {
  title: label,
  html: text
    .min(1)
    .max(200_000)
    .describe(
      'The animation\'s body markup: elements, <style> and <script>. It runs in a sandboxed iframe with the `whiteboard` API; see session_get_instructions({topic:"animation"}).',
    ),
  frames: z
    .array(animationFrameSchema)
    .min(1)
    .max(60)
    .describe(
      "Every possible frame, with unique, stable keys. Paths the reader picks are scenarios.",
    ),
  scenarios: z
    .array(animationScenarioSchema)
    .min(2)
    .max(8)
    .optional()
    .describe(
      "Alternate paths through the frames. The whiteboard draws a labelled scenario picker above the animation and starts on the first one.",
    ),
  code: z
    .record(handle, animationCodeSchema)
    .default({})
    .describe(
      "Source ranges by name, each an anchor or {source, label}: the label names the range where it opens. Elements with data-wb-open open them; data-wb-code shows one inline.",
    ),
  height: z
    .union([z.literal("auto"), z.number().int().min(120).max(1200)])
    .default("auto")
    .describe(
      "Fit the animation to its content by default, or set a fixed height in CSS pixels.",
    ),
  pins: elementPins,
});

export type AnimationBlock = z.infer<typeof animationSchema>;

export const animation = {
  type: "animation",
  reference: [
    '- animation {title, html, frames: {key, title, label?, caption?, duration? (ms), data? (JSON the html draws the frame from), code? ([names in code] this frame shows)}[] (1 to 60), scenarios?: {key, label, frames: [frame keys in order]}[] (2 to 8), code?: {name: anchor | {source: anchor, label}}, height?: "auto" (default) | number (120 to 1200 CSS px), pins?}; declare every possible frame',
    'Use an animation for change over time that a static diagram cannot show: state before and after, a cache filling, data changing as a request crosses layers. It can sit in design beside the diagram, or replace it when the motion is the point. Read session_get_instructions({topic:"animation"}) before writing one.',
  ],
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

    for (const frame of block.frames) {
      const unknown = frame.code?.find((name) => !(name in block.code));

      if (unknown)
        throw new ReviewInputError(
          `Frame "${frame.key}" lists code "${unknown}", which the animation's code does not name.`,
        );
    }

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
