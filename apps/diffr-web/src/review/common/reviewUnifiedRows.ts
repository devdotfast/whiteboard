/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// One file as a unified diff, in the order the reader sees it: lines, and the bands diffr's folds
// leave in their place. The same rows, gaps and foldables the diff editor draws from, without it.
import {
  bandDetail,
  regionLines,
  type StructuralFoldable,
  type StructuralGap,
  type StructuralRegion,
  structuralContextGaps,
  structuralFoldables,
  structuralHighlights,
  structuralRows,
  type StructuralTextDiff,
} from "./reviewStructuralDiff.js";

export interface UnifiedFold {
  readonly foldStateId: number;
  readonly collapsed: boolean;
}

export interface UnifiedLine {
  readonly kind: "line";
  readonly change: "added" | "removed" | "context";
  /** Within a change, whether diffr counts the line as changed; the rest only moved with it. */
  readonly tinted: boolean;
  /** Zero-based line on each side it exists on. */
  readonly base?: number;
  readonly head?: number;
  /** The side its text and syntax come from: the base for a removed line, else the head. */
  readonly side: "lhs" | "rhs";
  /** The fold this line heads, if it has the chevron. */
  readonly fold?: UnifiedFold;
  /** A fold folded into this line, as `opener ⋯ label closer`. */
  readonly pill?: {
    readonly foldStateId: number;
    readonly label: string;
    readonly closer: string;
  };
}

export interface UnifiedBand {
  readonly kind: "band";
  readonly foldStateId: number;
  readonly change: StructuralGap["change"];
  /** Lines the band hides, the larger side's count. */
  readonly hidden: number;
  /** diffr's one-line label, or a count. */
  readonly title: string;
  /** A summary's pseudocode, one entry per line; empty without one. */
  readonly detail: readonly string[];
  /** Columns of indentation of the first line it hides. */
  readonly indent: number;
}

export type UnifiedItem = UnifiedLine | UnifiedBand;

/** The side's text, split as diffr counts lines. */
export function sourceLines(text: string | undefined): string[] {
  return text === undefined ? [] : text.replace(/\r\n/g, "\n").split("\n");
}

function indentOf(text: string | undefined): number {
  let columns = 0;

  for (const character of text ?? "") {
    if (character === " ") columns++;
    else if (character === "\t") columns += 4;
    else break;
  }

  return columns;
}

/**
 * The file's rows. Paired lines diffr found unchanged show once; a run of changed rows shows its
 * base lines, then its head lines. A collapsed region hides its lines on both sides and leaves one
 * band, or folds into its header line. `collapsed` is the session's state for a fold.
 */
