/**
 * What a drag across a diff selects, positioned as GitLab positions a diff comment: by each line's
 * old and new numbers, so one selection can hold removed, added and unchanged lines.
 */
import type { DiffFile, TextDiff } from "../protocol/wire";
import type { ViewerRow } from "./rows";
import type { Snapshot } from "../protocol/store";
import { diffOrder, sourceLines, type DiffLine, type DiffOrder } from "./regions";
import { measureTextWidth } from "../terminal/text";

export type Side = "left" | "right";
/** Where a drag was pressed and where it is now: a row, and the column of a split row. */
export interface SourceSelection {
  anchor: string;
  anchorSide: Side;
  end: string;
  endSide: Side;
}
/** The first and last rows a selection touches, in row order; `[-1, -1]` for none. */
export function selectionBounds(
  rows: ViewerRow[],
  selection: SourceSelection | null,
): [number, number] {
  if (!selection) return [-1, -1];
  const a = rows.findIndex((r) => r.key === selection.anchor),
    b = rows.findIndex((r) => r.key === selection.end);
  return a < 0 || b < 0 ? [-1, -1] : [Math.min(a, b), Math.max(a, b)];
}
/** Which halves of a row a selection covers. A unified row is one cell, covered whole or not at all. */
export interface Cover {
  left: boolean;
  right: boolean;
}
/**
 * Which halves of each row the selection covers. Unified rows are taken whole. In split, a drag
 * kept to one column takes that column; one that crosses takes everything between its ends, read
 * left to right and down, as GitHub lets a comment start on the left and end on the right.
 */
export function selectionCover(rows: ViewerRow[], selection: SourceSelection | null): (index: number) => Cover | undefined {
  const [a, b] = selectionBounds(rows, selection);
  if (!selection || a < 0) return () => undefined;
  const anchor = rows.findIndex((r) => r.key === selection.anchor), end = rows.findIndex((r) => r.key === selection.end);
  const position = (index: number, side: Side) => index * 2 + (side === "right" ? 1 : 0);
  const ends = [position(anchor, selection.anchorSide), position(end, selection.endSide)];
  const [first, last] = [Math.min(...ends), Math.max(...ends)];
  const oneColumn = selection.anchorSide === selection.endSide ? selection.anchorSide : undefined;
  return (index) => {
    if (index < a || index > b) return undefined;
    if (rows[index]!.cell) return { left: true, right: true };
    if (oneColumn) return { left: oneColumn === "left", right: oneColumn === "right" };
    return { left: position(index, "left") >= first && position(index, "left") <= last,
      right: position(index, "right") >= first && position(index, "right") <= last };
  };
}

export type { DiffLine };
/** One file's part of a selection. */
export interface SelectedRange {
  fileIndex: number;
  oldPath?: string;
  newPath?: string;
  /** GitLab's start and end: the first and last selected lines, in diff order. */
  start: DiffLine;
  end: DiffLine;
  /**
   * A split-view drag kept to one column selects that version's code: its lines from `start`
   * to `end`, folded lines included. Otherwise the selection is the diff's rows themselves.
   */
  side?: "old" | "new";
  /** The selected lines, in diff order (see `diffOrder`); a folded stretch is a gap between them. */
  lines: DiffLine[];
}
/** Each diff's order, worked out once: the selection bar asks for it every frame. */
const orders = new WeakMap<TextDiff, DiffOrder>();
function orderOf(diff: TextDiff): DiffOrder {
  let order = orders.get(diff);
  if (!order) {
    order = diffOrder(diff);
    orders.set(diff, order);
  }
  return order;
}
const textDiff = (files: (DiffFile | undefined)[], fileIndex: number): TextDiff => {
  const diff = files[fileIndex]?.diff;
  if (diff?.type !== "text") throw new Error(`File ${fileIndex} has no text to select`);
  return diff;
};
/**
 * Each file's part of the selection: the lines its covered cells show, put in the diff's own
 * order. An unchanged line is one line on both sides, whichever half of it the drag covered.
 */
