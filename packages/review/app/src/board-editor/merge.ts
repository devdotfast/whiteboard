import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import {
  type BlockJSON,
  type Board,
  blockToNode,
  docToBoard,
} from "./board-doc";
import { nodes } from "./schema";
import { REMOTE } from "./structure";

// Another author's version lands in the open editor as ONE transaction
// kept out of the person's undo history, so ⌘Z never reverts it.
//
// Per block, against `base` (the version the editor last loaded or saved):
//   - a block the other author left as it was keeps the local node, with
//     any typing not saved yet;
//   - a block they changed is replaced by their version, except the block
//     the person is in, which the server refuses them anyway, and a block
//     with typing not saved yet, which its save then decides;
//   - blocks they added, removed or moved are placed in their order around
//     the local nodes kept; blocks the person added are kept, and so is a
//     block they removed that the person is in or has unsaved typing in;
//   - their new title lands unless the person retitled the board unsaved.

interface Item {
  id: string;
  block: BlockJSON;
  level: number;
  /** A section's own fields; its children are items of their own. */
  fields: string;
}

function flatten(blocks: BlockJSON[], level = 1, into: Item[] = []): Item[] {
  for (const block of blocks) {
    if (block.type === "section") {
      const { children, ...own } = block;
      into.push({ id: block.id!, block, level, fields: JSON.stringify(own) });
      flatten(children!, level + 1, into);
    } else
      into.push({ id: block.id!, block, level, fields: JSON.stringify(block) });
  }

  return into;
}

const nodeFor = (item: Item) =>
  item.block.type === "section"
    ? nodes.section.create(
        { id: item.id, level: item.level },
        item.block.title
          ? nodes.title.schema.text(String(item.block.title))
          : undefined,
      )
    : blockToNode(item.block, item.level - 1);

/** The blocks whose typing `base` doesn't have yet, by id. */
export function editedBlocks(state: EditorState, base: Board): Set<string> {
  const saved = new Map(
    flatten(base.document).map((item) => [item.id, item.fields]),
  );

  return new Set(
    flatten(docToBoard(state.doc, base).document)
      .filter((item) => item.id && saved.get(item.id) !== item.fields)
      .map((item) => item.id),
  );
}

export function applyVersion(
  state: EditorState,
  base: Board,
  next: Board,
  focused: string | null = null,
): Transaction | null {
  const tr = state.tr.setMeta("addToHistory", false).setMeta(REMOTE, true);

  const before = new Map(
    flatten(base.document).map((item) => [item.id, item.fields]),
  );

  // Blocks with typing the last save didn't carry: never dropped.
  const edited = editedBlocks(state, base);

  const items = flatten(next.document);
  const nextIds = new Set(items.map((item) => item.id));
  const unchanged = (item: Item) => before.get(item.id) === item.fields;

  const local: { key: string; node: PMNode; pos: number }[] = [];
  state.doc.forEach((node, pos, index) => {
    if (index > 0) local.push({ key: node.attrs.id ?? `~${pos}`, node, pos });
  });
  const mine = new Map(local.map((entry) => [entry.key, entry]));

  // The order wanted: theirs, minus blocks the person deleted (and they
  // didn't touch), plus blocks only the person has.
  const target: { key: string; item?: Item }[] = [];

  for (const item of items)
    if (mine.has(item.id) || !unchanged(item))
      target.push({ key: item.id, item });

  const { from, to } = state.selection;

  /** An empty line the person isn't on: a new board's first line, once
   * someone else writes the board. */
  const blank = ({ node, pos }: (typeof local)[number]) =>
    node.type === nodes.markdown &&
    !node.textContent &&
    node.childCount === 1 &&
    (to < pos || from > pos + node.nodeSize);

  // A block they deleted that the person is in, or typed in since the last
  // save, stays where it was; the next save brings it back.
  const holding = (key: string) => key === focused || edited.has(key);

  local.forEach((entry, i) => {
    if (
      (before.has(entry.key) && !holding(entry.key)) ||
      nextIds.has(entry.key) ||
      (items.length && blank(entry))
    )
      return;
    const after = local[i - 1]?.key;

    const at = after
      ? target.findIndex((wanted) => wanted.key === after) + 1
      : 0;

    target.splice(at, 0, { key: entry.key });
  });

  const keep = (key: string, item?: Item) =>
    !item ||
    (mine.has(key) && (unchanged(item) || key === focused || edited.has(key)));

  /** A local node kept, at the depth their version gives it. */
  const kept = (node: PMNode, item?: Item) => {
    if (!item) return node;

    const [name, value] =
      node.type === nodes.section
        ? ["level", item.level]
        : ["depth", item.level - 1];

    return node.attrs[name] === value
      ? node
      : node.type.create({ ...node.attrs, [name]: value }, node.content);
  };

  const build = ({ key, item }: { key: string; item?: Item }) =>
    keep(key, item) ? kept(mine.get(key)!.node, item) : nodeFor(item!);

  const replacements: { from: number; to: number; nodes: PMNode[] }[] = [];

  const common = lcs(
    local.map((entry) => entry.key),
    target.map((wanted) => wanted.key),
  );

  let li = 0;
  let ti = 0;
  const end = state.doc.content.size;

  for (const key of [...common, null]) {
    const gapLocal: typeof local = [];

    while (li < local.length && local[li]!.key !== key)
      gapLocal.push(local[li++]!);
    const gapTarget: typeof target = [];

    while (ti < target.length && target[ti]!.key !== key)
      gapTarget.push(target[ti++]!);

    if (gapLocal.length || gapTarget.length) {
      const from =
        gapLocal[0]?.pos ?? (li < local.length ? local[li]!.pos : end);

      const last = gapLocal.at(-1);

      replacements.push({
        from,
        to: last ? last.pos + last.node.nodeSize : from,
        nodes: gapTarget.map(build),
      });
    }

    if (key === null) break;
    const entry = local[li++]!;
    const wanted = target[ti++]!;
    const node = build(wanted);

    if (node !== entry.node)
      replacements.push({
        from: entry.pos,
        to: entry.pos + entry.node.nodeSize,
        nodes: [node],
      });
  }

  // Their rename lands unless the person has retitled it since the last
  // save.
  if (
    base.title !== next.title &&
    state.doc.firstChild!.textContent === base.title
  ) {
    const title = state.doc.firstChild!;
    replacements.push({
      from: 1,
      to: 1 + title.content.size,
      nodes: next.title ? [nodes.title.schema.text(next.title)] : [],
    });
  }

  // Ranges don't overlap; apply from the end so earlier positions hold. At
  // equal `from`, the wider range goes first, so an insertion at its start
  // lands in front of it.
  replacements.sort((a, b) => b.from - a.from || b.to - a.to);

  for (const { from, to, nodes: content } of replacements)
    tr.replaceWith(from, to, content);

  return tr.docChanged ? tr : null;
}

/** Longest common subsequence of two key lists. */
function lcs(a: string[], b: string[]): string[] {
  const table = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);

  const out: string[] = [];

  for (let i = 0, j = 0; i < a.length && j < b.length; )
    if (a[i] === b[j]) {
      out.push(a[i]!);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;

  return out;
}
