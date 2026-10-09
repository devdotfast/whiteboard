/** Flatten diffr's per-side region trees; collapsed state belongs to the viewer. */
import type { FoldRegion, Region, Source, Span, TextDiff } from "./wire";
import { measureTextWidth } from "../ui/lib/text";
export type Side = 0 | 1;
/** A leaf tiles its side; the same alignmentId on the other side is the leaf its rows line up with. */
export interface Leaf {
  /** The region's own name, unique across both sides. */
  id: number;
  /** Pairs this leaf with its counterpart across sides; the row zip keys on it. */
  alignmentId: number;
  /** Regions sharing it toggle together; collapse state keys on it. */
  foldStateId: number;
  side: Side;
  startLine: number;
  /** Exclusive. */
  endLine: number;
  changed: Map<number, Span[]>;
  tags: string[];
  collapsed: boolean;
  label: string;
  /** Terminal column of the enclosing fold's content, where a collapsed row starts. */
  parentColumn: number;
}
export interface Fold {
  /** The region's own name, unique across both sides. */
  id: number;
  foldStateId: number;
  side: Side;
  /** First line the fold covers: collapsing it hides this line too. The header a body
   * opens on is the last line of the leaf before the fold, not part of it. */
  startLine: number;
  /** Last line the fold covers, inclusive. */
  lastHidden: number;
  label: string;
  tags: string[];
  collapsed: boolean;
  /** Ids of folds nested inside, for recursive fold commands. */
  nested: number[];
  syntax?: FoldRegion["syntax"];
  /** Terminal column of the enclosing fold's content, where a collapsed row and guide start. */
  parentColumn: number;
}
/** The change tint of a fold: a one-sided region takes its side's change colour, a paired one stays neutral. */
export type FoldTint = "inserted" | "removed" | "modified" | "neutral";
export interface RowFold {
  /** The fold-state id: what toggling this header toggles. */
  id: number;
  label: string;
  collapsed: boolean;
  tint: FoldTint;
}
/** One-sided means the region is not among its side's `paired` ids (see `pairedIds`). */
export function foldTint(id: number, side: Side, paired: ReadonlySet<number>): FoldTint {
  if (paired.has(id)) return "neutral";
  return side ? "inserted" : "removed";
}
/**
 * For each side, the `id`s of its paired regions. A leaf is paired when the other side has a leaf
 * with its `alignment_id`, whose rows line up with it. Folds have no `alignment_id`; a fold is
 * paired when a region on the other side shares its `fold_state_id`.
 */
export function pairedIds(diff: TextDiff): readonly [Set<number>, Set<number>] {
  const { leaves, folds } = flatten(diff);
  const alignments = leaves.map((side) => new Set(side.map((leaf) => leaf.alignmentId)));
  const states = ([0, 1] as const).map((side) =>
    new Set([...leaves[side], ...folds[side]].map((region) => region.foldStateId)));
  return ([0, 1] as const).map((side) => {
    const other = side ? 0 : 1;
    return new Set([
      ...leaves[side].filter((leaf) => alignments[other]!.has(leaf.alignmentId)).map((leaf) => leaf.id),
      ...folds[side].filter((fold) => states[other]!.has(fold.foldStateId)).map((fold) => fold.id),
    ]);
  }) as unknown as readonly [Set<number>, Set<number>];
}
export const sourceLines = (text: string) =>
  text === "" ? [] : text.replace(/\n$/, "").split("\n");
