import {
  type JsonObject,
  type JsonValue,
  isBooleanValue,
  isJsonObject,
  isNumberValue,
  isStringValue,
} from "@dev.fast/review-protocol";
import { z } from "zod";

import {
  ATTACHMENT_KEYS,
  migrateDiffSelections,
  retiredSelection,
} from "./diff-selection-migration.js";
import { formatAnchor } from "./lens-selection.js";
import { label } from "./review-api/blocks/definition.js";
import { type Lens, lensTargetsSchema } from "./review-api/diff-lenses.js";
import { respellLinks } from "./review-api/document.js";

/** Upgrade a saved or shared Review document to the current block schema at the
 * read/import boundary. New edits use the strict schema and never accept these
 * retired forms. One walk makes a fresh copy: retired attachments become
 * selections, anchors become strings, sections lose their status, and
 * Markdown links are spelled the current way. */
// This is the decoder boundary for stored documents in retired wire formats.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
export function migrateStoredDocument(input: unknown): JsonValue {
  return upgradeNode(input, { attachment: false, anchors: true });
}

/** Where a node sits: under a key that held a retired attachment, and
 * whether its anchors still need converting (not inside an anchor). */
interface NodePlace {
  attachment: boolean;
  anchors: boolean;
  blockPins?: JsonValue;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Decoder boundary: every value is checked to be JSON as it is copied.
function upgradeNode(value: unknown, place: NodePlace): JsonValue {
  if (isStringValue(value) || isBooleanValue(value) || value === null)
    return value;

  if (isNumberValue(value) && Number.isFinite(value)) return value;

  if (Array.isArray(value))
    return value.map((child) => upgradeNode(child, place));

  if (!isJsonObject(value)) throw new TypeError("A document must be JSON.");

  const selection = place.attachment ? retiredSelection(value) : undefined;

  if (selection)
    return upgradeNode(selection, { attachment: false, anchors: false });

  const inherited = place.anchors ? (value.pins ?? place.blockPins) : undefined;
  let pins: JsonValue | undefined;

  const convert = (anchor: JsonValue): JsonValue => {
    // Most anchors are strings already.
    if (isStringValue(anchor)) return anchor;

    const parsed = selectionObjectSchema.safeParse(anchor);

    if (!parsed.success) return anchor;

    const { pins: own, ...anchorAt } = parsed.data;

    if (own) pins = own;

    return formatAnchor(anchorAt);
  };

  const entries: [string, JsonValue][] = [];

  for (const [key, child] of Object.entries(value)) {
    if (key === "status" && value.type === "section") continue;

    if (key === "markdown" && isStringValue(child)) {
      entries.push([key, respellLinks(child)]);
      continue;
    }

    const attachment = ATTACHMENT_KEYS.includes(key);

    if (place.anchors && ANCHOR_KEYS.includes(key)) {
      const anchors = upgradeNode(child, { attachment, anchors: false });

      entries.push([
        key,
        Array.isArray(anchors) ? anchors.map(convert) : convert(anchors),
      ]);
    } else
      entries.push([
        key,
        upgradeNode(child, {
          attachment,
          anchors: place.anchors,
          blockPins: inherited,
        }),
      ]);
  }

  const upgraded: JsonObject = Object.fromEntries(entries);

  if (
    pins !== undefined &&
    value.kind !== "ranges" &&
    JSON.stringify(pins) !== JSON.stringify(place.blockPins)
  )
    upgraded.pins = pins;

  return upgraded;
}

/** A stored document as the store reads it: retired forms upgraded, and
 * lens blocks lifted out to the snapshot's own lenses. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Decoder boundary for stored documents in retired formats.
export function readStoredDocument(input: unknown): LiftedLenses {
  return liftFileLenses(migrateStoredDocument(input));
}

/** Lenses saved before ranges were anchor strings. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Decoder boundary for stored lenses in retired formats.
export function migrateStoredLenses(input: unknown): JsonValue {
  return anchorStrings(migrateDiffSelections(input));
}

const ANCHOR_KEYS = ["source", "sources", "callSite", "contextSources"];

const selectionObjectSchema = z.object({
  file: z.string(),
  start: z.object({ side: z.enum(["base", "head"]), line: z.number() }),
  end: z.object({ side: z.enum(["base", "head"]), line: z.number() }),
  pins: z.json().optional(),
});

/**
 * Anchors were once selection objects, each with its own pins. They are now
 * strings, and pins sit on whatever holds them (a code peek, step, frame,
 * attachment or operation) when they differ from the enclosing block's. No
 * stored element mixed pins across its anchors. Lens ranges read at the
 * review's pins and never carried others.
 */
export function anchorStrings(
  value: JsonValue,
  blockPins?: JsonValue,
): JsonValue {
  if (Array.isArray(value))
    return value.map((child) => anchorStrings(child, blockPins));

  if (!isJsonObject(value)) return value;

  const inherited = value.pins ?? blockPins;
  let pins: JsonValue | undefined;

  const convert = (anchor: JsonValue): JsonValue => {
    const selection = selectionObjectSchema.safeParse(anchor);

    if (!selection.success) return anchor;

    const { pins: own, ...anchorAt } = selection.data;

    if (own) pins = own;

    return formatAnchor(anchorAt);
  };

  const migrated = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      ANCHOR_KEYS.includes(key)
        ? Array.isArray(child)
          ? child.map(convert)
          : convert(child)
        : anchorStrings(child, inherited),
    ]),
  );

  if (
    pins !== undefined &&
    value.kind !== "ranges" &&
    JSON.stringify(pins) !== JSON.stringify(blockPins)
  )
    migrated.pins = pins;

  return migrated;
}

/** A saved `file_lens` block, from before lenses left the document. */
const legacyFileLensSchema = z.object({
  type: z.literal("file_lens"),
  id: label,
  title: label,
  targets: lensTargetsSchema.optional(),
  patterns: z.array(label).min(1).optional(),
});

export interface LiftedLenses {
  document: JsonValue;
  lenses: Lens[];
}

/** Versions saved before lenses moved out of the document hold them as
 * `file_lens` blocks, possibly inside sections. Lift them out of a migrated
 * document, in document order, keeping each id, title and scope (legacy
 * `patterns` become a files target). Viewed state is per file, so it needs
 * no rewrite. */
export function liftFileLenses(document: JsonValue): LiftedLenses {
  const lenses: Lens[] = [];

  const visit = (value: JsonValue): JsonValue => {
    if (Array.isArray(value))
      return value.flatMap((item) => {
        if (!isJsonObject(item) || item.type !== "file_lens")
          return [visit(item)];

        const legacy = legacyFileLensSchema.safeParse(item);

        // A malformed legacy lens is dropped rather than failing the read.
        if (legacy.success && (legacy.data.targets ?? legacy.data.patterns))
          lenses.push({
            id: legacy.data.id,
            title: legacy.data.title,
            targets: legacy.data.targets ?? [
              { kind: "files", patterns: legacy.data.patterns! },
            ],
          });

        return [];
      });

    if (!isJsonObject(value)) return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, visit(child)]),
    );
  };

  return { document: visit(document), lenses };
}
