import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

import { type JsonObject, type JsonValue } from "@dev.fast/review-protocol";
import {
  type ShareBundle,
  capabilitySchema,
  shareBundleSchema,
} from "@dev.fast/review-share-protocol";
import { textIncludesQuote } from "@review/evidence.js";
import { lensSchema } from "@review/review-api/diff-lenses.js";
import { ReviewInputError } from "@review/review-api/document.js";
import {
  type Pins,
  checkReferences,
  documentSchema,
  pinsSchema,
  resourceReferences,
} from "@review/review-api/document.js";
import type { LocalReviewData } from "@review/review-api/local-data.js";
import { pullRequestUrl } from "@review/review-api/origin.js";
import type { ReviewStore } from "@review/review-api/store.js";
import { traceSchema } from "@review/review-api/trace-schema.js";
import {
  devReviewHome,
  safeStorageSegment,
} from "@review/review-home-paths.js";
import { softwareModelDataSchema } from "@review/software-map-model.js";
import {
  liftFileLenses,
  migrateStoredDocument,
  migrateStoredLenses,
} from "@review/stored-document-migration.js";
import { z } from "zod";

import { referenceCommits, validateShareSources } from "./export.js";
import {
  COMMIT_ID,
  assertCommitIds,
  cloneSharedRepository,
  fetchPinnedRepository,
  fetchSharedCommits,
  sharedGit,
} from "./repository.js";

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
      baseBranch: z.string().optional(),
      pullRequestNumber: z.number().int().positive().optional(),
      pullRequestUrl: pullRequestUrl.optional(),
      pullRequestTitle: z.string().optional(),
      pullRequestBaseBranch: z.string().optional(),
      revision: z.string().optional(),
    })
    .optional(),
});

const count = z.number().int().nonnegative();

const counts = z.strictObject({ additions: count, deletions: count });

