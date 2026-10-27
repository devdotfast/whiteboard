import path from "node:path";

import { safeStorageSegment } from "./review-home-paths";

/**
 * Root for Review-owned checkouts. A Review UUID identifies one subtree.
 */
export function reviewManagedCheckoutsDir(gitCommonDir: string): string {
  return path.join(gitCommonDir, "dev-fast", "reviews");
}

/** Return the checkout subtree owned by one Review UUID. */
export function reviewManagedCheckoutRoot(
  gitCommonDir: string,
  reviewUuid: string,
): string {
  return path.join(
    reviewManagedCheckoutsDir(gitCommonDir),
    safeStorageSegment(reviewUuid),
  );
}

/** A detached checkout of one Review's head commit. */
export function reviewManagedCheckoutDir(
  gitCommonDir: string,
  reviewUuid: string,
  commit: string,
): string {
  return path.join(
    reviewManagedCheckoutRoot(gitCommonDir, reviewUuid),
    "head",
    safeStorageSegment(commit),
  );
}
