import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  type JsonObject,
  type JsonValue,
  REVIEW_SCHEMA_VERSION,
  isJsonObject,
  jsonObject,
  jsonString,
  parseJsonText,
} from "@dev.fast/review-protocol";
import { errorMessage } from "@dev.fast/trace-core";
import { z } from "zod";

import { isMissingFileError } from "./fs-utils";
import { devReviewHome } from "./review-home-paths";
import {
  type ReviewRecord,
  ReviewRecordSchema,
} from "./review-import/legacy-record";
import {
  ReviewBusyError,
  withReviewMutationLock,
} from "./review-mutation-lock";
import { reviewVcs } from "./review-vcs";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DISABLED_REVIEW_SOURCE_SESSION = "disabled:review";

export const StoredReviewRecordSchema = ReviewRecordSchema;

export type StoredReviewRecord = ReviewRecord;

const legacyStoredSourceSessionFields = {
  sourceSession: z.string().min(1).optional(),
  agentSession: z.string().min(1).optional(),
};

const legacyStoredReviewRecordFields = StoredReviewRecordSchema.omit({
  schemaVersion: true,
  sourceSession: true,
});

const LegacyStoredReviewRecordSchema = z
  .union([
    StoredReviewRecordSchema.extend({ schemaVersion: z.literal(4) }),
    legacyStoredReviewRecordFields.extend({
      schemaVersion: z.literal(3),
      ...legacyStoredSourceSessionFields,
    }),
    legacyStoredReviewRecordFields
      .omit({
        presentedDocumentRevision: true,
        presentedSoftwareMapRevision: true,
      })
      .extend({
        schemaVersion: z.literal(2),
        ...legacyStoredSourceSessionFields,
        presentedRevision: z.string().min(1).nullable(),
      }),
  ])
  .refine(
    (record) =>
      Boolean(
        record.sourceSession ||
        ("agentSession" in record && record.agentSession),
      ),
    "A source session is required.",
  );

export interface StoredReview {
  dir: string;
  review: StoredReviewRecord;
}

export interface ReviewHomeError {
  reviewDir: string;
  reviewUuid: string | null;
  title: string;
  worktreePath: string;
  lastPublishedAt: string | null;
  message: string;
  code?: string;
}

export class ReviewHomeScanError extends Error {
  override readonly name = "ReviewHomeScanError";

  constructor(readonly errors: readonly ReviewHomeError[]) {
    super(
      `Could not read reviews:\n${errors.map((error) => `${error.reviewDir}: ${error.message}`).join("\n")}`,
    );
  }
}

export function reviewsHomeDir(devHome = devReviewHome()): string {
  return path.join(devHome, "reviews");
}

export async function sealReviewCandidate(
  dir: string,
  message: string,
): Promise<string> {
  return withReviewMutationLock(dir, () => reviewVcs.seal(dir, message));
}

export async function findReview(
  uuid: string,
  devHome?: string,
): Promise<StoredReview | null> {
  return findReviewRecord(uuid, devHome);
}

export async function findReviewForRepair(
  uuid: string,
  devHome?: string,
): Promise<StoredReview | null> {
  if (!UUID_PATTERN.test(uuid))
    throw new Error(`Review UUID is invalid: ${uuid}`);
  const dir = path.join(reviewsHomeDir(devHome), uuid);
  let value: JsonValue;

  try {
    value = parseJsonText(
      await readFile(path.join(dir, "review.json"), "utf8"),
    );
  } catch (error) {
    if (isMissingFileError(error)) return null;

    const detail: ReviewHomeErrorDetail = {
      message: `Could not read review.json: ${errorMessage(error)}`,
    };

    const code =
      error instanceof Error && "code" in error
        ? z.string().safeParse(error.code)
        : null;

    if (code?.success) detail.code = code.data;
    throw new ReviewHomeScanError([reviewHomeError(dir, undefined, detail)]);
  }

  let review: StoredReviewRecord;

  try {
    review = parseAnyStoredReviewRecord(value);
  } catch (error) {
    throw new ReviewHomeScanError([
      reviewHomeError(dir, jsonObject(value), {
        code: "MIGRATION_REQUIRED",
        message: `Invalid review.json; run \`whiteboard migrate apply\`: ${errorMessage(error)}`,
      }),
    ]);
  }

  if (review.uuid !== uuid)
    throw new ReviewHomeScanError([
      reviewHomeError(dir, review, {
        message: "review.json UUID does not match its directory.",
      }),
    ]);

  return { dir, review };
}

