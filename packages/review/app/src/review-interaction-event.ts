import { z } from "zod";

export const REVIEW_INTERACTION_EVENT = "review-interaction";

const ReviewInteractionDetailSchema = z.object({
  kind: z.literal("inline-hover"),
  path: z.string(),
});

export type ReviewInteractionDetail = z.infer<
  typeof ReviewInteractionDetailSchema
>;

export function emitReviewInteraction(
  target: HTMLElement | null,
  detail: ReviewInteractionDetail,
): void {
  target?.dispatchEvent(
    new CustomEvent<ReviewInteractionDetail>(REVIEW_INTERACTION_EVENT, {
      bubbles: true,
      detail,
    }),
  );
}

export function reviewInteractionDetail(
  event: Event,
): ReviewInteractionDetail | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail = ReviewInteractionDetailSchema.safeParse(event.detail);

  return detail.success ? detail.data : null;
}