const mapSchema = softwareModelDataSchema.extend({
  commit: z.string().regex(COMMIT_ID),
  side: z.enum(["base", "head"]),
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

export const sharePresentationSchema = z.strictObject({
  maps: z.record(z.string(), mapSchema),
});

export interface ShareAttribution {
  login: string;
  sharedAt: number;
}

/** Commits and traces live in a checkout; a document alone needs none. */
function needsRepository(
  bundle: ShareBundle,
  snapshot: Parameters<typeof referenceCommits>[0],
) {
  return Boolean(
    snapshot.pins ||
    referenceCommits(snapshot).length ||
    Object.keys(bundle.traces).length,
  );
}

export function validateShareBundle(input: ShareBundle) {
  const bundle = shareBundleSchema.parse(input);
  // SAFETY: a bundle is parsed from JSON, so its snapshot is a JSON object.
  const stored = bundle.snapshot as JsonObject;

  // Bundles shared before a field was retired still open; only the parsed
  // document drops the retired form. Lenses shared as document blocks read
  // as the snapshot's lenses.
  const snapshot = sharedSnapshotSchema.parse(
    stored.document === undefined
      ? stored
      : liftSharedLenses(stored, migrateStoredDocument(stored.document)),
  );

  if (
    snapshot.reviewId !== bundle.reviewId ||
    snapshot.version !== bundle.version ||
    snapshot.title !== bundle.title
  )
    throw new Error("Shared snapshot does not match its bundle.");
  checkReferences(snapshot.document);
  validateShareSources(snapshot);
  // Every commit it quotes reaches git as an argument.
  assertCommitIds(referenceCommits(snapshot));

  if (needsRepository(bundle, snapshot) && !bundle.repository)
    throw new ReviewInputError(
      "This share can only be viewed in the browser.",
      409,
    );

  const maps = z.record(z.string(), mapSchema).parse(bundle.maps);

  if (!snapshot.pins && Object.keys(maps).length)
    throw new Error("Shared maps require source pins.");

  const traces = new Map<
    string,
    Map<string, z.infer<typeof traceSchema>["events"][number]>
  >();

  for (const block of resourceReferences(snapshot.document)) {
    if (block.type === "trace_quote") {
      let events = traces.get(block.traceId);

      if (!events) {
        if (!Object.hasOwn(bundle.traces, block.traceId))
          throw new Error("Missing shared trace.");
        const trace = traceSchema.parse(bundle.traces[block.traceId]);
        events = new Map(trace.events.map((event) => [event.id, event]));

        if (events.size !== trace.events.length)
          throw new Error("Duplicate shared trace event.");
        traces.set(block.traceId, events);
      }

      const event = events.get(block.eventId);

      if (!event || !textIncludesQuote(event.text, block.text))
        throw new Error("Shared quote does not match its trace.");
    }

    if (block.type === "software_map") {
      const map = Object.hasOwn(maps, block.mapVersionId)
        ? maps[block.mapVersionId]
        : undefined;

      if (!map || map.commit !== snapshot.pins?.[map.side])
        throw new Error("Shared map pins do not match.");
    }
  }

  return { bundle, snapshot, maps };
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

/** Names a share link: reopening it finds the copy it made. */
export function shareKey(origin: string, capability: string) {
  const url = new URL(origin);
  capabilitySchema.parse(capability);

  return createHash("sha256")
    .update(JSON.stringify([url.origin, capability]))
    .digest("hex");
}

export interface ShareImport {
  store: ReviewStore;
  data: LocalReviewData;
  fetchRepository?: typeof fetchPinnedRepository;
  cloneRepository?: typeof cloneSharedRepository;
  onStage?: (stage: "fetching" | "validating") => void;
}

/** Imports a share as an ordinary board, once per link: the link's copy
 * comes back while it exists, even from Trash. */
export async function importShare(
  input: ShareImport,
  key: string,
  received: ShareBundle,
  attribution?: ShareAttribution,
): Promise<string> {
  const { store, data } = input;
  const existing = store.copyOf(key);

  if (existing) return existing;
  const { bundle, snapshot, maps } = validateShareBundle(received);
  const cloneUrl = bundle.repository?.cloneUrl;
  let repositoryId: string | undefined;

  // A document is filed on a checkout the receiver already has; it is not
  // worth a clone.
  if (
    cloneUrl &&
    (needsRepository(bundle, snapshot) || store.checkoutsOf(cloneUrl).length)
  ) {
    input.onStage?.("fetching");
    repositoryId = await shareRepository(
      input,
      cloneUrl,
      snapshot.pins,
      referenceCommits(snapshot),
      key,
    );
  }

  const pins =
    snapshot.pins && repositoryId
      ? { ...snapshot.pins, repositoryId }
      : undefined;

  input.onStage?.("validating");

  const ranges = Object.values(maps).flatMap((map) =>
    map.elements.flatMap((element) =>
      (element.sourceRanges ?? []).map((range) => ({
        ...range,
        side: map.side,
      })),
    ),
  );

  if (pins && ranges.length) await data.validateSources(pins, ranges);

  // The copy's resources are its own: the sender's ids may be in this store.
  const ids = new Map(
    [...Object.keys(bundle.traces), ...Object.keys(maps)].map((id) => [
      id,
      randomUUID(),
    ]),
  );

  if (repositoryId) {
    for (const [id, trace] of Object.entries(bundle.traces))
      await data.upload({
        kind: "trace",
        id: ids.get(id),
        repositoryId,
        trace,
      });

    for (const [
      id,
      { commit, side, elements, relationships },
    ] of Object.entries(maps))
      store.putResource(
        ids.get(id)!,
        repositoryId,
        "map",
        "application/json",
        Buffer.from(JSON.stringify({ commit, side, elements, relationships })),
      );
  }

  let document = JSON.stringify(snapshot.document);

  for (const [id, copy] of ids) document = document.replaceAll(id, copy);

  const { reviewId } = await store.execute(
    {
      operation: {
        type: "create",
        ...(snapshot.title && { title: snapshot.title }),
        ...(pins
          ? { target: { kind: "commits", ...pins } }
          : repositoryId && {
              target: { kind: "project", repositoryId },
            }),
      },
    },
    {
      document: JSON.parse(document),
      lenses: snapshot.lenses,
      origin: snapshot.origin,
      shared: { ...attribution, cloneUrl, key },
      copiedFrom: snapshot.reviewId,
    },
    { kind: "person" },
  );

  return reviewId;
}

/** A checkout of the share's repository with every commit it reads at: the
 * receiver's own when they have one, else one Desktop clones. */
async function shareRepository(
  { store, data, ...git }: ShareImport,
  cloneUrl: string,
  pins: Pick<Pins, "base" | "head"> | undefined,
  commits: string[],
  key: string,
) {
  const root = path.join(devReviewHome(), "shared-repositories");

  await mkdir(root, { recursive: true, mode: 0o700 });

  const name = cloneUrl
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .at(-1);

  const managed = path.join(
    await realpath(root),
    `${safeStorageSegment(name || "repository")}-${createHash("sha256").update(cloneUrl).digest("hex").slice(0, 8)}`,
  );

  const own = store
    .checkoutsOf(cloneUrl)
    .find((id) => store.repositoryPath(id) !== managed);

  const cloned = store
    .repositories()
    .some((repository) => repository.path === managed);

  if (!own && !(cloned && existsSync(path.join(managed, ".git")))) {
    await rm(managed, { recursive: true, force: true });

    try {
      if (pins) {
        await (git.fetchRepository ?? fetchPinnedRepository)(
          managed,
          cloneUrl,
          pins,
          false,
          commits,
        );
        await sharedGit(managed, [
          "checkout",
          "--detach",
          { commit: pins.head },
        ]);
      } else
        await (git.cloneRepository ?? cloneSharedRepository)(managed, cloneUrl);
    } catch (error) {
      await rm(managed, { recursive: true, force: true });
      throw error;
    }
  }

  const repositoryId = own ?? (await data.register(managed)).id;

  await fetchSharedCommits(
    store.repositoryPath(repositoryId),
    [...(pins ? [pins.base, pins.head] : []), ...commits],
    key,
  );

  return repositoryId;
}
