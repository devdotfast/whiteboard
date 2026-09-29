import type { ReviewView } from "@dev.fast/review-protocol";

export type { ReviewView } from "@dev.fast/review-protocol";

/** The views a canvas offers, in switcher order. */
export function offeredReviewViews({
  hasChangeRange,
  softwareMapEnabled,
  hasTraceSessions,
}: {
  hasChangeRange: boolean;
  softwareMapEnabled: boolean;
  hasTraceSessions: boolean;
}): readonly ReviewView[] {
  return [
    "review",
    ...(hasChangeRange ? (["commits", "diff"] as const) : []),
    ...(softwareMapEnabled ? (["map"] as const) : []),
    ...(hasTraceSessions ? (["trace"] as const) : []),
  ];
}

export function reviewViewLabel(view: ReviewView): string {
  if (view === "map") return "Map";

  if (view === "diff") return "Diff";

  if (view === "commits") return "Commits";

  if (view === "trace") return "Trace";

  return "Whiteboard";
}

export function shouldCloseSidePeekForReviewView(view: ReviewView): boolean {
  return view !== "review";
}
