import {
  type JsonObject,
  type JsonValue,
  isJsonObject,
} from "@dev.fast/review-protocol";
import { lensSchema } from "@review/review-api/diff-lenses.js";
import { documentSchema, pinsSchema } from "@review/review-api/document.js";
import {
  normalizedSoftwareElementSchema,
  normalizedSoftwareRelationshipSchema,
} from "@review/software-map-model.js";
import {
  liftFileLenses,
  migrateStoredDocument,
  migrateStoredLenses,
} from "@review/stored-document-migration.js";
import { z } from "zod";

// The share's JSON objects, without Node: the web viewer reads them too.

/** A full commit id, SHA-1 or SHA-256. */
export const COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export const sharedSnapshotSchema = z.strictObject({
  reviewId: z.string().min(1),
  version: z.number().int().nonnegative(),
  /** Empty for a board never named; it reads "Untitled". */
  title: z.string(),
  pins: pinsSchema
    .extend({
      base: z.string().regex(COMMIT_ID),
      head: z.string().regex(COMMIT_ID),
    })
    .optional(),
  document: documentSchema,
  lenses: z.array(lensSchema).optional(),
  createdAt: z.string(),
  origin: z
    .strictObject({
      branch: z.string().optional(),
      baseRef: z.string().optional(),
      pullRequestNumber: z.number().int().positive().optional(),
      // Shown as a link: someone else's share names it.
      pullRequestUrl: z.url({ protocol: /^https$/ }).optional(),
      pullRequestTitle: z.string().optional(),
      revision: z.string().optional(),
    })
    .optional(),
});

const count = z.number().int().nonnegative();

const counts = z.strictObject({ additions: count, deletions: count });

const mapSchema = z.strictObject({
  commit: z.string().regex(COMMIT_ID),
  side: z.enum(["base", "head"]),
  // The map renderers walk parents until there are none.
  elements: z
    .array(normalizedSoftwareElementSchema)
    .refine(
      (elements) => !nestsInCycle(elements),
      "Software map elements nest in a cycle.",
    ),
  relationships: z.array(normalizedSoftwareRelationshipSchema),
  countsByElementPath: z.record(z.string(), counts),
  unmappedByElementPath: z.record(
    z.string(),
    counts.extend({
      files: z.array(
        counts.extend({
          file: z.string(),
          hunks: z.array(
            z.strictObject({
              startLine: count,
              lines: z.array(
                z.strictObject({
                  kind: z.enum(["add", "remove"]),
                  oldLine: count.nullable(),
                  newLine: count.nullable(),
                  text: z.string(),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
});

/** Whether following `parentPath` from some element never ends. Each
 * element's chain is walked once. */
function nestsInCycle(
  elements: readonly { path: string; parentPath?: string }[],
): boolean {
  const parents = new Map(elements.map((item) => [item.path, item.parentPath]));
  const settled = new Set<string>();

  for (const { path } of elements) {
    const chain = new Set<string>();

    for (
      let at: string | undefined = path;
      at !== undefined && !settled.has(at);
      at = parents.get(at)
    ) {
      if (chain.has(at)) return true;
      chain.add(at);
    }

    for (const visited of chain) settled.add(visited);
  }

  return false;
}

export const sharePresentationSchema = z.strictObject({
  maps: z.record(z.string(), mapSchema),
});

/** Bundles shared before a field was retired still open; the bytes stay
 * sealed and only the parsed document drops the retired form. Lenses shared
 * as document blocks read as the snapshot's lenses. */
export function parseSharedSnapshot(stored: JsonValue) {
  return sharedSnapshotSchema.parse(
    isJsonObject(stored) && "document" in stored
      ? liftSharedLenses(stored, migrateStoredDocument(stored.document))
      : stored,
  );
}

function liftSharedLenses(stored: JsonObject, migrated: JsonValue): JsonObject {
  const { document, lenses } = liftFileLenses(migrated);

  // SAFETY: migration returns the array it was given, rewritten.
  const kept = Array.isArray(stored.lenses)
    ? (migrateStoredLenses(stored.lenses) as JsonValue[])
    : [];

  return {
    ...stored,
    document,
    ...((kept.length || lenses.length) && { lenses: [...kept, ...lenses] }),
  };
}
