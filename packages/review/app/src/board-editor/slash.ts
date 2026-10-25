import type { Attrs, NodeType } from "@tiptap/pm/model";
import {
  type Command,
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { findWrapping } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";

import { paragraphToSection } from "./commands";
import { nodes } from "./schema";
import { isTopLine } from "./shortcuts";
import {
  addColumnLeft,
  addColumnRight,
  addRowAbove,
  addRowBelow,
  deleteBodyRow,
  deleteTableColumn,
  insertTable,
} from "./tables";

// The "/" menu: typed on an empty line, it lists the kinds of text block,
// filtered by what follows the slash; in an empty table cell, it lists the
// table's rows and columns to add or delete. ↑↓ move, Enter applies, Esc
// closes and leaves the "/" as text. A "/" anywhere else is just a slash.

export interface SlashItem {
  label: string;
  /** The Markdown shortcut that makes the same block. */
  shortcut: string;
  /** Listed in a table cell rather than on a line of its own. */
  inCell?: true;
  apply(tr: Transaction, start: number): void;
}

/** The empty line at `pos` is a table cell's. */
const inCell = (state: EditorState, pos: number) =>
  state.doc.resolve(pos).node(-1).type.spec.tableRole !== undefined;

/** An item that runs a command where the "/" was, once it is gone. */
const command =
  (run: Command) =>
  (tr: Transaction): void => {
    const state = EditorState.create({ doc: tr.doc, selection: tr.selection });

    run(state, (inner) => {
      inner.steps.forEach((step) => tr.step(step));
      tr.setSelection(Selection.fromJSON(tr.doc, inner.selection.toJSON()));
    });
  };

const wrapper =
  (type: NodeType, attrs?: Attrs) => (tr: Transaction, start: number) => {
    const range = tr.doc.resolve(start).blockRange();
    const wrapping = range && findWrapping(range, type, attrs);

    if (wrapping) tr.wrap(range, wrapping);
  };

const section = (level: number) => (tr: Transaction, start: number) => {
  paragraphToSection(tr, tr.doc.resolve(start), level);
};

const markup = (bullet: string) => ({ bullet, increment: true, indent: "one" });

export const slashItems: SlashItem[] = [
  { label: "Text", shortcut: "", apply: () => {} },
  { label: "Heading 1", shortcut: "#", apply: section(1) },
  { label: "Heading 2", shortcut: "##", apply: section(2) },
  { label: "Heading 3", shortcut: "###", apply: section(3) },
  {
    label: "Bulleted list",
    shortcut: "-",
    apply: wrapper(nodes.bullet_list, { markup: markup("-") }),
  },
  {
    label: "Numbered list",
    shortcut: "1.",
    apply: wrapper(nodes.ordered_list, { markup: markup(".") }),
  },
  {
    label: "To-do list",
    shortcut: "- [ ]",
    apply: wrapper(nodes.task_list, { markup: markup("-") }),
  },
  { label: "Quote", shortcut: ">", apply: wrapper(nodes.blockquote) },
  {
    label: "Code",
    shortcut: "```",
    apply: (tr, start) => {
      tr.setBlockType(start, start, nodes.code_block, { markup: "`" });
    },
  },
  { label: "Table", shortcut: "|", apply: insertTable },
  {
    label: "Row below",
    shortcut: "",
    inCell: true,
    apply: command(addRowBelow),
  },
  {
    label: "Row above",
    shortcut: "",
    inCell: true,
    apply: command(addRowAbove),
  },
  {
    label: "Column right",
    shortcut: "",
    inCell: true,
    apply: command(addColumnRight),
  },
  {
    label: "Column left",
    shortcut: "",
    inCell: true,
    apply: command(addColumnLeft),
  },
  {
    label: "Delete row",
    shortcut: "",
    inCell: true,
    apply: command(deleteBodyRow),
  },
  {
    label: "Delete column",
    shortcut: "",
    inCell: true,
    apply: command(deleteTableColumn),
  },
];

export type SlashState =
  | { open: false }
  | {
      open: true;
      from: number;
      query: string;
      items: SlashItem[];
      index: number;
    };

export const slashKey = new PluginKey<SlashState>("boardSlash");

const closed: SlashState = { open: false };

const matching = (query: string, cell: boolean) =>
  slashItems.filter(
    (item) =>
      Boolean(item.inCell) === cell &&
      item.label.toLowerCase().includes(query.toLowerCase()),
  );

/** Where the open menu stands: its "/" still starts the caret's line. */
function follow(state: EditorState, from: number, index: number): SlashState {
  const { selection, doc } = state;
  const $from = doc.resolve(from);

  if (
    !selection.empty ||
    from >= doc.content.size ||
    doc.textBetween(from, from + 1) !== "/" ||
    selection.$from.parent !== $from.parent ||
    selection.from <= from
  )
    return closed;
  const query = doc.textBetween(from + 1, selection.from);
  const items = matching(query, inCell(state, from));

  if (!items.length) return closed;

  return {
    open: true,
    from,
    query,
    items,
    index: Math.min(index, items.length - 1),
  };
}

export function applySlashItem(view: EditorView, item: SlashItem) {
  const state = slashKey.getState(view.state);

  if (!state?.open) return;
  const $from = view.state.doc.resolve(state.from);
  const tr = view.state.tr.delete(state.from, $from.end());

  tr.setSelection(TextSelection.create(tr.doc, state.from));
  item.apply(tr, state.from);
  view.dispatch(tr.setMeta(slashKey, closed).scrollIntoView());
  view.focus();
}

export const slashMenu = () =>
  new Plugin<SlashState>({
    key: slashKey,
    state: {
      init: () => closed,
      apply(tr, value, _old, state) {
        const meta: SlashState | { index: number } | undefined =
          tr.getMeta(slashKey);

        if (meta && "open" in meta)
          return meta.open ? follow(state, meta.from, 0) : closed;

        if (!value.open) return value;

        return follow(
          state,
          tr.mapping.map(value.from),
          meta && "index" in meta ? meta.index : value.index,
        );
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        const { state } = view;
        const $from = state.doc.resolve(from);

        if (
          text !== "/" ||
          from !== to ||
          $from.parent.content.size ||
          !(isTopLine(state, from) || inCell(state, from))
        )
          return false;
        view.dispatch(
          state.tr
            .insertText("/", from)
            .setMeta(slashKey, { open: true, from }),
        );

        return true;
      },
      handleKeyDown(view, event) {
        const state = slashKey.getState(view.state);

        if (!state?.open) return false;

        const move = (by: number) => {
          const index =
            (state.index + by + state.items.length) % state.items.length;

          view.dispatch(view.state.tr.setMeta(slashKey, { index }));
        };

        switch (event.key) {
          case "ArrowDown":
            move(1);

            return true;
          case "ArrowUp":
            move(-1);

            return true;
          case "Enter":
          case "Tab":
            applySlashItem(view, state.items[state.index]!);

            return true;
          case "Escape":
            view.dispatch(view.state.tr.setMeta(slashKey, closed));

            return true;
          default:
            return false;
        }
      },
    },
  });
