import { z } from "zod";

import {
  type FileLineRange,
  type SourcePins,
  sourcePinsSchema,
} from "./source.js";
import { unionIntervals } from "./viewed-coverage.js";

const endpointSchema = z.strictObject({
  side: z.enum(["base", "head"]),
  line: z.number().int().positive(),
});

export const ANCHOR_FORMS =
  '"head/path#L10-L24" or "base/path#L7" (one side, lines 10–24 or line 7); across sides, GitHub diff style "diff/path#L84-R90" (L = base line, R = head line)';

/** Inclusive endpoints in the uncollapsed alignment, independent of diff layout.
 * `pins` names the repository and commits the selection was read from; a
 * selection without them resolves against its document's pins. */
export const diffSelectionObjectSchema = z
  .strictObject(
    {
      file: z.string().trim().min(1),
      start: endpointSchema,
      end: endpointSchema,
      pins: sourcePinsSchema.optional(),
    },
    {
      // A missing anchor reads as one, not as a missing object.
      error: (issue) =>
        issue.code === "invalid_type"
          ? `Expected a source anchor: ${ANCHOR_FORMS}.`
          : undefined,
    },
  )
  .refine(
    (value) =>
      value.start.side !== value.end.side || value.start.line <= value.end.line,
    "Source range ends before it starts.",
  )
  .refine(
    (value) =>
      !value.pins ||
      value.pins.base !== undefined ||
      (value.start.side === "head" && value.end.side === "head"),
    "A base-side endpoint needs base pins.",
  );

const sameSideAnchor = /^(head|base)\/(.+)#L(\d+)(?:-L(\d+))?$/;

const crossSideAnchor = /^diff\/(.+)#([LR])(\d+)(?:-([LR])(\d+))?$/;

/** The string form of a selection, as markdown source links write it
 * (without their `review-source:` scheme). Undefined when it isn't one. */
export function parseAnchor(text: string): DiffSelection | undefined {
  const same = sameSideAnchor.exec(text);

  if (same) {
    const side = same[1] === "base" ? "base" : "head";

    return {
      file: same[2]!,
      start: { side, line: Number(same[3]) },
      end: { side, line: Number(same[4] ?? same[3]) },
    };
  }

  const cross = crossSideAnchor.exec(text);

  if (!cross) return undefined;
  const side = (letter: string) => (letter === "L" ? "base" : "head");

  return {
    file: cross[1]!,
    start: { side: side(cross[2]!), line: Number(cross[3]) },
    end: {
      side: side(cross[4] ?? cross[2]!),
      line: Number(cross[5] ?? cross[3]),
    },
  };
}

/** Marks a string that isn't an anchor, so the failure surfaces as a
 * refinement: a union around the block then reports this message instead of
 * a bare "Invalid input". */
const NOT_AN_ANCHOR = "\u0000not an anchor:";

/** Agents write the string; stored documents, reads and internal writers
 * keep the object, which is still accepted. */
export const diffSelectionSchema = z.preprocess(
  (value) => {
    const text = z.string().safeParse(value);

    // The object form passes through to the object schema.
    if (!text.success) return value;

    return (
      parseAnchor(text.data) ?? {
        file: `${NOT_AN_ANCHOR}${text.data}`,
        start: { side: "head", line: 1 },
        end: { side: "head", line: 1 },
      }
    );
  },
  diffSelectionObjectSchema.refine(
    (selection) => !selection.file.startsWith(NOT_AN_ANCHOR),
    `Use ${ANCHOR_FORMS} for a source anchor.`,
  ),
);

/** An anchor as agents are shown it: the string form only. */
export const anchorTextSchema = z
  .string()
  .describe("head/path#L10-L24, base/path#L7, or diff/path#L84-R90");

export type DiffSelection = z.output<typeof diffSelectionObjectSchema>;

export const lensSourceSchema = diffSelectionSchema;

export type LensSource = DiffSelection;

export type AlignmentRow = readonly [number | null, number | null];

/** Pins-less selections keep the key they always had. */
export function selectionKey(source: LensSource): string {
  return JSON.stringify([
    source.file,
    source.start.side,
    source.start.line,
    source.end.side,
    source.end.line,
    ...(source.pins ? [sourcePinsKey(source.pins)] : []),
  ]);
}

export function sourcePinsKey(pins: SourcePins): string {
  return `${pins.repositoryId}:${pins.base ?? ""}:${pins.head}`;
}

/** The comparison a source's pins name: head alone means head against
 * itself. Reference coverage is grouped under this key on both sides. */
export function comparisonKey(pins: SourcePins): string {
  return `${pins.repositoryId}:${pins.base ?? pins.head}:${pins.head}`;
}

/** Adapt internal source links (for example software-map evidence) to a selection. */
export function selectSource(source: FileLineRange): DiffSelection {
  const selection: DiffSelection = {
    file: source.file,
    start: { side: source.side, line: source.fromLine },
    end: { side: source.side, line: source.toLine },
  };

  if (source.pins) selection.pins = source.pins;

  return selection;
}

/** Navigation/quote anchors only; never use these as lens coverage. */
export function sourceAnchors(source: LensSource): FileLineRange[] {
  return (["head", "base"] as const).flatMap((side) => {
    const lines = [source.start, source.end].flatMap((endpoint) =>
      endpoint.side === side ? [endpoint.line] : [],
    );

    if (!lines.length) return [];

    const anchor: FileLineRange = {
      file: source.file,
      side,
      fromLine: Math.min(...lines),
      toLine: Math.max(...lines),
    };

    if (source.pins) anchor.pins = source.pins;

    return [anchor];
  });
}

export function sourceAnchor(source: LensSource): FileLineRange {
  return sourceAnchors(source)[0]!;
}

/** Resolve once against the renderer's rows. No matching or context expansion. */
export function resolveDiffSelection(
  source: LensSource,
  rows: readonly AlignmentRow[],
  file: { path: string; previousPath?: string },
): FileLineRange[] {
  const locate = (endpoint: DiffSelection["start"]): number =>
    rows.findIndex(
      (row) => row[endpoint.side === "base" ? 0 : 1] === endpoint.line - 1,
    );

  const start = locate(source.start);
  const end = locate(source.end);

  if (start < 0 || end < start)
    throw new Error(
      "Lens endpoints do not identify an ordered interval in this diff.",
    );
  const selected = rows.slice(start, end + 1);

  return (["base", "head"] as const).flatMap((side, index) =>
    unionIntervals(
      selected.flatMap((row) =>
        row[index] === null ? [] : [[row[index]!, row[index]! + 1]],
      ),
    ).map(([from, to]) => ({
      file: side === "base" ? (file.previousPath ?? file.path) : file.path,
      side,
      fromLine: from + 1,
      toLine: to,
    })),
  );
}
