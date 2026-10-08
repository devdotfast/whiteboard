/**
 * What a drag across a diff selects, positioned as GitLab positions a diff comment: by each line's
 * old and new numbers, so one selection can hold removed, added and unchanged lines.
 */
import type { DiffFile } from "../protocol/wire";
import type { ViewerRow } from "./rows";
import type { Snapshot } from "../protocol/store";
import { snapshotLabel } from "./counts";
import { sourceLines } from "./regions";
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

/** One line of a file's diff, as GitLab positions it: removed lines have only `old`, added only `new`, unchanged both. */
export interface DiffLine {
  old?: number;
  new?: number;
}
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
  /** The lines the selection shows, in diff order; a folded stretch is a gap in their numbers. */
  lines: DiffLine[];
  /** For each line, the last old and new numbers before it in the file, for a hunk that has none of its own. */
  before: { old: number; new: number }[];
}
/** Each file's part of the selection. */
export function selectedRanges(
  files: (DiffFile | undefined)[],
  rows: ViewerRow[],
  selection: SourceSelection,
): SelectedRange[] {
  const [a, b] = selectionBounds(rows, selection);
  if (a < 0) return [];
  const cover = selectionCover(rows, selection);
  const oneColumn = selection.anchorSide === selection.endSide && !rows[a]!.cell ? selection.anchorSide : undefined;
  const ranges: SelectedRange[] = [];
  let range: SelectedRange | undefined;
  // Where the file stands before each line: rows above the selection count too.
  let at = { old: 0, new: 0 };
  let pendingOld: DiffLine[] = [], pendingNew: DiffLine[] = [];
  const push = (line: DiffLine) => {
    range!.lines.push(line);
    range!.before.push({ ...at });
  };
  // In split, a run of changed rows pairs removed lines with added ones; a patch lists the removed first.
  const flush = () => {
    for (const line of [...pendingOld, ...pendingNew]) {
      push(line);
      at = { old: line.old ?? at.old, new: line.new ?? at.new };
    }
    pendingOld = [];
    pendingNew = [];
  };
  let start = a;
  while (start > 0 && rows[start - 1]!.fileIndex === rows[a]!.fileIndex) start--;
  let file = rows[start]!.fileIndex;
  for (let index = start; index <= b; index++) {
    const row = rows[index]!;
    if (index === a || row.fileIndex !== file) {
      if (range) flush();
      if (row.fileIndex !== file) at = { old: 0, new: 0 };
      file = row.fileIndex;
      if (index >= a) {
        const file = files[row.fileIndex];
        range = { fileIndex: row.fileIndex, oldPath: file?.file.lhs?.path, newPath: file?.file.rhs?.path,
          start: {}, end: {}, side: oneColumn && (oneColumn === "left" ? "old" : "new"), lines: [], before: [] };
        ranges.push(range);
      }
    }
    const old = row.cell ? row.cell.oldLineNumber : row.left?.foldLabel ? undefined : row.left?.lineNumber;
    const neu = row.cell ? row.cell.newLineNumber : row.right?.foldLabel ? undefined : row.right?.lineNumber;
    const covered = index >= a ? cover(index) : undefined;
    if (!covered || !range || range.fileIndex !== row.fileIndex) {
      at = { old: old ?? at.old, new: neu ?? at.new };
      continue;
    }
    // An unchanged split row is one line, old and new: either half takes it whole.
    const unchanged = !row.cell && old !== undefined && neu !== undefined && row.left!.kind === "context" && row.right!.kind === "context";
    const [l, r] = unchanged && !range.side ? [old, neu] : [covered.left ? old : undefined, covered.right ? neu : undefined];
    if (range.side) {
      const line = range.side === "old" ? l : r;
      if (line !== undefined) push(range.side === "old" ? { old: line } : { new: line });
      continue;
    }
    if (row.cell || unchanged) {
      // A unified row, already in diff order, or an unchanged split row.
      flush();
      if (l === undefined && r === undefined) continue;
      push({ ...(l !== undefined && { old: l }), ...(r !== undefined && { new: r }) });
      at = { old: l ?? at.old, new: r ?? at.new };
      continue;
    }
    if (l !== undefined) pendingOld.push({ old: l });
    if (r !== undefined) pendingNew.push({ new: r });
    if (l === undefined && r === undefined) flush();
  }
  flush();
  for (const each of ranges) {
    if (!each.lines.length) continue;
    each.start = each.lines[0]!;
    each.end = each.lines.at(-1)!;
  }
  return ranges.filter((each) => each.lines.length);
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

type Version = NonNullable<Snapshot["comparison"]>["lhs"];
/** A version as a person names it to an agent, which can then find it. */
function versionName(version: Version): string {
  switch (version.type) {
    case "working_tree":
      return "the working tree";
    case "index":
      return "the git index (staged)";
    case "revision":
    case "path":
      return snapshotLabel(version);
    case "empty_tree":
      return "the empty tree";
  }
}
/** A fence longer than any run of backticks in `text`, so the text can't close it. */
function fenceFor(text: string): string {
  let fence = "```";
  for (const run of text.matchAll(/`+/g)) if (run[0].length >= fence.length) fence = "`".repeat(run[0].length + 1);
  return fence;
}
function sourcesOf(files: (DiffFile | undefined)[], range: SelectedRange) {
  const diff = files[range.fileIndex]?.diff;
  if (diff?.type !== "text") throw new Error(`File ${range.fileIndex} has no text to copy`);
  return { old: diff.lhs ? sourceLines(diff.lhs.text) : [], new: diff.rhs ? sourceLines(diff.rhs.text) : [] };
}
/** `@@ -13,2 +13,3 @@`, as git writes it: a count of 1 left out, a side with no lines at the line before them. */
function hunkHeader(lines: DiffLine[], next: { old: number; new: number }) {
  const side = (key: "old" | "new") => {
    const numbers = lines.flatMap((line) => line[key] ?? []);
    const start = numbers[0] ?? next[key] - 1;
    return numbers.length === 1 ? `${start}` : `${start},${numbers.length}`;
  };
  return `@@ -${side("old")} +${side("new")} @@`;
}
/** The selected rows as a unified diff: a new hunk wherever a fold left a gap in the numbers. */
function patch(range: SelectedRange, sources: { old: string[]; new: string[] }): string {
  const out = [`--- ${range.oldPath === undefined ? "/dev/null" : `a/${range.oldPath}`}`,
    `+++ ${range.newPath === undefined ? "/dev/null" : `b/${range.newPath}`}`];
  const hunks: { lines: DiffLine[]; next: { old: number; new: number } }[] = [];
  // The line numbers the open hunk's next line has on each side, whether it has that side or not.
  let next = { old: 0, new: 0 };
  range.lines.forEach((line, i) => {
    const continues = hunks.length && (line.old === undefined || line.old === next.old) && (line.new === undefined || line.new === next.new);
    if (!continues) {
      // Where a side the line lacks stands, taking lines folded away since `before` as unchanged, as a context gap is.
      const before = range.before[i]!;
      next = {
        old: line.old ?? before.old + (line.new! - before.new),
        new: line.new ?? before.new + (line.old! - before.old),
      };
      hunks.push({ lines: [], next: { ...next } });
    }
    hunks.at(-1)!.lines.push(line);
    if (line.old !== undefined) next.old = line.old + 1;
    if (line.new !== undefined) next.new = line.new + 1;
  });
  for (const hunk of hunks) {
    out.push(hunkHeader(hunk.lines, hunk.next));
    for (const line of hunk.lines) {
      const [before, after] = [line.old === undefined ? undefined : sources.old[line.old - 1]!,
        line.new === undefined ? undefined : sources.new[line.new - 1]!];
      // diffr pairs a line only reformatted with its old self; a patch's unchanged line must match exactly.
      if (before !== undefined && before === after) out.push(` ${after}`);
      else {
        if (before !== undefined) out.push(`-${before}`);
        if (after !== undefined) out.push(`+${after}`);
      }
    }
  }
  return out.join("\n");
}
/**
 * A range as a reference an agent can read: its name and the versions it comes from, then the
 * selected rows as a patch, or a version's lines fenced as code when the drag kept to one column.
 */
export function rangeReference(
  files: (DiffFile | undefined)[],
  comparison: NonNullable<Snapshot["comparison"]>,
  range: SelectedRange,
): string {
  const sources = sourcesOf(files, range);
  const name = rangeName(range);
  if (range.side) {
    const [first, last] = span(range, range.side)!;
    const code = sources[range.side].slice(first - 1, last).join("\n");
    const path = (range.side === "old" ? range.oldPath : range.newPath)!;
    const language = /\.([^./]+)$/.exec(path)?.[1] ?? "";
    const fence = fenceFor(code);
    const version = versionName(range.side === "old" ? comparison.lhs : comparison.rhs);
    return `${name} — ${range.side === "old" ? "L" : "R"} is ${version}\n${fence}${language}\n${code}\n${fence}`;
  }
  const body = patch(range, sources);
  const fence = fenceFor(body);
  return `${name} — L is ${versionName(comparison.lhs)}, R is ${versionName(comparison.rhs)}\n${fence}diff\n${body}\n${fence}`;
}
/** The selection as references an agent can read, one per file it touches. */
export function agentReference(
  files: (DiffFile | undefined)[],
  comparison: NonNullable<Snapshot["comparison"]>,
  rows: ViewerRow[],
  selection: SourceSelection,
): string {
  return selectedRanges(files, rows, selection).map((range) => rangeReference(files, comparison, range)).join("\n\n");
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