async function findReviewRecord(
  uuid: string,
  devHome?: string,
): Promise<StoredReview | null> {
  if (!UUID_PATTERN.test(uuid)) {
    throw new Error(`Review UUID is invalid: ${uuid}`);
  }

  const loaded = await readStoredReview(
    path.join(reviewsHomeDir(devHome), uuid),
  );

  if ("error" in loaded) {
    if (loaded.error.code === "ENOENT") return null;
    throw new ReviewHomeScanError([loaded.error]);
  }

  if (loaded.review.uuid !== uuid) {
    throw new ReviewHomeScanError([
      reviewHomeError(loaded.dir, loaded.review, {
        message: "review.json UUID does not match its directory.",
      }),
    ]);
  }

  return loaded;
}

export async function materializeReviewRevision(
  dir: string,
  revision: string,
  destinationPath: string,
): Promise<void> {
  const resolvedRevision = await reviewVcs.resolve(dir, revision);
  await reviewVcs.materialize(dir, resolvedRevision, destinationPath);
}

export async function readStoredReview(
  dir: string,
): Promise<StoredReview | { error: ReviewHomeError }> {
  const reviewPath = path.join(dir, "review.json");

  try {
    let value = parseJsonText(await readFile(reviewPath, "utf8"));
    let parsed = safeParseStoredReviewRecord(value);

    if (!parsed.success && isLegacyStoredReviewRecord(value, dir)) {
      try {
        await migrateLegacyStoredReview(dir);
      } catch (error) {
        if (error instanceof ReviewBusyError)
          return {
            error: reviewHomeError(dir, jsonObject(value), {
              code: error.code,
              message: error.message,
            }),
          };

        return {
          error: reviewHomeError(dir, jsonObject(value), {
            code: "REPAIR_REQUIRED",
            message: `${errorMessage(error)} This review was published with the removed MDX toolchain and its stored files are damaged, so it cannot be imported. Delete it from Home and recreate it with your agent through Whiteboard.`,
          }),
        };
      }

      value = parseJsonText(await readFile(reviewPath, "utf8"));
      parsed = safeParseStoredReviewRecord(value);
    }

    if (!parsed.success) {
      return {
        error: reviewHomeError(dir, jsonObject(value), {
          message: `Invalid review.json; run \`whiteboard migrate apply\`: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
          code: "MIGRATION_REQUIRED",
        }),
      };
    }

    return { dir, review: parsed.data };
  } catch (error) {
    const detail: ReviewHomeErrorDetail = {
      message: `Could not read review.json: ${error instanceof Error ? error.message : String(error)}`,
    };

    // SAFETY: the try block only throws fs ErrnoExceptions and JSON
    // SyntaxErrors; `code` is the errno name on the former and absent on the
    // latter.
    const code = (error as NodeJS.ErrnoException).code;

    if (code) detail.code = code;

    return { error: reviewHomeError(dir, undefined, detail) };
  }
}

function isLegacyStoredReviewRecord(value: JsonValue, dir: string): boolean {
  if (
    !isJsonObject(value) ||
    (value.schemaVersion !== 2 &&
      value.schemaVersion !== 3 &&
      value.schemaVersion !== 4)
  )
    return false;

  try {
    return parseAnyStoredReviewRecord(value).uuid === path.basename(dir);
  } catch {
    return false;
  }
}

async function migrateLegacyStoredReview(dir: string): Promise<void> {
  await withReviewMutationLock(dir, async () => {
    const current = parseJsonText(
      await readFile(path.join(dir, "review.json"), "utf8"),
    );

    if (!isLegacyStoredReviewRecord(current, dir)) return;
    const { migrateStoredReview } = await import("./stored-review-migration");
    const uuid = path.basename(dir);

    await migrateStoredReview({
      reviewDir: dir,
      log: (message) => console.warn(`Review ${uuid}: ${message}`),
    });
  });
}

/** `record` is the parsed review, or the raw review.json object when it failed to parse. */
interface ReviewHomeErrorDetail {
  message: string;
  code?: string;
}

function reviewHomeError(
  reviewDir: string,
  record: StoredReviewRecord | JsonObject | undefined,
  error: ReviewHomeErrorDetail,
): ReviewHomeError {
  const directoryUuid = path.basename(reviewDir);
  const storedUuid = jsonString(record?.uuid) ?? null;

  const reviewUuid = UUID_PATTERN.test(storedUuid ?? "")
    ? storedUuid
    : UUID_PATTERN.test(directoryUuid)
      ? directoryUuid
      : null;

  const result: ReviewHomeError = {
    reviewDir,
    reviewUuid,
    title: jsonString(record?.title) ?? "",
    worktreePath: jsonString(record?.worktreePath) || reviewDir,
    lastPublishedAt: jsonString(record?.lastPublishedAt) ?? null,
    message: error.message,
  };

  if (error.code) result.code = error.code;

  return result;
}

export function parseStoredReviewRecord(value: JsonValue): StoredReviewRecord {
  return StoredReviewRecordSchema.parse(stripLegacySoftwareMap(value));
}

/** Schema 2 predates the required software map, so a schema-2 presentation may
 * legitimately have a document and no map. Every later schema must keep the
 * map it presents. */
const ABSENT_SOFTWARE_MAP_SCHEMA_VERSION = 2;

export function allowsAbsentSoftwareMap(record: {
  schemaVersion: number;
}): boolean {
  return record.schemaVersion === ABSENT_SOFTWARE_MAP_SCHEMA_VERSION;
}

/**
 * Parses a stored review at any schema version this build understands, upgrading legacy
 * records in memory. Nothing on disk changes. Every result is validated against the current
 * strict schema, so an unknown version or an unexpected key still throws.
 *
 * Use this wherever a review.json may predate the current schema (recovery, repair,
 * migration, historical revisions). Use `parseStoredReviewRecord` only where the record must
 * already be current — the sealed records the server itself just wrote.
 */
export function parseAnyStoredReviewRecord(
  value: JsonValue,
): StoredReviewRecord {
  if (!isJsonObject(value)) return parseStoredReviewRecord(value);
  const record = stripLegacySoftwareMap(value);

  if (record.schemaVersion === REVIEW_SCHEMA_VERSION)
    return parseStoredReviewRecord(record);
  const legacyRecord = LegacyStoredReviewRecordSchema.parse(record);

  if (legacyRecord.schemaVersion === 4) {
    return StoredReviewRecordSchema.parse({
      ...legacyRecord,
      schemaVersion: REVIEW_SCHEMA_VERSION,
    });
  }

  if (legacyRecord.schemaVersion === 3) {
    const {
      agentSession,
      schemaVersion: _schemaVersion,
      ...current
    } = legacyRecord;

    return StoredReviewRecordSchema.parse({
      ...current,
      schemaVersion: REVIEW_SCHEMA_VERSION,
      sourceSession: current.sourceSession ?? agentSession,
    });
  }

  const {
    agentSession,
    presentedRevision,
    schemaVersion: _schemaVersion,
    ...current
  } = legacyRecord;

  return StoredReviewRecordSchema.parse({
    ...current,
    schemaVersion: REVIEW_SCHEMA_VERSION,
    sourceSession: current.sourceSession ?? agentSession,
    presentedDocumentRevision: presentedRevision ?? null,
    presentedSoftwareMapRevision: presentedRevision ?? null,
  });
}

export function safeParseStoredReviewRecord(value: JsonValue) {
  return StoredReviewRecordSchema.safeParse(stripLegacySoftwareMap(value));
}

function stripLegacySoftwareMap(value: JsonObject): JsonObject;
function stripLegacySoftwareMap(value: JsonValue): JsonValue;
function stripLegacySoftwareMap(value: JsonValue): JsonValue {
  if (!isJsonObject(value)) return value;
  const { softwareMap: _legacySoftwareMap, ...record } = value;

  return record;
}