const encoder = new TextEncoder();
/** Wire columns are UTF-8 bytes; terminal columns include tab stops and wide characters. */
export function byteColumn(text: string, byte: number): number {
  const prefix = new TextDecoder().decode(encoder.encode(text).slice(0, byte));
  let column = 0;
  for (const part of prefix.split(/(\t)/)) column += part === "\t" ? 4 - column % 4 : measureTextWidth(part);
  return column;
}
/** Lines a leaf covers, half-open: an end at column zero does not touch its end line. */
export function leafLines(region: Region): [number, number] {
  return [region.start.line, region.end.column === 0 ? region.end.line : region.end.line + 1];
}
export function flattenSide(source: Source, side: Side): { leaves: Leaf[]; folds: Fold[] } {
  const lines = sourceLines(source.text);
  const leaves: Leaf[] = [];
  const folds: Fold[] = [];
  const visit = (region: Region, ancestors: Fold[], parentColumn: number) => {
    if (region.kind === "leaf") {
      const [startLine, endLine] = leafLines(region);
      const changed = new Map<number, Span[]>();
      for (const span of region.changed) changed.set(span.line, [...(changed.get(span.line) ?? []), span]);
      leaves.push({ id: region.id, alignmentId: region.alignment_id, foldStateId: region.fold_state_id, side, startLine, endLine,
        changed, tags: region.tags,
        collapsed: region.visibility.collapsed, label: region.visibility.label, parentColumn });
      return;
    }
    const { start, end } = region;
    // An end at column 0 does not touch its line, so it may sit one past the last line of the
    // file. Otherwise the end line is covered when the range reaches the end of its text.
    const hideEnd = end.column > 0 && encoder.encode(lines[end.line]!.trimEnd()).length <= end.column;
    const fold: Fold = { id: region.id, foldStateId: region.fold_state_id, side,
      startLine: start.line,
      lastHidden: end.line - (hideEnd ? 0 : 1), label: region.visibility.label, tags: region.tags,
      collapsed: region.visibility.collapsed, nested: [], syntax: region.syntax, parentColumn };
    for (const ancestor of ancestors) ancestor.nested.push(fold.foldStateId);
    folds.push(fold);
    const indent = lines[region.indent.line];
    if (indent === undefined) throw new Error(`Fold ${region.id} indents past the end of its file`);
    for (const child of region.children) visit(child, [...ancestors, fold], byteColumn(indent, region.indent.column));
  };
  for (const region of source.root.children) visit(region, [], 0);
  return { leaves, folds };
}
export function flatten(diff: TextDiff) {
  const lhs = diff.lhs ? flattenSide(diff.lhs, 0) : { leaves: [], folds: [] };
  const rhs = diff.rhs ? flattenSide(diff.rhs, 1) : { leaves: [], folds: [] };
  return { leaves: [lhs.leaves, rhs.leaves] as const, folds: [lhs.folds, rhs.folds] as const };
}
/** Fold-state ids diffr asks to start collapsed: context gaps and folded bodies, on either side. */
export function defaultCollapsed(diff: TextDiff): Set<number> {
  const ids = new Set<number>();
  const { leaves, folds } = flatten(diff);
  for (const item of [...leaves.flat(), ...folds.flat()]) if (item.collapsed) ids.add(item.foldStateId);
  return ids;
}
/** Every collapsible id on either side, folds and foldable leaves alike, for fold-all commands. */
export function foldIds(diff: TextDiff): number[] {
  const { folds, leaves } = flatten(diff);
  return [...new Set([...folds.flat().map((fold) => fold.foldStateId), ...leaves.flat().filter(foldableLeaf).map((l) => l.foldStateId)])];
}
/** Ids nested inside a collapsible region, for recursive fold commands. Every region sharing the
 * fold-state id counts, so a bundle such as a docstring and its function unfolds as one. */
export function nestedIds(diff: TextDiff, id: number): number[] {
  const { folds, leaves } = flatten(diff);
  const members = folds.flat().filter((f) => f.foldStateId === id);
  if (members.length) return [...new Set(members.flatMap((f) => f.nested))].filter((n) => n !== id);
  if (!leaves.flat().some((leaf) => leaf.foldStateId === id)) throw new Error(`Unknown region ${id}`);
  return [];
}
/**
 * Context gaps: the stretches of unchanged lines diffr collapsed far from any change, for `c`.
 * The wire has no gap kind, so a gap is derived from what defines one: a region that starts
 * collapsed, carries no tags (context gaps are cut from leaves or wrapped in a new untagged
 * fold; syntax folds that other plugins collapse are tagged), is paired with the other side
 * (see `pairedIds`), and holds no change on either side: every leaf under it is paired and has no
 * `changed` span. The fold the context plugin wraps around a run of unchanged siblings meets the
 * same definition, and revealing it shows only unchanged lines.
 */
