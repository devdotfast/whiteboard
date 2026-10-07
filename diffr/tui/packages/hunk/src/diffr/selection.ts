/** Copy original source lines from one side, excluding gutters, padding, and wrapped duplicates. */
import type { DiffFile } from "./wire";
import type { ViewerRow } from "./rows";
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
    const n =
      selection.side === "left"
        ? (row.left?.lineNumber ?? row.cell?.oldLineNumber)
        : (row.right?.lineNumber ?? row.cell?.newLineNumber);
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
