import * as z from "zod";

import { ReviewInputError } from "../input-error.js";
import { animationCodeSchema, handle } from "./animation.js";
import {
  type BlockDefinition,
  defineBlock,
  elementPins,
  label,
  text,
} from "./definition.js";

export const clipMarkerSchema = z.strictObject({
  key: handle.describe(
    "Names the marker for the html: clip.marker(key) places it in time, and whiteboard.on(key, ...) runs as the playhead reaches it.",
  ),
  title: label.describe(
    "What the step strip under the clip shows for this marker, e.g. Lock taken. Keep it to a few words.",
  ),
  caption: text
    .optional()
    .describe("One or two short sentences shown under the clip."),
  code: z
    .array(handle)
    .min(1)
    .max(8)
    .optional()
    .describe(
      "The code this moment shows, by name in the block's code. The tour stops here with it.",
    ),
});

export type ClipMarker = z.infer<typeof clipMarkerSchema>;

export const clipScenarioSchema = z.strictObject({
  key: handle.describe(
    "Names the scenario: whiteboard.clip(key) builds its timeline.",
  ),
  label: z
    .string()
    .min(1)
    .max(32)
    .describe(
      "What the reader picks above the clip, e.g. Slow replica. Keep it short.",
    ),
});

export type ClipScenario = z.infer<typeof clipScenarioSchema>;

export const clipSchema = defineBlock("clip", {
  title: label,
  html: text
    .min(1)
    .max(200_000)
    .describe(
      'The clip\'s body markup: elements, <style> and <script>. Its script builds the timeline with whiteboard.clip() in a sandboxed iframe; see session_get_instructions({topic:"animation"}).',
    ),
  markers: z
    .array(clipMarkerSchema)
    .min(1)
    .max(60)
    .describe(
      "The named moments the reader jumps between, with unique, stable keys. The script places each one in time.",
    ),
  scenarios: z
    .array(clipScenarioSchema)
    .min(2)
    .max(8)
    .optional()
    .describe(
      "Alternate timelines the script builds, one per key. The whiteboard draws a labelled scenario picker above the clip and starts on the first one.",
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
      "Fit the clip to its content by default, or set a fixed height in CSS pixels.",
    ),
  pins: elementPins,
});

export type ClipBlock = z.infer<typeof clipSchema>;

export const clip = {
  type: "clip",
  reference: [
    '- clip {title, html, markers: {key, title (a few words), caption?, code? ([names in code] this moment shows)}[] (1 to 60), scenarios?: {key, label}[] (2 to 8, each a timeline the script builds), code?: {name: anchor | {source: anchor, label}}, height?: "auto" (default) | number (120 to 1200 CSS px), pins?}; the script places every marker in time',
    'Use a clip for continuous motion where the timing itself is the point: a token crossing a system, a race, a queue draining. The reader plays it, pauses it and jumps between its markers. Use an animation instead when the reader needs to compare discrete states. Read session_get_instructions({topic:"animation"}) before writing one.',
  ],
  schema: clipSchema,
  check(block: ClipBlock) {
    if (
      new Set(block.markers.map((marker) => marker.key)).size !==
      block.markers.length
    )
      throw new ReviewInputError(
        "Clip marker keys must be unique within the clip.",
      );

    for (const marker of block.markers) {
      const unknown = marker.code?.find((name) => !(name in block.code));

      if (unknown)
        throw new ReviewInputError(
          `Marker "${marker.key}" lists code "${unknown}", which the clip's code does not name.`,
        );
    }

    const scenarios = block.scenarios ?? [];

    if (
      new Set(scenarios.map((scenario) => scenario.key)).size !==
      scenarios.length
    )
      throw new ReviewInputError(
        "Clip scenario keys must be unique within the clip.",
      );
  },
} satisfies BlockDefinition<ClipBlock>;
