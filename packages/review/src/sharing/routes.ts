import { ReviewInputError } from "@review/review-api/document.js";

import type { SharedReviewStore } from "./import.js";

/** Snapshot-backed reads used by the same HTTP routes as local reviews. */
export class SharedReviewData {
  constructor(private readonly store: SharedReviewStore) {}

  map(id: string, resourceId: string) {
    const { maps } = this.store.get(id);

    if (!Object.hasOwn(maps, resourceId))
      throw new ReviewInputError("Map is not included in this share.", 404);

    return maps[resourceId]!;
  }

  async resource(id: string, resourceId: string) {
    const { bundle } = this.store.get(id);

    if (Object.hasOwn(bundle.images, resourceId))
      return {
        data: Buffer.from(bundle.images[resourceId]!.png, "base64"),
        mimeType: "image/png",
      };

    if (Object.hasOwn(bundle.traces, resourceId))
      return {
        data: Buffer.from(JSON.stringify(bundle.traces[resourceId])),
        mimeType: "application/json",
      };

    throw new ReviewInputError("Resource is not included in this share.", 404);
  }
}
