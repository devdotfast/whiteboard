import type { SavedMap } from "@canvas/api-document";
import type { WhiteboardData, WhiteboardHost } from "@canvas/whiteboard";
import {
  ReviewCommitSummarySchema,
  type ReviewTheme,
} from "@dev.fast/review-protocol";
import { shareBundleSchema } from "@dev.fast/review-share-protocol";
import { traceSchema } from "@review/review-api/trace-schema";
import { z } from "zod";

import { boardSnapshotSchema, boardView } from "./board-data";
import { shareInlineEditors } from "./inline-editors";
import { readOnlyHost } from "./share-host";

export interface ShareView {
  title: string;
  repository?: { cloneUrl: string };
  data: WhiteboardData;
  host: WhiteboardHost;
  dispose(): void;
}

/** Reads a review-share/2 bundle into a board and a read-only host. */
export async function openShare(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Share boundary: shareBundleSchema parses it.
  share: unknown,
  options: { theme?: ReviewTheme; wasmUrl?: string } = {},
): Promise<ShareView> {
  const bundle = shareBundleSchema.parse(share);
  const snapshot = boardSnapshotSchema.parse(bundle.snapshot);
  const { pins } = snapshot;
  const cloneUrl = bundle.repository?.cloneUrl;

  const data = boardView(
    {
      ...snapshot,
      ...(pins && { target: { kind: "commits", ...pins } }),
      shared: { cloneUrl },
    },
    {
      traces: z.record(z.string(), traceSchema).parse(bundle.traces),
      // SAFETY: the sharer wrote these maps; a malformed one fails in its block.
      maps: bundle.maps as Record<string, SavedMap>,
      commits: z.array(ReviewCommitSummarySchema).parse(bundle.commits),
      progress: {
        complete: true,
        files: [],
        lenses: [],
        resolvedSelections: bundle.selections,
      },
    },
  );

  const host = readOnlyHost({
    ...options,
    inlineEditors: await shareInlineEditors(bundle.sources, pins),
  });

  return {
    title: bundle.title,
    ...(bundle.repository && { repository: bundle.repository }),
    data: {
      ...data,
      place: {
        siblings: [],
        ...(cloneUrl && { repository: repositoryLabel(cloneUrl) }),
      },
    },
    host,
    dispose() {
      host.dispose();
    },
  };
}

/** "owner / repo", as Desktop names a board's repository. */
const repositoryLabel = (cloneUrl: string) =>
  new URL(cloneUrl).pathname
    .slice(1)
    .replace(/\.git$/, "")
    .split("/")
    .join(" / ");
