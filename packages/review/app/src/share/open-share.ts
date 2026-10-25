import type { SavedMap } from "@canvas/api-document";
import type { WhiteboardData, WhiteboardHost } from "@canvas/whiteboard";
import {
  ReviewCommitSummarySchema,
  type ReviewTheme,
} from "@dev.fast/review-protocol";
import { shareBundleSchema } from "@dev.fast/review-share-protocol";
import { lensSchema } from "@review/review-api/diff-lenses";
import { documentSchema, pinsSchema } from "@review/review-api/document";
import type { Snapshot } from "@review/review-api/store";
import { traceSchema } from "@review/review-api/trace-schema";
import { z } from "zod";

import { boardData } from "./board-data";
import { shareInlineEditors } from "./inline-editors";
import { libavoidWasmUrl, shareHost } from "./share-host";

export interface ShareView {
  title: string;
  repository?: { cloneUrl: string };
  data: WhiteboardData;
  host: WhiteboardHost;
  dispose(): void;
}

const snapshotSchema = z.looseObject({
  reviewId: z.string().min(1),
  version: z.number().int().nonnegative(),
  title: z.string(),
  pins: pinsSchema.optional(),
  document: documentSchema,
  lenses: z.array(lensSchema).optional(),
  createdAt: z.string(),
});

/** Reads a review-share/2 bundle into a board and a read-only host. */
export async function openShare(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Share boundary: shareBundleSchema parses it.
  share: unknown,
  options: { theme?: ReviewTheme; wasmUrl?: string } = {},
): Promise<ShareView> {
  const bundle = shareBundleSchema.parse(share);
  const { pins, ...rest } = snapshotSchema.parse(bundle.snapshot);

  const snapshot: Snapshot = {
    ...rest,
    ...(pins && { pins, target: { kind: "commits", ...pins } }),
    shared: { cloneUrl: bundle.repository?.cloneUrl },
  };

  const data = boardData({
    snapshot,
    traces: z.record(z.string(), traceSchema).parse(bundle.traces),
    // SAFETY: the sharer wrote these from its own saved maps; a malformed
    // one fails inside its block's boundary.
    maps: bundle.maps as Record<string, SavedMap>,
    commits: z.array(ReviewCommitSummarySchema).parse(bundle.commits),
    progress: {
      complete: true,
      files: [],
      lenses: [],
      resolvedSelections: bundle.selections,
    },
  });

  const host = shareHost({
    theme: options.theme ?? "system",
    wasmUrl: options.wasmUrl ?? libavoidWasmUrl(),
    inlineEditors: await shareInlineEditors(bundle.sources, pins),
  });

  return {
    title: bundle.title,
    ...(bundle.repository && { repository: bundle.repository }),
    data,
    host,
    dispose() {
      host.dispose();
    },
  };
}
