import {
  type BoardTrace,
  type SavedMap,
  createDocumentLoader,
  savedMapModel,
} from "@canvas/api-document";
import { createCanvasQueryClient } from "@canvas/canvas-query";
import { hostApiClient } from "@canvas/host/review-session";
import type { WhiteboardData } from "@canvas/whiteboard";
import type { ReviewCommitSummary } from "@dev.fast/review-protocol";
import { resourceReferences } from "@review/review-api/document";
import type { ReviewProgress } from "@review/review-api/review-progress";
import type { Snapshot } from "@review/review-api/store";

export interface BoardImage {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
}

/** A board read whole, with no host to read from. */
export interface BoardParts {
  snapshot: Snapshot;
  images?: Record<string, BoardImage>;
  traces?: Record<string, BoardTrace>;
  maps?: Record<string, SavedMap>;
  commits?: ReviewCommitSummary[];
  progress?: ReviewProgress;
}

/** Images read from blob URLs the caller revokes. */
export function boardData(parts: BoardParts): WhiteboardData {
  const { snapshot } = parts;

  const data = createDocumentLoader(
    hostApiClient({}),
    createCanvasQueryClient(),
  ).draft(snapshot);

  for (const node of resourceReferences(snapshot.document)) {
    const image = node.type === "image" && parts.images?.[node.assetId];
    const trace = node.type === "trace_quote" && parts.traces?.[node.traceId];

    const saved =
      node.type === "software_map" && parts.maps?.[node.mapVersionId];

    if (node.type === "image" && image && !data.images.has(node.assetId))
      data.images.set(
        node.assetId,
        URL.createObjectURL(new Blob([image.bytes], { type: image.type })),
      );

    if (node.type === "trace_quote" && trace)
      data.traces.set(node.traceId, trace);

    if (node.type === "software_map" && saved) {
      const model = savedMapModel(saved);

      data.maps.set(node.mapVersionId, {
        ...model,
        pinnedData: { ...model.pinnedData, diagramId: node.id },
      });
    }
  }

  return {
    ...data,
    commits: parts.commits ?? [],
    progress: parts.progress,
  };
}
