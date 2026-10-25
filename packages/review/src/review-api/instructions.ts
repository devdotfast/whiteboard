import { readFile } from "node:fs/promises";
import path from "node:path";

import { findReviewPackageRoot } from "@review/package-paths.js";
import { z } from "zod";

import { componentReference } from "./component-reference.js";
import { ReviewInputError } from "./input-error.js";

export const INSTRUCTION_TOPICS = [
  "authoring",
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
  if (topic === "animation" && !context.animationsEnabled)
    throw new ReviewInputError(
      "Animation authoring is disabled. Enable Animations in Settings under Experimental Features.",
      409,
    );

  if (topic === "trace-archaeology" && !context.traceEnabled)
    return "Trace capture is off on this machine, so no agent traces are available. It can be turned on in Whiteboard Desktop Settings under Experimental Features.";

  if (topic !== "authoring") return read(root, topic);

  const more = [
    ...(context.traceEnabled
      ? [
          '- Why code exists / past agent sessions: `session_get_instructions({topic:"trace-archaeology"})`',
        ]
      : []),
  ];

  return [
    await read(root, "authoring"),
    componentReference(context.animationsEnabled === true),
    ...(context.traceEnabled
      ? [
          '## Traces\n\nAt the end, run `whiteboard trace list --session <sessionId> --json`, which covers every commit in the review. If it lists no sessions, there are no traces to quote: skip this step. Otherwise read `session_get_instructions({topic:"trace-archaeology"})` and rewrite as much as possible of the what/why, design, and requirements sections in terms of literal trace quotes from the user.',
        ]
      : []),
    ...(more.length ? [`## More guidance\n\n${more.join("\n")}`] : []),
  ].join("\n\n");
}