export function selectedRanges(
  files: (DiffFile | undefined)[],
  rows: ViewerRow[],
  selection: SourceSelection,
): SelectedRange[] {
  const [a, b] = selectionBounds(rows, selection);
  if (a < 0) return [];
  const cover = selectionCover(rows, selection);
  const oneColumn = selection.anchorSide === selection.endSide && !rows[a]!.cell
    ? (selection.anchorSide === "left" ? "old" : "new") : undefined;
  const touched = new Map<number, { old: Set<number>; new: Set<number> }>();
  for (let index = a; index <= b; index++) {
    const row = rows[index]!, covered = cover(index);
    if (!covered) continue;
    const old = row.cell ? row.cell.oldLineNumber : covered.left ? row.left?.lineNumber : undefined;
    const neu = row.cell ? row.cell.newLineNumber : covered.right ? row.right?.lineNumber : undefined;
    if (old === undefined && neu === undefined) continue;
    let numbers = touched.get(row.fileIndex);
    if (!numbers) touched.set(row.fileIndex, numbers = { old: new Set(), new: new Set() });
    if (old !== undefined) numbers.old.add(old);
    if (neu !== undefined) numbers.new.add(neu);
  }
  const ranges: SelectedRange[] = [];
  for (const [fileIndex, numbers] of touched) {
    let lines: DiffLine[];
    if (oneColumn) lines = [...numbers[oneColumn]].sort((x, y) => x - y).map((n) => (oneColumn === "old" ? { old: n } : { new: n }));
    else {
      const order = orderOf(textDiff(files, fileIndex));
      const at = (map: Map<number, number>, n: number) => {
        const index = map.get(n);
        if (index === undefined) throw new Error(`Line ${n} of file ${fileIndex} is missing from its diff's order`);
        return index;
      };
      const indices = new Set([...[...numbers.old].map((n) => at(order.oldAt, n)), ...[...numbers.new].map((n) => at(order.newAt, n))]);
      lines = [...indices].sort((x, y) => x - y).map((index) => order.lines[index]!);
    }
    if (!lines.length) continue;
    const file = files[fileIndex];
    ranges.push({ fileIndex, oldPath: file?.file.lhs?.path, newPath: file?.file.rhs?.path,
      start: lines[0]!, end: lines.at(-1)!, side: oneColumn, lines });
  }
  return ranges;
}

/** The lines a range spans on one side, first to last. */
function span(range: SelectedRange, side: "old" | "new"): [number, number] | undefined {
  const numbers = range.lines.flatMap((line) => line[side] ?? []);
  return numbers.length ? [numbers[0]!, numbers.at(-1)!] : undefined;
}
const removed = (line: DiffLine) => line.new === undefined;
const added = (line: DiffLine) => line.old === undefined;

/**
 * `src/a.rs:L13-R15`, as GitHub names a diff range: L for old line numbers, R for new, an
 * unchanged line counting as R. A range with no removed lines is all R, one with no added lines all L.
 */
export function rangeName(range: SelectedRange): string {
  const both = !range.side && range.lines.some(removed) && range.lines.some(added);
  const side = range.side ?? (both ? undefined : range.lines.some(removed) ? "old" : "new");
  const path = (side === "old" ? range.oldPath : range.newPath ?? range.oldPath)!;
  if (side) {
    const [first, last] = span(range, side)!;
    const letter = side === "old" ? "L" : "R";
    return `${path}:${letter}${first}${first === last ? "" : `-${last}`}`;
  }
  return `${path}:L${span(range, "old")![0]}-R${span(range, "new")![1]}`;
}
/** How many lines a range holds: a version's, first to last, or the diff's rows. */
function lineCount(range: SelectedRange): number {
  if (!range.side) return range.lines.length;
  const [first, last] = span(range, range.side)!;
  return last - first + 1;
}
/**
 * What the selection bar leads with: a message, then the selected range and how many lines it
 * holds, in `width` cells. A path too long for them gives way to its file's name.
 */
export function selectionLead(message: string, ranges: SelectedRange[], width: number): string {
  const count = ranges.reduce((sum, range) => sum + lineCount(range), 0);
  const lead = (what: string) => ` ${message ? `${message} · ` : ""}${what} · ${count} ${count === 1 ? "line" : "lines"} `;
  if (ranges.length !== 1) return lead(`${ranges.length} files`);
  const name = rangeName(ranges[0]!);
  const whole = lead(name);
  if (measureTextWidth(whole) <= width) return whole;
  const colon = name.lastIndexOf(":");
  return lead(`${name.slice(0, colon).split("/").at(-1)}${name.slice(colon)}`);
}

