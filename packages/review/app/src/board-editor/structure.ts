import type { Node as PMNode } from "@tiptap/pm/model";
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import type { BlockJSON } from "./board-doc";
import { nodes } from "./schema";

// What keeps the document a board: every block node has an id or a key of
// its own, section levels step down one at a time, an emptied heading goes
// away when the caret leaves it, and the body is never without a line.

/** Set on a transaction that brings in another author's version. */
export const REMOTE = "boardRemote";

let counter = 0;

/** A key for a block the server hasn't named yet. */
export const newKey = () =>
  `k${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A block of the board: a section, a Markdown block or a rich one. */
const isBlock = (node: PMNode) =>
  node.type === nodes.section ||
  node.type === nodes.markdown ||
  node.type === nodes.atom;

/** A rich block's stored fields without its id, for a copy. */
export const withoutId = (json: BlockJSON): BlockJSON => {
  const { id: _id, ...rest } = json;

  return rest;
};

/** Copies of a block (pasted, or a container split in two) lose its id and
 * key; sections step down at most one level at a time; the body keeps a
 * line. */
function normalize(state: EditorState): Transaction | null {
  const tr = state.tr;
  const seen = new Set<string>();
  let level = 0;

  state.doc.forEach((node, pos, index) => {
    if (index === 0 || !isBlock(node)) return;

    for (const name of ["id", "key"] as const) {
      const value: string | null = node.attrs[name];

      if (value && seen.has(value)) {
        tr.setNodeAttribute(pos, name, null);

        // A rich block's copy drops the id it carries in its fields too.
        if (name === "id" && node.type === nodes.atom)
          tr.setNodeAttribute(pos, "json", withoutId(node.attrs.json));
      } else if (value) seen.add(value);
    }

    if (node.type === nodes.section) {
      const clamped = Math.max(1, Math.min(node.attrs.level, level + 1));

      if (clamped !== node.attrs.level)
        tr.setNodeAttribute(pos, "level", clamped);
      level = clamped;
    }
  });

  if (state.doc.childCount === 1)
    tr.insert(
      state.doc.content.size,
      nodes.markdown.create(null, nodes.paragraph.create()),
    );

  return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
}

/** Keys for the block nodes the server hasn't named, before a save. */
export function withKeys(state: EditorState): Transaction | null {
  const tr = state.tr.setMeta("addToHistory", false).setMeta(REMOTE, true);

  state.doc.forEach((node, pos, index) => {
    if (index > 0 && isBlock(node) && !node.attrs.id && !node.attrs.key)
      tr.setNodeAttribute(pos, "key", newKey());
  });

  return tr.docChanged ? tr : null;
}

/** The deepest level a section at `pos` can have: one below the section
 * above it. */
export function deepestLevel(doc: PMNode, pos: number): number {
  let level = 0;

  doc.forEach((node, at) => {
    if (at < pos && node.type === nodes.section) level = node.attrs.level;
  });

  return level + 1;
}

/** The empty heading the caret was on, if the caret has left it. */
function leftEmptyHeading(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): Transaction | null {
  if (transactions.some((tr) => tr.getMeta(REMOTE))) return null;
  const $old = oldState.selection.$from;
  const line = $old.parent;

  if (line.type !== nodes.section && line.type !== nodes.heading) return null;
  let pos = $old.before();

  for (const tr of transactions) pos = tr.mapping.map(pos, 1);
  const node = newState.doc.nodeAt(pos);

  if (!node || node.type !== line.type || node.content.size) return null;
  const { from, to } = newState.selection;

  if (from > pos && to < pos + node.nodeSize) return null;
  const $pos = newState.doc.resolve(pos);
  const box = $pos.parent;

  // A heading that was a container's only line takes the container along.
  if (box.type === nodes.markdown && box.childCount === 1)
    return newState.tr.delete($pos.before(), $pos.after());

  return newState.tr.delete(pos, pos + node.nodeSize);
}

// An empty board still takes its first line.
export const structure = () =>
  new Plugin({
    appendTransaction: (transactions, oldState, newState) =>
      leftEmptyHeading(transactions, oldState, newState) ??
      (transactions.some((tr) => tr.docChanged) || newState.doc.childCount === 1
        ? normalize(newState)
        : null),
  });

/** The block the caret or selection is in: the one a person is editing. */
export function focusedBlock(state: EditorState): string | null {
  const { selection } = state;

  if (selection instanceof NodeSelection)
    return selection.node.attrs.id ?? null;
  const $from = selection.$from;

  if ($from.depth < 1) return null;

  return $from.node(1).attrs.id ?? null;
}

const placeholderKey = new PluginKey("boardPlaceholder");

export const BODY_PLACEHOLDER = "Start writing, or type / for blocks";

/** Faint hints on empty lines: "Heading" on the empty heading the caret is
 * on, and how to start on an empty board. (An unnamed title draws its own.) */
export const placeholders = () =>
  new Plugin({
    key: placeholderKey,
    props: {
      decorations(state) {
        const found: Decoration[] = [];
        const { doc, selection } = state;
        const first = doc.maybeChild(1);

        if (
          doc.childCount === 2 &&
          first?.type === nodes.markdown &&
          first.childCount === 1 &&
          first.firstChild!.type === nodes.paragraph &&
          !first.firstChild!.content.size
        ) {
          const at = doc.firstChild!.nodeSize + 1;

          found.push(
            Decoration.node(at, at + 2, {
              class: "review-board-placeholder",
              "data-placeholder": BODY_PLACEHOLDER,
            }),
          );
        }

        const $from = selection.$from;

        if (
          selection.empty &&
          ($from.parent.type === nodes.section ||
            $from.parent.type === nodes.heading) &&
          !$from.parent.content.size
        )
          found.push(
            Decoration.node($from.before(), $from.after(), {
              class: "review-board-placeholder",
              "data-placeholder": "Heading",
            }),
          );

        return DecorationSet.create(doc, found);
      },
    },
  });
