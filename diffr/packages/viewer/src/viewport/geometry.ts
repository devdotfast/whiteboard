import { sliceSpansWindow, wrapSpans } from "../terminal/spans";
import type { RenderSpan, ViewerRow } from "../document/rows";
export interface MeasuredRow {
  row: ViewerRow;
  top: number;
  height: number;
  left: RenderSpan[][];
  right: RenderSpan[][];
  cell: RenderSpan[][];
}
export interface Geometry {
  rows: MeasuredRow[];
  height: number;
  leftWidth: number;
  rightWidth: number;
  /** Split gutter: padding, line number, gap, fold chevron, gap. */
  gutter: number;
  /** Unified gutter: padding, old number, gap, new number, gap, chevron, gap. */
  unifiedGutter: number;
}
export function measureRows(
  rows: ViewerRow[],
  width: number,
  wrap: boolean,
  horizontalOffset: number,
  /** The longest source on screen, in lines. Folding never resizes the line-number lane. */
  maxLine: number,
): Geometry {
  const digits = String(maxLine).length;
  const gutter = digits + 4, unifiedGutter = digits * 2 + 5;
  const leftWidth = Math.floor((width - 1) / 2),
    rightWidth = width - leftWidth - 1;
  const measure = (spans: RenderSpan[] | undefined, available: number) => {
    if (!spans) return [];
    return wrap
      ? wrapSpans(spans, Math.max(1, available))
      : [
          sliceSpansWindow(spans, horizontalOffset, Math.max(1, available))
            .spans,
        ];
  };
  let top = 0;
  const measured = rows.map((row) => {
    const left = measure(row.left?.spans, leftWidth - gutter),
      right = measure(row.right?.spans, rightWidth - gutter);
    const cell = measure(row.cell?.spans, width - unifiedGutter);
    const height = Math.max(1, left.length, right.length, cell.length);
    const result = { row, top, height, left, right, cell };
    top += height;
    return result;
  });
  return { rows: measured, height: top, leftWidth, rightWidth, gutter, unifiedGutter };
}
export function visibleRows(geometry: Geometry, top: number, height: number) {
  const rows = geometry.rows, bottom = top + Math.max(0, height);
  let start = 0, end = rows.length;
  while (start < end) {
    const mid = (start + end) >>> 1;
    if (rows[mid]!.top + rows[mid]!.height > top) end = mid;
    else start = mid + 1;
  }
  end = start;
  while (end < rows.length && rows[end]!.top < bottom) end++;
  return rows.slice(start, end);
}

/** The source line a row shows on one side. */
function sourceLine(row: ViewerRow, side: "left" | "right") {
  return side === "right" ? row.right?.lineNumber ?? row.cell?.newLineNumber : row.left?.lineNumber ?? row.cell?.oldLineNumber;
}
/** The fold a row's chevron toggles. */
export const rowFold = (row: ViewerRow) => row.cell?.fold ?? row.right?.fold ?? row.left?.fold;
/**
 * Where the reader is: the top row and how far into it. Rows come and go as files load and
 * folds toggle, so the position also keeps the fold and source line it showed to land near.
 * Null is the top of the document.
 */
export interface ViewPosition {
  key: string;
  fileIndex: number;
  offset: number;
  fold?: number;
  side: "left" | "right";
  line?: number;
}
export function positionAt(geometry: Geometry, top: number): ViewPosition | null {
  const item = visibleRows(geometry, top, 1)[0];
  if (!item) return null;
  const row = item.row, right = sourceLine(row, "right");
  return { key: row.key, fileIndex: row.fileIndex, offset: top - item.top, fold: rowFold(row)?.id,
    side: right === undefined ? "left" : "right", line: right ?? sourceLine(row, "left") };
}
export function positionTop(geometry: Geometry, position: ViewPosition | null): number {
  if (!position) return 0;
  const at = (row: MeasuredRow) => row.top + Math.min(position.offset, row.height - 1);
  const same = geometry.rows.find(r => r.row.key === position.key);
  if (same) return at(same);
  // The row is gone: land on the fold it showed, else the next source line it showed, else
  // the file's header.
  const file = geometry.rows.filter(r => r.row.fileIndex === position.fileIndex);
  const folded = position.fold !== undefined && file.find(r =>
    [r.row.left?.fold?.id, r.row.right?.fold?.id, r.row.cell?.fold?.id].includes(position.fold));
  if (folded) return at(folded);
  const line = position.line;
  const next = line !== undefined && file.find(r => (sourceLine(r.row, position.side) ?? -1) >= line);
  return (next || file[0]!).top;
}