export function gapIds(diff: TextDiff): number[] {
  const sides = [diff.lhs?.root.children ?? [], diff.rhs?.root.children ?? []];
  const walk = (regions: Region[], visit: (region: Region) => void) => {
    for (const region of regions) {
      visit(region);
      walk(region.children, visit);
    }
  };
  const paired = pairedIds(diff);
  // Leaf alignments with a change on either side: a paired leaf is changed when its counterpart is.
  const changed = new Set<number>();
  for (const regions of sides)
    walk(regions, (region) => { if (region.kind === "leaf" && region.changed.length) changed.add(region.alignment_id); });
  const gaps = new Set<number>();
  sides.forEach((regions, side) => {
    const unchanged = (region: Region): boolean =>
      region.kind === "leaf"
        ? paired[side]!.has(region.id) && !changed.has(region.alignment_id)
        : region.children.every(unchanged);
    walk(regions, (region) => {
      if (region.visibility.collapsed && region.tags.length === 0 && paired[side]!.has(region.id) && unchanged(region))
        gaps.add(region.fold_state_id);
    });
  });
  return [...gaps];
}
/** Source lines hidden on one side: a collapsed fold hides every line it covers. */
export function hiddenLines(folds: Fold[], collapsed: ReadonlySet<number>): Set<number> {
  const hidden = new Set<number>();
  for (const fold of folds) {
    if (!collapsed.has(fold.foldStateId)) continue;
    for (let line = fold.startLine; line <= fold.lastHidden; line++) hidden.add(line);
  }
  return hidden;
}
/**
 * The collapsed fold each side shows a row for, keyed by the line it starts on: the outermost
 * collapsed fold there that no collapsed fold above it already hides. A collapsed fold is a row
 * of its own, between the rows of the leaves around it, so nothing it covers stays on screen.
 */
export function collapsedFolds(folds: Fold[], collapsed: ReadonlySet<number>): Map<number, Fold> {
  const rows = new Map<number, Fold>();
  // Outermost first: a fold starting inside one already taken is nested in it, and the
  // reader never sees it. Folds are a strict tree, so containment is all there is.
  const collapsedFirst = [...folds]
    .filter((fold) => collapsed.has(fold.foldStateId))
    .sort((a, b) => a.startLine - b.startLine || b.lastHidden - a.lastHidden);
  let covered = -1;
  for (const fold of collapsedFirst) {
    if (fold.startLine <= covered) continue;
    rows.set(fold.startLine, fold);
    covered = fold.lastHidden;
  }
  return rows;
}
/** A leaf collapses like a fold when diffr starts it collapsed or labelled it: a context gap
 * (`"12 unchanged lines"`), the middle of a removed stretch, or a docstring bundled with its
 * function, which arrives collapsed with an empty label. */
export const foldableLeaf = (leaf: Leaf) => leaf.collapsed || leaf.label !== "";
/**
 * The chevron each source line carries, one map per side. An open fold puts one on the first
 * syntax opener (or its first covered line without syntax). Collapsed syntax bodies join
 * opener and closer; other collapsed folds have a standalone band. Folds can start on one line —
 * a statement and the body it opens, or the fold the context plugin wraps around its first
 * member. A scope opened on the line wins, so the chevron folds the same scope its rail and
 * brackets show; otherwise the outermost wins.
 */
export function foldHeaders(
  folds: Fold[],
  leaves: Leaf[],
  collapsed: ReadonlySet<number>,
  paired: ReadonlySet<number>,
): Map<number, RowFold> {
  const headers = new Map<number, RowFold>();
  for (const leaf of leaves)
    if (foldableLeaf(leaf))
      headers.set(leaf.startLine, { id: leaf.foldStateId, label: leaf.label, collapsed: collapsed.has(leaf.foldStateId),
        tint: foldTint(leaf.id, leaf.side, paired) });
  const byLine = new Map<number, Fold[]>();
  for (const fold of folds) {
    if (collapsed.has(fold.foldStateId)) continue;
    const header = fold.syntax?.start.line ?? fold.startLine;
    byLine.set(header, [...(byLine.get(header) ?? []), fold]);
  }
  for (const [line, sharing] of byLine) {
    const scopes = sharing.filter((fold) => fold.syntax?.start.line === line);
    const fold = [...(scopes.length ? scopes : sharing)].sort((a, b) => b.lastHidden - a.lastHidden)[0];
    headers.set(line, { id: fold.foldStateId, label: fold.label, collapsed: false,
      tint: foldTint(fold.id, fold.side, paired) });
  }
  return headers;
}
