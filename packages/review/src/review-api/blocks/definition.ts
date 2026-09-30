import { ReviewInputError } from "@review/review-api/input-error.js";
import { sourcePinsSchema } from "@review/source.js";
import { z } from "zod";

export const text = z.string();

export const label = text.trim().min(1);

export const identity = { id: text.optional() };

/** The repository and commits an element's anchors quote. A step, frame,
 * attachment or operation without them reads its block's; a block without
 * them reads its document's. */
export const elementPins = sourcePinsSchema
  .optional()
  .describe("Pins for the anchors here; needed on the scratchpad.");

/**
 * One block kind: the strict schema the store parses with, and the rules a
 * field schema cannot express. `check` throws ReviewInputError.
 */
export interface BlockDefinition<Content extends { type: string }> {
  type: Content["type"];
  schema: z.ZodType<Content>;
  check?(block: Content): void;
}

/** The strict schema for a block's own fields; id and type are added here. */
export function defineBlock<
  Type extends string,
  Props extends Record<string, z.ZodType>,
>(type: Type, props: Props) {
  return z.strictObject({ ...identity, type: z.literal(type), ...props });
}

/** Shared by every check that resolves a component-local name. */
export function requireKey<T>(record: Record<string, T>, name: string): void {
  if (!Object.hasOwn(record, name))
    throw new ReviewInputError(`Unknown component name: ${name}`);
}
