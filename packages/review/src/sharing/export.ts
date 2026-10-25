import { createHash } from "node:crypto";

import {
  MAX_SHARE_BYTES,
  MAX_SHARE_MANIFEST_BYTES,
  MAX_SHARE_OBJECT_BYTES,
  SHARE_FORMAT,
  type ShareManifest,
  shareManifestSchema,
} from "@dev.fast/review-share-protocol";
import { sourceAnchors } from "@review/lens-selection.js";
import { markdownNodes, parseMarkdown } from "@review/markdown.js";
import { lensSelections } from "@review/review-api/diff-lenses.js";
import { ReviewInputError } from "@review/review-api/document.js";
import {
  anchorPins,
  boardRepositoryId,
  checkReferences,
  documentSchema,
  elements,
  readsAtBoardPins,
  resourceReference,
  resourceReferences,
  sourceReferences,
} from "@review/review-api/document.js";
import type { LocalReviewData } from "@review/review-api/local-data.js";
import type { ReviewStore, Snapshot } from "@review/review-api/store.js";
import { z } from "zod";

export interface ShareBundle {
  manifest: ShareManifest;
  objects: Map<string, Uint8Array>;
  attribution?: { login: string; sharedAt: number };
}

export type ShareExportStore = Pick<ReviewStore, "read" | "resource">;

export type ShareExportData = Pick<
  LocalReviewData,
  "map" | "validateResource" | "validateSource"
>;

export function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateShareSources(
  snapshot: Pick<Snapshot, "pins" | "document" | "lenses">,
) {
  if (!snapshot.pins && readsAtBoardPins(snapshot))
    throw new ReviewInputError(
      "Reviews with code references need source pins before sharing.",
      409,
    );
}

/** The commits a board's references read at besides its base and head. A
 * recipient fetches them too. A shared board names no repository of its
 * own, so one stands in for its commit links. */
export function referenceCommits(
  snapshot: Pick<Snapshot, "pins" | "document" | "target">,
  repositoryId = boardRepositoryId(snapshot) ?? "shared",
): string[] {
  const own = new Set([snapshot.pins?.base, snapshot.pins?.head]);
  const commits = new Set<string>();

  for (const { source } of sourceReferences(snapshot.document, {
    tolerant: true,
    repositoryId,
  }))
    for (const commit of [source.pins?.base, source.pins?.head])
      if (commit && !own.has(commit)) commits.add(commit);

  return [...commits].sort();
}

/** Freeze one stored version before any asynchronous source reads. */
export async function exportShare(input: {
  store: ShareExportStore;
  data: ShareExportData;
  reviewId: string;
  version?: number;
  repository?: ShareManifest["repository"];
}): Promise<ShareBundle> {
  const stored = structuredClone(
    input.store.read(input.reviewId, input.version),
  );

  // Commit links read from the board's repository, which a plan names only
  // in its target.
  const repositoryId = boardRepositoryId(stored);

  // Local-only fields stay home; the target names a local checkout.
  const {
    target,
    staleSources: _staleSources,
    sourceUnavailable: _sourceUnavailable,
    lastEdit: _lastEdit,
    trashedAt: _trashedAt,
    personEdit: _personEdit,
    ...snapshot
  } = stored;

  if (target?.kind === "worktree")
    throw new ReviewInputError("Pin this review to commits before sharing it.");

  documentSchema.parse(snapshot.document);
  checkReferences(snapshot.document);
  const objects = new Map<string, Uint8Array>();
  let totalBytes = 0;

  const add = (bytes: Uint8Array) => {
    if (bytes.byteLength > MAX_SHARE_OBJECT_BYTES)
      throw new ReviewInputError("A shared object exceeds the upload limit.");
    const id = digestBytes(bytes);

    if (!objects.has(id)) {
      totalBytes += bytes.byteLength;

      if (totalBytes > MAX_SHARE_BYTES)
        throw new ReviewInputError("Review exceeds the sharing limit.");
      objects.set(id, Uint8Array.from(bytes));
    }

    return id;
  };

  const json = <Value>(value: Value) => add(Buffer.from(JSON.stringify(value)));
  const resources: ShareManifest["resources"] = [];
  const maps: Record<string, Awaited<ReturnType<LocalReviewData["map"]>>> = {};

  // Lens ranges travel with the snapshot and must resolve at its pins too.
  const sources = [
    ...sourceReferences(snapshot.document, { repositoryId }),
    ...lensSelections(snapshot.lenses ?? []).flatMap((selection) =>
      sourceAnchors(selection.source).map((source) => ({
        ...selection,
        source,
        peek: false,
      })),
    ),
  ];

  const pins = snapshot.pins;

  validateShareSources(snapshot);

  if ((pins || referenceCommits(stored).length) && !input.repository)
    throw new ReviewInputError("Shared source pins require a repository.", 409);

  for (const block of elements(snapshot.document)) {
    if (block.type !== "markdown") continue;

    for (const node of markdownNodes(parseMarkdown(block.markdown)))
      if (node.type === "image")
        throw new ReviewInputError(
          "Convert Markdown images to managed image blocks before sharing.",
        );
  }

  for (const block of resourceReferences(snapshot.document)) {
    await input.data.validateResource(pins, block);

    const reference = resourceReference(block);

    if (
      !reference ||
      resources.some((resource) => resource.id === reference.id)
    )
      continue;
    const { id } = reference;
    const resource = input.store.resource(id);
    resources.push({
      id,
      kind: z.enum(["image", "trace", "map"]).parse(resource.kind),
      mimeType: z
        .enum(["image/png", "application/json"])
        .parse(resource.mimeType),
      object: add(resource.data),
    });

    if (block.type === "software_map") {
      const map = await input.data.map(pins, id);
      Object.defineProperty(maps, id, { value: map, enumerable: true });

      for (const element of map.elements)
        for (const range of element.sourceRanges ?? [])
          sources.push({
            id: `${id}:${element.id}`,
            source: { ...range, side: map.side },
          });
    }
  }

  for (const reference of sources)
    await input.data.validateSource(
      anchorPins(reference.source, pins),
      reference.source,
      { peek: reference.peek ?? false },
    );

  const snapshotId = json(snapshot);
  const presentationId = json({ maps });

  const manifest = shareManifestSchema.parse({
    format: SHARE_FORMAT,
    reviewId: snapshot.reviewId,
    version: snapshot.version,
    title: snapshot.title,
    snapshot: snapshotId,
    presentation: presentationId,
    objects: [...objects].map(([id, bytes]) => ({
      id,
      sha256: id,
      size: bytes.byteLength,
    })),
    resources,
    repository: input.repository,
  });

  if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_SHARE_MANIFEST_BYTES)
    throw new ReviewInputError("The share manifest exceeds the upload limit.");

  return { manifest, objects };
}
