import {
  type StructuralDiff,
  type StructuralDiffEvent,
  StructuralDiffEventSchema,
  type StructuralRegion,
  type StructuralSource,
  type StructuralUpdate,
  type StructuralVisibility,
} from "@dev.fast/diffr";
import { z } from "zod";

// Review transport errors are separate from diffr file outcomes.
const ReviewStructuralDiffErrorSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});

export type ReviewStructuralDiffEvent =
  | StructuralDiffEvent
  | z.infer<typeof ReviewStructuralDiffErrorSchema>;

const ReviewStructuralDiffEventSchema = z.union([
  StructuralDiffEventSchema,
  ReviewStructuralDiffErrorSchema,
]);

export function decodeReviewStructuralDiffEvent(
  line: string,
): ReviewStructuralDiffEvent {
  try {
    return ReviewStructuralDiffEventSchema.parse(JSON.parse(line));
  } catch (cause) {
    throw new Error("Malformed diffr protocol record.", { cause });
  }
}

type StructuralTextDiff = Extract<StructuralDiff, { type: "text" }>;

/**
 * A copy of `diff` with an update's region visibility and visible counts.
 * `accept` may change what a region takes from its entry.
 */
export function applyStructuralUpdate(
  diff: StructuralTextDiff,
  update: Extract<StructuralUpdate, { regions: unknown[] }>,
  accept: (
    region: StructuralRegion,
    next: StructuralVisibility,
  ) => StructuralVisibility = (_, next) => next,
): StructuralTextDiff {
  const entries = new Map(
    update.regions.map(({ id, ...visibility }) => [id, visibility]),
  );

  const visit = (region: StructuralRegion): StructuralRegion => {
    const entry = entries.get(region.id);
    let next = region;

    if (entry) {
      const { collapsed, label } = accept(region, entry);
      const { visibility: _, ...rest } = region;

      next =
        collapsed || label
          ? {
              ...rest,
              visibility: {
                ...(collapsed && { collapsed }),
                ...(label && { label }),
              },
            }
          : rest;
    }

    return next.kind === "fold"
      ? { ...next, children: next.children.map(visit) }
      : next;
  };

  const side = (source: StructuralSource) => ({
    ...source,
    root: visit(source.root),
  });

  return {
    ...diff,
    ...(diff.lhs && { lhs: side(diff.lhs) }),
    ...(diff.rhs && { rhs: side(diff.rhs) }),
    stats: { ...diff.stats, visible: update.visible },
  };
}
