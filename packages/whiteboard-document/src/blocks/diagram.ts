import * as z from "zod";

import { ReviewInputError } from "../input-error.js";
import { anchorSchema } from "../lens-selection.js";
import {
  animationFrameSchema,
  animationScenarioSchema,
  handle,
} from "./animation.js";
import {
  type BlockDefinition,
  defineBlock,
  elementPins,
  label,
  text,
} from "./definition.js";

/** A node's id, as the script gave it to `wb.node`. */
const nodeId = z.string().min(1).max(64);

/** One movement in a step: a token rides the wire between two nodes. */
export const diagramMoveSchema = z.strictObject({
  from: nodeId.describe("The node the token leaves, by its wb.node id."),
  to: nodeId.describe("The node it reaches."),
  edge: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "The wire it rides, by its wb.edge id, when two wires join the same nodes.",
    ),
  label: z
    .string()
    .min(1)
    .max(40)
    .optional()
    .describe("Text on the token, e.g. GET /play/42."),
  reply: z
    .boolean()
    .optional()
    .describe(
      "Draw it as a reply. A move against its wire's direction is one already.",
    ),
  failed: z
    .boolean()
    .optional()
    .describe(
      "The move goes wrong, such as a refused write, a no vote or an abort: its token is drawn red.",
    ),
  lost: z
    .boolean()
    .optional()
    .describe(
      "The message never arrives, such as a request that times out: its token stops halfway, red and faded.",
    ),
  delay: z
    .number()
    .int()
    .min(0)
    .max(10_000)
    .optional()
    .describe(
      "Milliseconds to wait before it sets off, for a staggered fan-out.",
    ),
});

export type DiagramMove = z.infer<typeof diagramMoveSchema>;

export const diagramFrameSchema = animationFrameSchema.extend({
  moves: z
    .array(diagramMoveSchema)
    .min(1)
    .max(12)
    .optional()
    .describe(
      "The movements this step makes, all at once: tokens ride the wires, what the request has reached lights up and the rest dims.",
    ),
});

export type DiagramFrame = z.infer<typeof diagramFrameSchema>;

/** One named source range of a diagram. */
export const diagramCodeSchema = z.strictObject({
  source: anchorSchema,
  label: z
    .string()
    .min(1)
    .max(48)
    .optional()
    .describe(
      "What the range is, in 48 characters at most, e.g. Gateway routes.",
    ),
});

export type DiagramCode = z.infer<typeof diagramCodeSchema>;

/** One stretch of a played diagram. */
export const diagramChapterSchema = z.strictObject({
  key: handle.describe("Names the chapter: wb.onTime reports it."),
  title: label.describe("What the step strip shows, in a few words."),
  caption: text
    .optional()
    .describe("One or two short sentences shown under the diagram."),
  duration: z
    .number()
    .int()
    .min(300)
    .max(60_000)
    .describe("How long it plays, in milliseconds."),
  code: z
    .array(handle)
    .min(1)
    .max(8)
    .optional()
    .describe("The code this chapter shows, by name in the block's code."),
});

export type DiagramChapter = z.infer<typeof diagramChapterSchema>;

export const diagramSchema = defineBlock("diagram", {
  title: label,
  description: text
    .max(600)
    .optional()
    .describe("A sentence or two shown under the title."),
  html: text
    .min(1)
    .max(200_000)
    .optional()
    .describe(
      "The diagram's page: markup and styles, in the stage before the script runs. An element with data-wb-drawing marks where wb draws; without html, the page is that element alone. data-wb-from, data-wb-until and data-wb-only show an element from a frame, up to one, or on the frames listed.",
    ),
  script: text
    .min(1)
    .max(200_000)
    .optional()
    .describe(
      'The diagram\'s JavaScript module. It draws with the global `wb` in a sandboxed stage; see session_get_instructions({topic:"diagram"}). Optional with html.',
    ),
  frames: z
    .array(diagramFrameSchema)
    .min(1)
    .max(60)
    .optional()
    .describe(
      "Steps the reader moves through, each with unique, stable keys. Leave out for a still diagram.",
    ),
  scenarios: z
    .array(animationScenarioSchema)
    .min(2)
    .max(8)
    .optional()
    .describe(
      "Alternate paths through the frames, each a list of frame keys. The whiteboard draws a scenario picker and starts on the first.",
    ),
  timeline: z
    .strictObject({
      chapters: z.array(diagramChapterSchema).min(1).max(30),
    })
    .optional()
    .describe(
      "A played diagram: the reader plays, pauses and jumps between chapters. Instead of frames.",
    ),
  code: z
    .record(handle, diagramCodeSchema)
    .default({})
    .describe(
      "Source ranges by name, each {source, label?}. Nodes, wires and charts name them with `code`.",
    ),
  stage: z
    .strictObject({
      width: z.number().int().min(120).max(4000).optional(),
      height: z.number().int().min(120).max(4000).optional(),
      inset: z.number().int().min(0).max(64).optional(),
    })
    .optional()
    .describe(
      "The least size of the drawing, for a script that places by hand (the stage grows to what is drawn), and the space around the page.",
    ),
  pins: elementPins,
});

