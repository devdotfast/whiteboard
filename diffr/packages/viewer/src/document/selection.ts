/** Copy original source lines from one side, excluding gutters, padding, and wrapped duplicates. */
import type { DiffFile } from "../protocol/wire";
import type { ViewerRow } from "./rows";
import type { Snapshot } from "../protocol/store";
import { snapshotLabel } from "./counts";
import { sourceLines } from "./regions";
export interface SourceSelection {
  anchor: string;
  end: string;
  side: "left" | "right";
}
export function selectionBounds(
  rows: ViewerRow[],
  selection: SourceSelection | null,
): [number, number] {
  if (!selection) return [-1, -1];
  const a = rows.findIndex((r) => r.key === selection.anchor),
    b = rows.findIndex((r) => r.key === selection.end);
  return a < 0 || b < 0 ? [-1, -1] : [Math.min(a, b), Math.max(a, b)];
}
const lineNumber = (row: ViewerRow, side: SourceSelection["side"]) =>
  side === "left"
    ? (row.left?.lineNumber ?? row.cell?.oldLineNumber)
    : (row.right?.lineNumber ?? row.cell?.newLineNumber);
type Version = NonNullable<Snapshot["comparison"]>["lhs"];
/** Where an agent finds this version of a file: the file on disk needs no words, the rest are named. */
function whereToFind(version: Version): string {
  switch (version.type) {
    case "working_tree":
      return "";
    case "index":
      return " in the git index (staged)";
    case "revision":
    case "path":
      return ` at ${snapshotLabel(version)}`;
    case "empty_tree":
      throw new Error("The empty tree has no source to copy");
  }
}
/**
 * The selection as a reference an agent can read: for each file, its path and line range and,
 * unless it is the file on disk, the version it comes from, then those source lines fenced. The
 * range runs from the first selected line to the last, folded lines included, so the code always
 * matches the range it claims.
 */
export function agentReference(
  files: (DiffFile | undefined)[],
  comparison: NonNullable<Snapshot["comparison"]>,
  rows: ViewerRow[],
  selection: SourceSelection,
): string {
  const [a, b] = selectionBounds(rows, selection);
  const ranges = new Map<number, [number, number]>();
  for (const row of rows.slice(a < 0 ? rows.length : a, b + 1)) {
    const n = lineNumber(row, selection.side);
    if (n === undefined) continue;
    const range = ranges.get(row.fileIndex);
    ranges.set(row.fileIndex, range ? [Math.min(range[0], n), Math.max(range[1], n)] : [n, n]);
  }
  const left = selection.side === "left";
  return [...ranges].map(([fileIndex, [start, end]]) => {
    const file = files[fileIndex];
    const source = file?.diff.type === "text" ? (left ? file.diff.lhs : file.diff.rhs) : undefined;
    const path = left ? file?.file.lhs?.path : file?.file.rhs?.path;
    if (!source || path === undefined) throw new Error(`File ${fileIndex} has no ${selection.side} source to copy`);
    const code = sourceLines(source.text).slice(start - 1, end).join("\n");
    // Longer than any run of backticks in the code, so the code can't close it.
    const fence = "`".repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((run) => run[0].length + 1)));
    const language = /\.([^./]+)$/.exec(path)?.[1] ?? "";
    const lines = start === end ? `${start}` : `${start}-${end}`;
    const where = whereToFind(left ? comparison.lhs : comparison.rhs);
    return `${path}:${lines}${where}\n${fence}${language}\n${code}\n${fence}`;
  }).join("\n\n");
}
export function copySelection(
  files: (DiffFile | undefined)[],
  rows: ViewerRow[],
  selection: SourceSelection,
): string {
  const [a, b] = selectionBounds(rows, selection),
    seen = new Set<string>(),
    result: string[] = [];
  const sources = new Map<number, string[]>();
  for (const row of rows.slice(a < 0 ? rows.length : a, b + 1)) {
    const n = lineNumber(row, selection.side);
    if (n === undefined) continue;
    const key = `${row.fileIndex}:${n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const diff = files[row.fileIndex]?.diff;
    if (!diff || diff.type !== "text") continue;
    const source = selection.side === "left" ? diff.lhs : diff.rhs;
    if (!source) continue;
    let lines = sources.get(row.fileIndex);
    if (!lines) {
      lines = source.text.split("\n");
      sources.set(row.fileIndex, lines);
    }
    result.push(lines[n - 1]);
  }
  return result.join("\n");
}
