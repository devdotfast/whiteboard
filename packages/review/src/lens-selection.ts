import { z } from "zod";

import { type FileLineRange, type SourcePins } from "./source.js";
import { unionIntervals } from "./viewed-coverage.js";

const ANCHOR_FORMS =
  '"head/path#L10-L24" or "base/path#L7" (one side, lines 10–24 or line 7); across sides, GitHub diff style "diff/path#L84-R90" (L = base line, R = head line)';

/** Inclusive endpoints in the uncollapsed alignment, independent of diff
 * layout. `pins` names the repository and commits the selection was read
 * from; a selection without them resolves against its document's pins. */
export type DiffSelection = {
  file: string;
  start: { side: "base" | "head"; line: number };
  end: { side: "base" | "head"; line: number };
  pins?: SourcePins;
};

/** A selection as written and stored: "head/path#L10-L24", "base/path#L7",
 * or "diff/path#L84-R90" across sides. Pins live on whatever holds it. */
export type Anchor = string;

const sameSideAnchor = /^(head|base)\/(.+)#L(\d+)(?:-L(\d+))?$/;

const crossSideAnchor = /^diff\/(.+)#([LR])(\d+)-([LR])(\d+)$/;

/** An anchor's selection, as markdown source links write it too (without
 * their `review-source:` scheme). Undefined when it isn't one. */
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

  // One side has its own spelling, so a diff anchor must cross.
  if (!cross || cross[2] === cross[4]) return undefined;
  const side = (letter: string) => (letter === "L" ? "base" : "head");

  return {
    file: cross[1]!,
    start: { side: side(cross[2]!), line: Number(cross[3]) },
    end: { side: side(cross[4]!), line: Number(cross[5]) },
  };
}

/** Why a parsed selection can't be quoted, or undefined when it can. */
export function selectionProblem(selection: DiffSelection): string | undefined {
  if (selection.start.line < 1 || selection.end.line < 1)
    return "Source lines count from 1.";

  if (
    selection.start.side === selection.end.side &&
    selection.start.line > selection.end.line
  )
    return "Source range ends before it starts.";

  if (
    selection.pins &&
    selection.pins.base === undefined &&
    (selection.start.side === "base" || selection.end.side === "base")
  )
    return "A base-side anchor needs base pins.";
}

export const anchorSchema = z
  .string({ error: `Expected a source anchor: ${ANCHOR_FORMS}.` })
  .superRefine((text, context) => {
    const selection = parseAnchor(text);

    const problem = selection
      ? selectionProblem(selection)
      : `Use ${ANCHOR_FORMS} for a source anchor.`;

    if (problem) context.addIssue({ code: "custom", message: problem });
  })
  .describe("head/path#L10-L24, base/path#L7, or diff/path#L84-R90");

/** A stored anchor's selection, read at the pins of whatever holds it. */
export function anchorSelection(
  anchor: Anchor,
  pins?: SourcePins,
): DiffSelection {
  const selection = parseAnchor(anchor);

  if (!selection) throw new Error(`Not a source anchor: ${anchor}`);

  return pins ? { ...selection, pins } : selection;
}

/** The anchor that writes a selection; its pins belong to its holder. */
export function formatAnchor(selection: DiffSelection): Anchor {
  const { file, start, end } = selection;

  if (start.side === end.side)
    return start.line === end.line
      ? `${start.side}/${file}#L${start.line}`
      : `${start.side}/${file}#L${start.line}-L${end.line}`;

  const letter = (side: "base" | "head") => (side === "base" ? "L" : "R");

  return `diff/${file}#${letter(start.side)}${start.line}-${letter(end.side)}${end.line}`;
}

/** A selection as its holder stores it: the anchor, and its pins when it
 * names its own. */
export function anchored(selection: DiffSelection): {
  source: Anchor;
  pins?: SourcePins;
} {
  return selection.pins
    ? { source: formatAnchor(selection), pins: selection.pins }
    : { source: formatAnchor(selection) };
}

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

/** The anchor for one side's line range; its pins belong to its holder. */
export function rangeAnchor(
  source: Pick<FileLineRange, "file" | "side" | "fromLine" | "toLine">,
): Anchor {
  return formatAnchor({
    file: source.file,
    start: { side: source.side, line: source.fromLine },
    end: { side: source.side, line: source.toLine },
  });
}

/** Adapt internal source links (for example software-map evidence) to a selection. */
export function selectSource(source: FileLineRange): DiffSelection {
  const selection: DiffSelection = {
    file: source.file,
    start: { side: source.side, line: source.fromLine },
    end: { side: source.side, line: source.toLine },
  };

  return source.pins ? { ...selection, pins: source.pins } : selection;
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
