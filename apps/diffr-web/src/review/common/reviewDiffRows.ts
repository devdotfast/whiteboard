/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// One file's diff, in the order the reader sees it: lines, and the bands diffr's folds leave in
// their place. Unified, a changed run shows its base lines then its head lines; split, each row
// pairs the lines diffr paired. The same rows, gaps and foldables the diff editor draws from,
// without it.
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

export interface DiffFold {
  readonly foldStateId: number;
  readonly collapsed: boolean;
}

/** A fold folded into its header line, as `opener ⋯ label closer`. */
export interface DiffPill {
  readonly foldStateId: number;
  readonly label: string;
  readonly closer: string;
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
  readonly fold?: DiffFold;
  readonly pill?: DiffPill;
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

/** One side of a split row: a line of that side. */
export interface SplitCell {
  readonly change: "added" | "removed" | "context";
  readonly tinted: boolean;
  /** Zero-based line on its side. */
  readonly line: number;
  readonly side: "lhs" | "rhs";
  readonly fold?: DiffFold;
  readonly pill?: DiffPill;
}

/** A row of the split view; a side without a line there is left empty. */
export interface SplitRow {
  readonly kind: "pair";
  readonly left?: SplitCell;
  readonly right?: SplitCell;
}

export type SplitItem = SplitRow | UnifiedBand;

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
 * What the session's fold state does to a file, for either layout: the lines each collapsed gap
 * hides, the band it leaves, and each side's chevrons and header-line pills.
 */
function foldLayout(
  diff: StructuralTextDiff,
  collapsed: (foldStateId: number) => boolean | undefined,
) {
  const base = sourceLines(diff.lhs?.text);
  const head = sourceLines(diff.rhs?.text);

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

  // A fold folded into its header line puts its pill on the header of each side it hides lines on.
  const pills = (side: "base" | "head") => {
    const byLine = new Map<number, DiffPill>();
    const foldables = side === "base" ? baseFoldables : headFoldables;

    for (const gap of gaps) {
      if (
        gap.band ||
        !(side === "base" ? gap.originalCount : gap.modifiedCount)
      )
        continue;
      const foldable = foldables.find(
        (candidate) =>
          candidate.foldStateId === gap.foldStateId && candidate.inline,
      );
      if (foldable?.inline)
        byLine.set(
          (side === "base" ? gap.originalStart : gap.modifiedStart) - 2,
          {
            foldStateId: gap.foldStateId,
            label: foldable.inline.label,
            closer: foldable.inline.closer,
          },
        );
    }

    return byLine;
  };

  const fold = (
    foldable: StructuralFoldable | undefined,
  ): DiffFold | undefined =>
    foldable && {
      foldStateId: foldable.foldStateId,
      collapsed: collapsed(foldable.foldStateId) ?? foldable.collapsedByDefault,
    };

  const band = (gap: StructuralGap): UnifiedBand => {
    const detail = bandDetail(gap.label);
    const count = Math.max(gap.originalCount, gap.modifiedCount);

    return {
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
    };
  };

  const highlights = structuralHighlights(diff);

  return {
    gaps,
    hiddenBase,
    hiddenHead,
    baseChevrons: chevrons(baseFoldables),
    headChevrons: chevrons(headFoldables),
    basePills: pills("base"),
    headPills: pills("head"),
    changedBase: new Set(highlights.originalLines),
    changedHead: new Set(highlights.modifiedLines),
    fold,
    band,
  };
}

/**
 * The file's unified rows. Paired lines diffr found unchanged show once; a run of changed rows
 * shows its base lines, then its head lines. A collapsed region hides its lines on both sides and
 * leaves one band, or folds into its header line. `collapsed` is the session's state for a fold.
 */
export function unifiedItems(
  diff: StructuralTextDiff,
  collapsed: (foldStateId: number) => boolean | undefined,
): UnifiedItem[] {
  const layout = foldLayout(diff, collapsed);
  const { changedBase, changedHead } = layout;

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

  const items: UnifiedItem[] = [];
  const banded = new Set<number>();

  for (const line of lines) {
    const gapIndex =
      (line.head !== undefined
        ? layout.hiddenHead.get(line.head)
        : undefined) ??
      (line.base !== undefined ? layout.hiddenBase.get(line.base) : undefined);

    if (gapIndex !== undefined) {
      const gap = layout.gaps[gapIndex]!;

      if (gap.band && !banded.has(gapIndex)) {
        banded.add(gapIndex);
        items.push(layout.band(gap));
      }

      continue;
    }

    const fold =
      line.side === "lhs"
        ? layout.fold(layout.baseChevrons.get(line.base!))
        : layout.fold(
            layout.headChevrons.get(line.head!) ??
              (line.base !== undefined
                ? layout.baseChevrons.get(line.base)
                : undefined),
          );
    const pill =
      line.head !== undefined
        ? layout.headPills.get(line.head)
        : layout.basePills.get(line.base!);
    items.push({ ...line, fold, pill });
  }

  return items;
}

/**
 * The file's split rows: each of diffr's row pairs, its base line on the left and its head line on
 * the right. A collapsed region hides its lines and leaves one band across both sides, or folds
 * into its header line on each side that has one.
 */
export function splitItems(
  diff: StructuralTextDiff,
  collapsed: (foldStateId: number) => boolean | undefined,
): SplitItem[] {
  const layout = foldLayout(diff, collapsed);
  const items: SplitItem[] = [];
  const banded = new Set<number>();

  for (const [left, right] of structuralRows(diff)) {
    const hiddenLeft = left === null ? undefined : layout.hiddenBase.get(left);
    const hiddenRight =
      right === null ? undefined : layout.hiddenHead.get(right);

    for (const gapIndex of [hiddenLeft, hiddenRight]) {
      if (gapIndex === undefined || banded.has(gapIndex)) continue;
      const gap = layout.gaps[gapIndex]!;

      if (!gap.band) continue;
      banded.add(gapIndex);
      items.push(layout.band(gap));
    }

    const showLeft = left !== null && hiddenLeft === undefined;
    const showRight = right !== null && hiddenRight === undefined;

    if (!showLeft && !showRight) continue;
    const changed =
      left === null ||
      right === null ||
      layout.changedBase.has(left + 1) ||
      layout.changedHead.has(right + 1);

    items.push({
      kind: "pair",
      left: showLeft
        ? {
            change: changed ? "removed" : "context",
            tinted:
              changed && (layout.changedBase.has(left + 1) || right === null),
            line: left,
            side: "lhs",
            fold: layout.fold(layout.baseChevrons.get(left)),
            pill: layout.basePills.get(left),
          }
        : undefined,
      right: showRight
        ? {
            change: changed ? "added" : "context",
            tinted:
              changed && (layout.changedHead.has(right + 1) || left === null),
            line: right,
            side: "rhs",
            fold: layout.fold(layout.headChevrons.get(right)),
            pill: layout.headPills.get(right),
          }
        : undefined,
    });
  }

  return items;
}
