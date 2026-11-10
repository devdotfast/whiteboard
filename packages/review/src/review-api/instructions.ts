import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ReviewInputError,
  componentReference,
  writableBlockTypes,
} from "@dev.fast/whiteboard-document";
import { findReviewPackageRoot } from "@review/package-paths.js";
import * as z from "zod";

import { RETIRED_BLOCK_TYPES } from "./retired-blocks.js";

export const INSTRUCTION_TOPICS = [
  "authoring",
  "diagram",
  "animation",
  "file-lenses",
  "trace-archaeology",
] as const;

export type InstructionTopic = (typeof INSTRUCTION_TOPICS)[number];

export const instructionsQuerySchema = z.strictObject({
  topic: z.enum(INSTRUCTION_TOPICS).default("authoring"),
});

export interface InstructionContext {
  traceEnabled: boolean;
  animationsEnabled?: boolean;
}

/** The block types an agent's edits may name: disabled experimental ones
 * are left out. Retired ones stay, so an agent can still update one. */
export const desktopBlockTypes = (animationsEnabled: boolean) =>
  writableBlockTypes.filter(
    (type) =>
      animationsEnabled ||
      (type !== "animation" && type !== "clip" && type !== "diagram"),
  );

/** The block types agent guidance lists: with diagrams on, the kinds a
 * diagram replaces are left out, since new ones are refused. */
export const referenceBlockTypes = (animationsEnabled: boolean) =>
  desktopBlockTypes(animationsEnabled).filter(
    (type) =>
      !animationsEnabled ||
      !RETIRED_BLOCK_TYPES.some((retired) => retired === type),
  );

const COMPONENT_EXAMPLE =
  'Example (replace its path and lines with verified ones): {"type":"sequence","title":"Request","actors":{"a":"Client","b":"Server"},"steps":[{"from":"a","to":"b","label":"Send","source":"head/src/app.ts#L10-L20"}]}';

const DIAGRAM_EXAMPLE =
  'Example (replace its path and lines with verified ones): {"type":"code_peek","source":"head/src/app.ts#L10-L20"}. Write a diagram as files: see session_get_instructions({topic:"diagram"}).';

/** What the authoring guide says about diagrams: its own passages, and
 * what replaces each with diagrams on. */
const GUIDE: Record<"on" | "off", Record<string, string>> = {
  off: {
    "design-diagram": [
      "    - pick one diagram that best shows the shape of the change:",
      "      - `sequence` if participants interact over time (who calls whom, async handoffs)",
      "      - `flow_diagram` if the interesting part is branches, retries or state transitions",
      "      - `database_lens` if the interesting part is a schema change to the data stores, and/or who reads/writes it",
    ].join("\n"),
    "implementation-diagram":
      "    - `call_stack_diff` for the old vs. new path through user flows. always root the flows in the user/agent entry point (eg a button click, CLI command, etc.), including unchanged nodes along the way.",
    visuals:
      "`code_peek`, `sequence`, `flow_diagram`, `call_stack_diff` or `database_lens`",
  },
  on: {
    "design-diagram": [
      '    - pick one diagram that best shows the shape of the change. read `session_get_instructions({topic:"diagram"})` before your first one:',
      "      - a `diagram` of the parts and the wires between them, with steps that move a request along the wires if participants interact over time (who calls whom, async handoffs), and scenarios for branches, retries or other paths",
      "      - `database_lens` if the interesting part is a schema change to the data stores, and/or who reads/writes it",
    ].join("\n"),
    "implementation-diagram":
      "    - a `diagram` of the old vs. new path through user flows, as two scenarios (before, after) whose steps walk the calls. always root the flows in the user/agent entry point (eg a button click, CLI command, etc.), including unchanged nodes along the way. link every node and wire to its code.",
    visuals: "`code_peek`, `diagram` or `database_lens`",
  },
};

const cache = new Map<string, Promise<string>>();

function read(root: string, name: string): Promise<string> {
  const file = path.join(root, "instructions", `${name}.md`);
  let content = cache.get(file);

  if (!content) {
    content = readFile(file, "utf8").catch((error) => {
      cache.delete(file);
      throw error;
    });
    cache.set(file, content);
  }

  return content;
}

export async function renderInstructions(
  topic: InstructionTopic,
  context: InstructionContext,
  root = findReviewPackageRoot(import.meta.url),
): Promise<string> {
  if (
    (topic === "animation" || topic === "diagram") &&
    !context.animationsEnabled
  )
    throw new ReviewInputError(
      "Animation authoring is disabled. Enable Animations in Settings under Experimental Features.",
      409,
    );

  if (topic === "trace-archaeology" && !context.traceEnabled)
    return "Trace capture is off on this machine, so no agent traces are available. It can be turned on in Whiteboard Desktop Settings under Experimental Features.";

  if (topic !== "authoring") return read(root, topic);

  // The guide names the diagram kinds of its day; with diagrams on, each of
  // those passages gives way to its diagram form.
  const authoring = Object.entries(GUIDE.off).reduce(
    (text, [name, passage]) =>
      context.animationsEnabled ? text.replace(passage, GUIDE.on[name]!) : text,
    await read(root, "authoring"),
  );

  const more = [
    ...(context.traceEnabled
      ? [
          '- Why code exists / past agent sessions: `session_get_instructions({topic:"trace-archaeology"})`',
        ]
      : []),
  ];

  return [
    authoring,
    [
      componentReference(
        referenceBlockTypes(context.animationsEnabled === true),
      ),
      "",
      context.animationsEnabled ? DIAGRAM_EXAMPLE : COMPONENT_EXAMPLE,
    ].join("\n"),
    ...(context.traceEnabled
      ? [
          '## Traces\n\nAt the end, run `whiteboard trace list --session <sessionId> --json`, which covers every commit in the review. If it lists no sessions, there are no traces to quote: skip this step. Otherwise read `session_get_instructions({topic:"trace-archaeology"})` and rewrite as much as possible of the what/why, design, and requirements sections in terms of literal trace quotes from the user.',
        ]
      : []),
    ...(more.length ? [`## More guidance\n\n${more.join("\n")}`] : []),
  ].join("\n\n");
}