export function unifiedItems(
  diff: StructuralTextDiff,
  collapsed: (foldStateId: number) => boolean | undefined,
): UnifiedItem[] {
  const base = sourceLines(diff.lhs?.text);
  const head = sourceLines(diff.rhs?.text);
  const highlights = structuralHighlights(diff);
  const changedBase = new Set(highlights.originalLines);
  const changedHead = new Set(highlights.modifiedLines);

  const lines: Omit<UnifiedLine, "fold" | "pill">[] = [];
  // A changed run's lines on each side, and whether each was paired with a line on the other.
  let removed: [number, boolean][] = [];
  let added: [number, boolean][] = [];
  const flush = () => {
    for (const [line, paired] of removed)
      lines.push({
        kind: "line",
        change: "removed",
        tinted: changedBase.has(line + 1) || !paired,
        base: line,
        side: "lhs",
      });
    for (const [line, paired] of added)
      lines.push({
        kind: "line",
        change: "added",
        tinted: changedHead.has(line + 1) || !paired,
        head: line,
        side: "rhs",
      });
    removed = [];
    added = [];
  };

  for (const [left, right] of structuralRows(diff)) {
    const changed =
      left === null ||
      right === null ||
      changedBase.has(left + 1) ||
      changedHead.has(right + 1);

    if (changed) {
      if (left !== null) removed.push([left, right !== null]);
      if (right !== null) added.push([right, left !== null]);
      continue;
    }

    flush();
    lines.push({
      kind: "line",
      change: "context",
      tinted: false,
      base: left,
      head: right,
      side: "rhs",
    });
  }

  flush();

  // Each hidden line belongs to the first collapsed gap over it, so overlapping gaps show once.
  const gaps = structuralContextGaps(
    diff,
    (id) => collapsed(id) === true,
    collapsed,
  ).filter((gap) => gap.collapsed);
  const hiddenBase = new Map<number, number>();
  const hiddenHead = new Map<number, number>();
  gaps.forEach((gap, index) => {
    for (let line = 0; line < gap.originalCount; line++)
      if (!hiddenBase.has(gap.originalStart - 1 + line))
        hiddenBase.set(gap.originalStart - 1 + line, index);
    for (let line = 0; line < gap.modifiedCount; line++)
      if (!hiddenHead.has(gap.modifiedStart - 1 + line))
        hiddenHead.set(gap.modifiedStart - 1 + line, index);
  });

  // Folding one line saves nothing, and on a phone every chevron makes its row a tap target.
  const spans = new Map<number, number>();
  const measure = (region: StructuralRegion) => {
    const { start, end } = regionLines(region);
    const id = region.fold_state_id;
    spans.set(id, Math.max(spans.get(id) ?? 0, end - start));
    if (region.kind === "fold") region.children.forEach(measure);
  };
  for (const side of [diff.lhs, diff.rhs]) if (side) measure(side.root);
  const chevrons = (foldables: StructuralFoldable[]) =>
    new Map(
      foldables
        .filter(
          (foldable) =>
            foldable.chevron &&
            ((spans.get(foldable.foldStateId) ?? 0) > 1 ||
              collapsed(foldable.foldStateId) === true),
        )
        .map((foldable) => [foldable.line, foldable]),
    );
  const baseFoldables = structuralFoldables(diff.lhs);
  const headFoldables = structuralFoldables(diff.rhs);
  const baseChevrons = chevrons(baseFoldables);
  const headChevrons = chevrons(headFoldables);

  // A fold folded into its header line puts its pill on the head side's header.
  const pills = new Map<number, NonNullable<UnifiedLine["pill"]>>();
  for (const gap of gaps) {
    if (gap.band || gap.owner === "base") continue;
    const foldable = headFoldables.find(
      (candidate) =>
        candidate.foldStateId === gap.foldStateId && candidate.inline,
    );
    if (foldable?.inline)
      pills.set(gap.modifiedStart - 2, {
        foldStateId: gap.foldStateId,
        label: foldable.inline.label,
        closer: foldable.inline.closer,
      });
  }

  const foldOf = (foldable: StructuralFoldable | undefined) =>
    foldable && {
      foldStateId: foldable.foldStateId,
      collapsed: collapsed(foldable.foldStateId) ?? foldable.collapsedByDefault,
    };

  const items: UnifiedItem[] = [];
  const banded = new Set<number>();

  for (const line of lines) {
    const gapIndex =
      (line.head !== undefined ? hiddenHead.get(line.head) : undefined) ??
      (line.base !== undefined ? hiddenBase.get(line.base) : undefined);

    if (gapIndex !== undefined) {
      const gap = gaps[gapIndex]!;

      if (gap.band && !banded.has(gapIndex)) {
        banded.add(gapIndex);
        const detail = bandDetail(gap.label);
        const count = Math.max(gap.originalCount, gap.modifiedCount);
        items.push({
          kind: "band",
          foldStateId: gap.foldStateId,
          change: gap.change,
          hidden: count,
          title: detail
            ? `${count} hidden line${count === 1 ? "" : "s"}`
            : gap.label.split("\n")[0]!,
          detail: detail ? detail.split("\n") : [],
          indent: indentOf(
            gap.modifiedCount
              ? head[gap.modifiedStart - 1]
              : base[gap.originalStart - 1],
          ),
        });
      }

      continue;
    }

    const fold =
      line.side === "lhs"
        ? foldOf(baseChevrons.get(line.base!))
        : foldOf(
            headChevrons.get(line.head!) ??
              (line.base !== undefined
                ? baseChevrons.get(line.base)
                : undefined),
          );
    const pill = line.head !== undefined ? pills.get(line.head) : undefined;
    items.push({ ...line, fold, pill });
  }

  return items;
}
