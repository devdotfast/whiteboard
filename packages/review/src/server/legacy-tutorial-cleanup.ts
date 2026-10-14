import { rm } from "node:fs/promises";
import path from "node:path";

import type { LocalReviewData } from "@review/review-api/local-data";
import type { ReviewStore } from "@review/review-api/store";
import { devReviewHome } from "@review/review-home-paths";

/**
 * Earlier versions shipped a three-minute tutorial: a managed review over a
 * sample checkout under ~/.dev/tutorial. Whiteboard no longer has one, so
 * remove what an earlier version left behind. Best effort: a failure leaves
 * it for the next start.
 */
export async function removeLegacyTutorial(input: {
  store: ReviewStore;
  data: LocalReviewData;
  root?: string;
}): Promise<void> {
  const tutorialRoot = input.root ?? path.join(devReviewHome(), "tutorial");

  try {
    for (const reviewId of input.store.legacyTutorialIds())
      await input.store.execute({ operation: { type: "delete", reviewId } });

    for (const repository of input.store.repositories()) {
      const relative = path.relative(tutorialRoot, repository.path);

      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative))
        await input.data.forgetRepository(repository.id);
    }

    // Windows cannot delete a checkout while its Git reader or watchers
    // hold it open, and handles can outlive their close briefly.
    await rm(tutorialRoot, { recursive: true, force: true, maxRetries: 10 });
  } catch (error) {
    console.warn("[Whiteboard] Removing the old tutorial failed:", error);
  }
}