export type DiagramBlock = z.infer<typeof diagramSchema>;

const unique = (keys: readonly string[]) => new Set(keys).size === keys.length;

export const diagram = {
  type: "diagram",
  reference: [
    "- diagram {title, description?, html? (the page's markup and styles; data-wb-drawing marks where wb draws; data-wb-from / data-wb-until / data-wb-only (frame keys) show an element by frame), script? (a JS module drawing with `wb`; html, script or both), frames?: {key, title, label?, caption?, code? ([names in code]), moves?: {from, to, edge? (wire id), label?, reply?, failed?, lost?, delay? (ms)}[], data?}[] (1 to 60), scenarios?: {key, label, frames: [frame keys in order]}[] (2 to 8), timeline?: {chapters: {key, title, caption?, duration (ms), code?}[]}, code?: {name: {source: anchor, label?}}, stage?: {width?, height? (least size), inset?}, pins?}",
    'Use a diagram for architecture, request flows, sequences, call paths and charts: nodes, groups and wires laid out for you, steps that move requests along wires, and every node and wire linked to the code it claims. Read session_get_instructions({topic:"diagram"}) before writing one.',
  ],
  schema: diagramSchema,
  check(block: DiagramBlock) {
    const frames = block.frames ?? [];

    if (block.html === undefined && block.script === undefined)
      throw new ReviewInputError("A diagram needs html, a script, or both.");

    const names = (list: readonly string[] | undefined) =>
      list?.find((name) => !(name in block.code));

    if (frames.length && block.timeline)
      throw new ReviewInputError(
        "A diagram has frames or a timeline, not both.",
      );

    if (!unique(frames.map((frame) => frame.key)))
      throw new ReviewInputError(
        "Diagram frame keys must be unique within the diagram.",
      );

    const labelled = frames.filter((frame) => frame.label).length;

    if (labelled && labelled !== frames.length)
      throw new ReviewInputError(
        "Give every diagram frame a label, or none: the step strip needs one per frame.",
      );

    for (const frame of frames) {
      const unknown = names(frame.code);

      if (unknown)
        throw new ReviewInputError(
          `Frame "${frame.key}" lists code "${unknown}", which the diagram's code does not name.`,
        );
    }

    const scenarios = block.scenarios ?? [];

    if (scenarios.length && !frames.length)
      throw new ReviewInputError(
        "A diagram's scenarios list frames: give it frames too.",
      );

    if (!unique(scenarios.map((scenario) => scenario.key)))
      throw new ReviewInputError(
        "Diagram scenario keys must be unique within the diagram.",
      );

    const keys = new Set(frames.map((frame) => frame.key));

    for (const scenario of scenarios) {
      if (!unique(scenario.frames))
        throw new ReviewInputError(
          `Scenario "${scenario.key}" lists a frame twice.`,
        );

      const unknown = scenario.frames.find((key) => !keys.has(key));

      if (unknown)
        throw new ReviewInputError(
          `Scenario "${scenario.key}" names frame "${unknown}", which the diagram does not declare.`,
        );
    }

    const chapters = block.timeline?.chapters ?? [];

    if (!unique(chapters.map((chapter) => chapter.key)))
      throw new ReviewInputError(
        "Diagram chapter keys must be unique within the timeline.",
      );

    for (const chapter of chapters) {
      const unknown = names(chapter.code);

      if (unknown)
        throw new ReviewInputError(
          `Chapter "${chapter.key}" lists code "${unknown}", which the diagram's code does not name.`,
        );
    }
  },
} satisfies BlockDefinition<DiagramBlock>;