function sourcesOf(files: (DiffFile | undefined)[], range: SelectedRange) {
  const diff = files[range.fileIndex]?.diff;
  if (diff?.type !== "text") throw new Error(`File ${range.fileIndex} has no text to copy`);
  return { old: diff.lhs ? sourceLines(diff.lhs.text) : [], new: diff.rhs ? sourceLines(diff.rhs.text) : [],
    oldTerminated: diff.lhs?.text.endsWith("\n") ?? true, newTerminated: diff.rhs?.text.endsWith("\n") ?? true };
}
/** The selected lines as a unified diff, numbered from the diff's own order: a new hunk wherever lines between them are left out, as a fold leaves them. */
function patch(range: SelectedRange, order: DiffOrder, sources: ReturnType<typeof sourcesOf>): string {
  const oldPath = `a/${range.oldPath ?? range.newPath}`;
  const newPath = `b/${range.newPath ?? range.oldPath}`;
  const quote = (path: string) => /["\\\t\r\n]/.test(path) ? JSON.stringify(path) : path;
  const out = [`diff --git ${quote(oldPath)} ${quote(newPath)}`, `--- ${range.oldPath === undefined ? "/dev/null" : quote(oldPath)}`,
    `+++ ${range.newPath === undefined ? "/dev/null" : quote(newPath)}`];
  const indexOf = (line: DiffLine) => (line.old !== undefined ? order.oldAt.get(line.old) : order.newAt.get(line.new!))!;
  const hunks: number[][] = [];
  // A one-column selection includes folded lines within that version's selected span.
  const indices = range.side
    ? (() => {
      const [first, last] = span(range, range.side)!;
      const at = range.side === "old" ? order.oldAt : order.newAt;
      return Array.from({ length: last - first + 1 }, (_, i) => at.get(first + i)!);
    })()
    : range.lines.map(indexOf);
  for (const index of indices) {
    const hunk = hunks.at(-1);
    if (hunk && hunk.at(-1) === index - 1) hunk.push(index);
    else hunks.push([index]);
  }
  for (const hunk of hunks) {
    const lines = hunk.map((index) => order.lines[index]!);
    // As git writes it: a count of 1 left out, and a side with no lines at the line before them.
    const side = (key: "old" | "new") => {
      const numbers = lines.flatMap((line) => line[key] ?? []);
      const start = numbers[0] ?? (key === "old" ? order.oldBefore : order.newBefore)[hunk[0]!]!;
      return numbers.length === 1 ? `${start}` : `${start},${numbers.length}`;
    };
    out.push(`@@ -${side("old")} +${side("new")} @@`);
    for (const line of lines) {
      const [before, after] = [line.old === undefined ? undefined : sources.old[line.old - 1]!,
        line.new === undefined ? undefined : sources.new[line.new - 1]!];
      const emit = (prefix: string, text: string, side: "old" | "new") => {
        out.push(`${prefix}${text}`);
        if (line[side] === sources[side].length && !sources[`${side}Terminated`]) out.push("\\ No newline at end of file");
      };
      // A paired line can still differ in formatting or its final newline.
      const sameEnding = (line.old === sources.old.length && !sources.oldTerminated)
        === (line.new === sources.new.length && !sources.newTerminated);
      if (before !== undefined && before === after && sameEnding) emit(" ", after, "new");
      else {
        if (before !== undefined) emit("-", before, "old");
        if (after !== undefined) emit("+", after, "new");
      }
    }
  }
  return out.join("\n") + "\n";
}
/** Preserve resolved revision IDs in full; mutable snapshots have no commit SHA. */
function snapshotIdentity(snapshot: NonNullable<Snapshot["comparison"]>["lhs"]): string {
  switch (snapshot.type) {
    case "revision": return snapshot.rev;
    case "index": return "index (staged)";
    case "working_tree": return "working tree (uncommitted)";
    case "path": return `path ${JSON.stringify(snapshot.path)}`;
    case "empty_tree": return "empty tree";
  }
}
/** Model context identifies both snapshots, then gives a Git patch; range names belong to UI anchors. */
export function rangeReference(
  files: (DiffFile | undefined)[],
  comparison: NonNullable<Snapshot["comparison"]>,
  range: SelectedRange,
): string {
  const body = patch(range, orderOf(textDiff(files, range.fileIndex)), sourcesOf(files, range));
  const { lhs, rhs } = files[range.fileIndex]!.file;
  // These are blob IDs, distinct from the comparison's commit/tree IDs. The producer uses
  // a null ID for unstored working-tree content, as Git does for raw working-tree diffs.
  const oid = /^[0-9a-f]+$/i;
  const old = lhs?.oid ?? "0".repeat(rhs?.oid.length ?? 40);
  const neu = rhs?.oid ?? "0".repeat(lhs?.oid.length ?? 40);
  const mode = lhs?.mode === rhs?.mode ? ` ${lhs!.mode}` : "";
  const headers = oid.test(old) && oid.test(neu) ? `index ${old}..${neu}${mode}\n` : "";
  const firstLine = body.indexOf("\n") + 1;
  return `Base: ${snapshotIdentity(comparison.lhs)}\nHead: ${snapshotIdentity(comparison.rhs)}\n\n`
    + body.slice(0, firstLine) + headers + body.slice(firstLine);
}
/** The selection as references an agent can read, one per file it touches. */
export function agentReference(
  files: (DiffFile | undefined)[],
  comparison: NonNullable<Snapshot["comparison"]>,
  rows: ViewerRow[],
  selection: SourceSelection,
): string {
  return selectedRanges(files, rows, selection).map((range) => rangeReference(files, comparison, range)).join("\n");
}
/**
 * The selected lines as source, for pasting into code: the new version's, or the old one's when
 * the selection holds nothing of the new.
 */
export function copySelection(
  files: (DiffFile | undefined)[],
  rows: ViewerRow[],
  selection: SourceSelection,
): string {
  return selectedRanges(files, rows, selection).flatMap((range) => {
    const sources = sourcesOf(files, range);
    const side = range.lines.some((line) => line.new !== undefined) ? "new" : "old";
    return range.lines.flatMap((line) => line[side] === undefined ? [] : [sources[side][line[side]! - 1]!]);
  }).join("\n");
}
