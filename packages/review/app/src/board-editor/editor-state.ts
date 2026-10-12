import { baseKeymap, chainCommands, toggleMark } from "@tiptap/pm/commands";
import { history, redo, undo } from "@tiptap/pm/history";
import { undoInputRule } from "@tiptap/pm/inputrules";
import { keymap } from "@tiptap/pm/keymap";
import { Fragment, type Node as PMNode, Slice } from "@tiptap/pm/model";
import { liftListItem, sinkListItem } from "@tiptap/pm/schema-list";
import {
  type Command,
  EditorState,
  Plugin,
  TextSelection,
} from "@tiptap/pm/state";

import { type Board, boardToDoc } from "./board-doc";
import {
  backspaceAtLineStart,
  deleteAtLineEnd,
  deleteSelectedBlock,
  enter,
  leaveEditing,
  leaveSelectedBlock,
} from "./commands";
import { boardSchema, nodes } from "./schema";
import { shortcuts } from "./shortcuts";
import { slashMenu } from "./slash";
import { placeholders, structure, withoutId } from "./structure";

// The editor state for one board: the document and every plugin that
// makes it edit like a Markdown file.

const hardBreak: Command = (state, dispatch) => {
  if (state.selection.$from.parent.type.spec.code) return false;
  dispatch?.(
    state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView(),
  );

  return true;
};

/** ⌘Z right after a Markdown shortcut brings back what was typed, with the
 * caret after it. */
const undoShortcut: Command = (state, dispatch) => {
  const plugin = state.plugins.find((candidate) => candidate.spec.isInputRules);

  const undoable: { from: number; text: string } | null | undefined =
    plugin?.getState(state);

  if (!undoable) return false;

  return undoInputRule(
    state,
    dispatch &&
      ((tr) =>
        dispatch(
          tr.setSelection(
            TextSelection.create(tr.doc, undoable.from + undoable.text.length),
          ),
        )),
  );
};

/** A pasted block is a copy, a rich block's too: the server names it when
 * it is saved, and the original keeps its id. A block moved, by a drag or
 * by cutting it and pasting it back on this board, is the same block and
 * keeps its id. Either way it takes its depth from where it lands. */
export function pastedCopies(
  slice: Slice,
  doc: PMNode,
  moving: boolean,
  /** Blocks this board cut: pasted while gone from it, they are moved. */
  cut: ReadonlySet<string> = new Set(),
): Slice {
  const onBoard = new Set<string>();

  doc.forEach((node) => {
    if (node.attrs.id) onBoard.add(node.attrs.id);
  });

  const kept: PMNode[] = [];

  slice.content.forEach((node) => {
    if (
      node.type !== nodes.section &&
      node.type !== nodes.markdown &&
      node.type !== nodes.atom
    ) {
      kept.push(node);

      return;
    }

    const attrs = { ...node.attrs };

    if (node.type !== nodes.section) attrs.depth = null;

    const id: string | null = node.attrs.id;
    const moved = moving || (id !== null && cut.has(id) && !onBoard.has(id));

    if (!moved) {
      attrs.id = null;
      attrs.key = null;

      if (node.type === nodes.atom) attrs.json = withoutId(node.attrs.json);
    }

    kept.push(node.type.create(attrs, node.content, node.marks));
  });

  return new Slice(Fragment.from(kept), slice.openStart, slice.openEnd);
}

/** Rich blocks are never typed over: with one selected, typing goes to the
 * line after it. */
const richBlocks = (cut = new Set<string>()) =>
  new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.metaKey || event.ctrlKey || event.altKey) return false;

        if (event.key.length !== 1 && event.key !== "Enter") return false;
        const tr = leaveSelectedBlock(view.state);

        if (!tr) return false;
        view.dispatch(tr.scrollIntoView());

        return event.key === "Enter";
      },
      // A drop carries `view.dragging` while it is applied; it moves the
      // blocks unless the person held the copy key.
      transformPasted: (slice, view) =>
        pastedCopies(slice, view.state.doc, view.dragging?.move === true, cut),
      handleDOMEvents: {
        // What this board cut, so pasting it back moves it.
        cut: (view) => {
          cut.clear();
          view.state.selection
            .content()
            .content.forEach((node) => node.attrs.id && cut.add(node.attrs.id));

          return false;
        },
      },
    },
  });

export const boardKeymap = () =>
  keymap({
    Enter: enter,
    "Shift-Enter": chainCommands(hardBreak),
    Backspace: chainCommands(deleteSelectedBlock, backspaceAtLineStart),
    Delete: chainCommands(deleteSelectedBlock, deleteAtLineEnd),
    "Mod-z": chainCommands(undoShortcut, undo),
    "Shift-Mod-z": redo,
    "Mod-y": redo,
    "Mod-b": toggleMark(boardSchema.marks.strong),
    "Mod-i": toggleMark(boardSchema.marks.em),
    "Mod-e": toggleMark(boardSchema.marks.code),
    Tab: sinkListItem(nodes.list_item),
    "Shift-Tab": liftListItem(nodes.list_item),
    Escape: leaveEditing,
  });

export function boardPlugins(extra: Plugin[] = []): Plugin[] {
  return [
    ...extra,
    slashMenu(),
    richBlocks(),
    shortcuts(),
    boardKeymap(),
    keymap(baseKeymap),
    history(),
    structure(),
    placeholders(),
  ];
}

export function createBoardState(
  board: Board,
  extra: Plugin[] = [],
): EditorState {
  const state = EditorState.create({
    doc: boardToDoc(board),
    plugins: boardPlugins(extra),
  });

  // An empty board gets its first line before the first edit.
  return state.applyTransaction(state.tr.setMeta("addToHistory", false)).state;
}
