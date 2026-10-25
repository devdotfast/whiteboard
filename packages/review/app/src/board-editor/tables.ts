import type { Node as PMNode } from "@tiptap/pm/model";
import {
  type Command,
  type EditorState,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import {
  addColumnAfter,
  addColumnBefore,
  deleteColumn,
  goToNextCell,
  isInTable,
  selectedRect,
} from "@tiptap/pm/tables";

import { nodes } from "./schema";

// Editing a GFM table: Tab and Shift-Tab move between cells, Enter goes to
// the cell below, and the last cell's Tab or the last row's Enter add a row.
// Rows and columns come and go through the "/" menu. The first row is the
// header: a row never goes above it, and it can't be deleted. A table with
// one column keeps it.

/** The table around the caret's cell: where it starts, its rows and
 * columns, and the caret's row and column. */
function caretCell(state: EditorState) {
  if (!isInTable(state)) return undefined;
  const rect = selectedRect(state);

  return {
    ...rect,
    row: rect.top,
    column: rect.left,
    rows: rect.map.height,
    columns: rect.map.width,
  };
}

/** A body row of empty cells, aligned as the header's. */
function bodyRow(table: PMNode): PMNode {
  const cells: PMNode[] = [];

  table.firstChild!.forEach((header) =>
    cells.push(
      nodes.table_cell.create(
        { align: header.attrs.align },
        nodes.paragraph.create(),
      ),
    ),
  );

  return nodes.table_row.create(null, cells);
}

/** Add an empty body row at `index` and put the caret in its `column`. */
function insertRow(
  tr: Transaction,
  tableStart: number,
  table: PMNode,
  index: number,
  column: number,
) {
  let pos = tableStart;

  for (let row = 0; row < index; row++) pos += table.child(row).nodeSize;
  const row = bodyRow(table);

  tr.insert(pos, row);

  // Into the row, past `column` cells, into the cell and its paragraph.
  let at = pos + 1;

  for (let cell = 0; cell < column; cell++) at += row.child(cell).nodeSize;

  tr.setSelection(TextSelection.create(tr.doc, at + 2));
}

/** A row below the caret's, the caret in it. */
export const addRowBelow: Command = (state, dispatch) => {
  const cell = caretCell(state);

  if (!cell) return false;
  const tr = state.tr;

  insertRow(tr, cell.tableStart, cell.table, cell.row + 1, cell.column);
  dispatch?.(tr.scrollIntoView());

  return true;
};

/** A row above the caret's; never above the header. */
export const addRowAbove: Command = (state, dispatch) => {
  const cell = caretCell(state);

  if (!cell || cell.row === 0) return false;
  const tr = state.tr;

  insertRow(tr, cell.tableStart, cell.table, cell.row, cell.column);
  dispatch?.(tr.scrollIntoView());

  return true;
};

/** Delete the caret's row; the header row stays. */
export const deleteBodyRow: Command = (state, dispatch) => {
  const cell = caretCell(state);

  if (!cell || cell.top === 0) return false;

  if (dispatch) {
    let from = cell.tableStart;

    for (let row = 0; row < cell.top; row++)
      from += cell.table.child(row).nodeSize;
    let to = from;

    for (let row = cell.top; row < cell.bottom; row++)
      to += cell.table.child(row).nodeSize;
    const tr = state.tr.delete(from, to);

    dispatch(
      tr
        .setSelection(
          TextSelection.near(tr.doc.resolve(Math.max(0, from - 2)), -1),
        )
        .scrollIntoView(),
    );
  }

  return true;
};

/** Delete the caret's column; a table keeps its last one. */
export const deleteTableColumn: Command = (state, dispatch) => {
  const cell = caretCell(state);

  if (!cell || cell.columns <= cell.right - cell.left) return false;

  return deleteColumn(state, dispatch);
};

export const addColumnRight: Command = addColumnAfter;

export const addColumnLeft: Command = addColumnBefore;

/** Into the next or previous cell, the caret at the end of its text, not
 * its text selected: Tab never types over a cell. */
const moveCell =
  (direction: 1 | -1): Command =>
  (state, dispatch) =>
    goToNextCell(direction)(
      state,
      dispatch &&
        ((tr) =>
          dispatch(
            tr.setSelection(TextSelection.create(tr.doc, tr.selection.to)),
          )),
    );

/** Tab: the next cell, or a new row after the last one. */
export const nextCell: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;

  if (moveCell(1)(state, dispatch)) return true;
  const cell = caretCell(state)!;

  if (dispatch) {
    const tr = state.tr;

    insertRow(tr, cell.tableStart, cell.table, cell.rows, 0);
    dispatch(tr.scrollIntoView());
  }

  return true;
};

/** Shift-Tab: the cell before, staying put in the first. */
export const previousCell: Command = (state, dispatch) =>
  isInTable(state) && (moveCell(-1)(state, dispatch) || true);

/** Enter in a cell: the cell below, or a new row under the last. A cell is
 * one line, so Enter never splits it. */
export const enterInCell: Command = (state, dispatch) => {
  const cell = caretCell(state);

  if (!cell) return false;

  if (dispatch) {
    const tr = state.tr;

    if (cell.row + 1 < cell.rows) {
      let pos = cell.tableStart;

      for (let row = 0; row <= cell.row; row++)
        pos += cell.table.child(row).nodeSize;
      let at = pos + 1;

      const below = cell.table.child(cell.row + 1);

      for (let column = 0; column < cell.column; column++)
        at += below.child(column).nodeSize;

      // At the end of the cell's text, as Tab leaves it.
      const line = below.child(cell.column).firstChild!;

      tr.setSelection(TextSelection.create(tr.doc, at + 2 + line.content.size));
    } else insertRow(tr, cell.tableStart, cell.table, cell.rows, cell.column);

    dispatch(tr.scrollIntoView());
  }

  return true;
};

/** The caret, alone, at one edge of a cell's line. */
const atCellEdge = (state: EditorState, edge: "start" | "end") => {
  const { $from, empty } = state.selection;

  if (!empty || $from.node(-1).type.spec.tableRole === undefined) return false;

  return edge === "start"
    ? $from.parentOffset === 0
    : $from.parentOffset === $from.parent.content.size;
};

/** Backspace at a cell's start and Delete at its end do nothing: cells
 * never merge, and a table is deleted from outside it. */
export const stayAtCellStart: Command = (state) => atCellEdge(state, "start");

export const stayAtCellEnd: Command = (state) => atCellEdge(state, "end");

/** A new table in place of the empty line at `start`: a header row and one
 * body row, three columns, the caret in the first header cell. */
export function insertTable(tr: Transaction, start: number) {
  const $start = tr.doc.resolve(start);

  const header = nodes.table_row.create(
    null,
    [0, 1, 2].map(() =>
      nodes.table_header.create(null, nodes.paragraph.create()),
    ),
  );

  const table = nodes.table.create(null, [header]);
  const full = table.type.create(null, [header, bodyRow(table)]);

  tr.replaceWith($start.before(), $start.after(), full);
  tr.setSelection(TextSelection.create(tr.doc, $start.before() + 4));
}
