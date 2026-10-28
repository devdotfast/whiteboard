import { z } from "zod";

import { ReviewInputError } from "../input-error.js";
import {
  type Anchor,
  type DiffSelection,
  anchorSchema,
  parseAnchor,
} from "../lens-selection.js";
import { codeFields } from "./code.js";
import {
  type BlockDefinition,
  defineBlock,
  elementPins,
  identity,
  label,
  requireKey,
  text,
} from "./definition.js";

/** A call that needs more lines than this is rare; a function body is not. */
const callSiteLines = 12;

export const stepSchema = z
  .strictObject({
    ...identity,
    type: z.literal("step").default("step"),
    from: label,
    to: label,
    label,
    style: z.enum(["call", "return", "async"]).default("call"),
    /** The call site this arrow stands for, then any ranges directly about
     * that call, each shown as its own card. */
    source: z
      .union([anchorSchema, z.array(anchorSchema).min(1).max(4)], {
        error: "source must be one range or a list of 1 to 4 ranges",
      })
      .optional(),
    pins: elementPins,
    explanation: label.optional(),
    code: z.strictObject(codeFields).optional(),
  })
  .refine(
    (s) =>
      [s.source, s.explanation, s.code].filter((v) => v !== undefined)
        .length === 1,
    "A step needs exactly one of source, explanation, or code.",
  );

export type Step = z.infer<typeof stepSchema>;

/** A step's ranges in order; a single anchor is a list of one. */
export function stepSources(step: Pick<Step, "source">): Anchor[] {
  return step.source === undefined ? [] : [step.source].flat();
}

/** Kept for callers that parsed sequences directly. */
export const sequenceSchema = defineBlock("sequence", {
  title: label,
  actors: z.record(text, label),
  steps: z.array(stepSchema),
  pins: elementPins,
});

export type SequenceBlock = z.infer<typeof sequenceSchema>;

export const sequence = {
  type: "sequence",
  schema: sequenceSchema,
  check(block: SequenceBlock) {
    const pins = (step: Step) => JSON.stringify(step.pins ?? block.pins);

    for (const step of block.steps) {
      requireKey(block.actors, step.from);
      requireKey(block.actors, step.to);

      const own = stepSources(step);

      for (const [at, range] of own.entries()) {
        if (own.some((other, index) => index !== at && covers(range, other)))
          throw new ReviewInputError(
            `Range ${range} repeats another range of its step.`,
          );

        // A range after the call site that holds another step's range is
        // that step's code: the callee is the next step, not more of this
        // one. The call site itself may repeat, as a call and its return do.
        for (const [index, other] of block.steps.entries())
          if (
            at > 0 &&
            other !== step &&
            pins(other) === pins(step) &&
            stepSources(other).some((theirs) => covers(range, theirs))
          )
            throw new ReviewInputError(
              `Range ${range} is step ${index + 1}'s code; link the step instead.`,
            );
      }
    }
  },
  advise(block: SequenceBlock) {
    return block.steps.flatMap((step, index) =>
      stepSources(step).flatMap((range) => {
        const lines = oneSideLines(parseAnchor(range)!);

        return lines && lines > callSiteLines
          ? [
              `Step ${index + 1} of "${block.title}" pins ${lines} lines at ${range}. A step's source is its call site; pin the call, not the function body.`,
            ]
          : [];
      }),
    );
  },
} satisfies BlockDefinition<SequenceBlock>;

/** Lines in a one-sided selection; a selection across sides has no count. */
function oneSideLines({ start, end }: DiffSelection): number | undefined {
  return start.side === end.side ? end.line - start.line + 1 : undefined;
}

/** Whether `outer` equals or contains `inner`, in the same file. Across
 * sides, only the same anchor counts. */
function covers(outer: Anchor, inner: Anchor): boolean {
  if (outer === inner) return true;
  const a = parseAnchor(outer)!;
  const b = parseAnchor(inner)!;

  return (
    a.file === b.file &&
    oneSideLines(a) !== undefined &&
    oneSideLines(b) !== undefined &&
    a.start.side === b.start.side &&
    a.start.line <= b.start.line &&
    a.end.line >= b.end.line
  );
}
