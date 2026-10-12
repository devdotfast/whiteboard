import type { JsonValue } from "@dev.fast/review-protocol";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";

import {
  type ParsedMarkdown,
  fragmentToMarkdown,
  parseBlockMarkdown,
  parsedTree,
} from "./markdown";
import { boardSchema, nodes } from "./schema";

// Board JSON <-> the editor document.
//
// Loading flattens sections into headings at their depth. Saving cuts the
// document back into blocks: a heading opens a section under the nearest
// heading above it at a lower level, and a block keeps its id while its
// node does. Unchanged blocks come back as the very objects they were, and
// a changed Markdown block reuses its source for every paragraph the edit
// did not touch.

export interface BlockJSON {
  id?: string;
  type: string;
  /** A section's blocks. */
  children?: BlockJSON[];
  [key: string]: JsonValue | BlockJSON[] | undefined;
}

export interface Board {
  title: string;
  document: BlockJSON[];
}

/** A stored document as the editor reads it: plain JSON objects. */
export const storedBlocks = (document: readonly object[]): BlockJSON[] =>
  // SAFETY: every stored block is a JSON object with a string `type`.
  document as BlockJSON[];

/** A block to save: one the person made has no id, and carries the key
 * its node goes by until the server names it. */
export interface SavedBlock extends BlockJSON {
  clientKey?: string;
  children?: SavedBlock[];
}

/** A board to save: its blocks as the editor cut them. */
export interface SavedBoard extends Board {
  document: SavedBlock[];
}

const parsed = new Map<string, ParsedMarkdown>();

/** Parsing is the slow part of a load, and most blocks never change. */
export function parseCached(source: string): ParsedMarkdown {
  let result = parsed.get(source);

  if (!result) {
    if (parsed.size > 4000) parsed.clear();
    result = parseBlockMarkdown(source, boardSchema);
    parsed.set(source, result);
  }

  return result;
}

const text = (value: string) => (value ? boardSchema.text(value) : undefined);

export function boardToDoc(board: Board): PMNode {
  return nodes.doc.create(null, [
    nodes.title.create(null, text(board.title)),
    ...blocksToNodes(board.document, 1),
  ]);
}

export function blocksToNodes(blocks: BlockJSON[], level: number): PMNode[] {
  return blocks.flatMap((block) => {
    if (block.type === "section")
      return [
        nodes.section.create(
          { id: block.id, level },
          text(String(block.title)),
        ),
        ...blocksToNodes(block.children!, level + 1),
      ];

    return [blockToNode(block, level - 1)];
  });
}

/** A block that is not a section, as its one top-level node, inside
 * `depth` sections. */
export function blockToNode(block: BlockJSON, depth: number): PMNode {
  if (block.type === "markdown")
    return nodes.markdown.create(
      { id: block.id, depth },
      parseCached(String(block.markdown)).nodes,
    );

  return nodes.atom.create({ id: block.id, json: block, depth });
}

/** Every block of a board by id, sections' children included. */
export function blockIndex(
  blocks: BlockJSON[],
  into = new Map<string, BlockJSON>(),
): Map<string, BlockJSON> {
  for (const block of blocks) {
    if (block.id) into.set(block.id, block);

    if (block.type === "section") blockIndex(block.children!, into);
  }

  return into;
}

/** The block with `fields` replaced, its keys in their stored order. */
const withFields = (block: BlockJSON, fields: Partial<BlockJSON>) =>
  // SAFETY: the same keys as `block`, so `type` and the rest keep their kinds.
  Object.fromEntries(
    Object.entries(block).map(([key, value]) => [
      key,
      key in fields ? fields[key] : value,
    ]),
  ) as BlockJSON;

const isEmptyMarkdown = (node: PMNode) => {
  let empty = true;
  node.forEach((child) => {
    if (child.type !== nodes.paragraph || child.content.size) empty = false;
  });

  return empty;
};

/**
 * The board a document saves as, against `base`, the version it was loaded
 * from or last saved as. An emptied heading is no section: what follows it
 * belongs to the section above. An empty Markdown block is dropped.
 */
export function docToBoard(doc: PMNode, base: Board): SavedBoard {
  const index = blockIndex(base.document);
  const document: SavedBlock[] = [];

  const open: { level: number; children: SavedBlock[] }[] = [
    { level: 0, children: document },
  ];

  const seen = new Set<string>();

  // A copy of a block (pasted, or a heading split in two) is a new block.
  const own = (node: PMNode) => {
    const id: string | null = node.attrs.id;

    if (!id || seen.has(id)) return undefined;
    seen.add(id);

    return id;
  };

  // A block the base doesn't have: one the person made, named by its key,
  // or one ⌘Z brought back from an earlier version, which keeps its id.
  const fresh = (
    node: PMNode,
    id: string | undefined,
    block: BlockJSON,
  ): SavedBlock =>
    id
      ? { id, ...block }
      : node.attrs.key
        ? { ...block, clientKey: node.attrs.key }
        : block;

  doc.forEach((node, _offset, position) => {
    if (position === 0) return;

    if (node.type === nodes.section) {
      const title = node.textContent.trim();

      if (!title) return;
      const level: number = node.attrs.level;

      while (open.at(-1)!.level >= level) open.pop();
      const id = own(node);
      const stored = id ? index.get(id) : undefined;

      const section: SavedBlock =
        stored?.type === "section"
          ? withFields(stored, { title, children: [] })
          : fresh(node, id, { type: "section", title, children: [] });

      open.at(-1)!.children.push(section);
      open.push({ level, children: section.children! });

      return;
    }

    // A block that was after a section's end, not in it, stays there.
    const depth: number | null = node.attrs.depth;

    while (depth !== null && open.at(-1)!.level > depth) open.pop();
    const children = open.at(-1)!.children;

    if (node.type === nodes.markdown) {
      if (isEmptyMarkdown(node)) return;
      const id = own(node);
      const stored = id ? index.get(id) : undefined;

      if (stored?.type !== "markdown") {
        children.push(
          fresh(node, id, { type: "markdown", markdown: markdownOf(node) }),
        );

        return;
      }

      const markdown = markdownOf(node, String(stored.markdown));
      children.push(
        markdown === stored.markdown
          ? stored
          : withFields(stored, { markdown }),
      );

      return;
    }

    // A rich block is saved as it was stored; a copy, without an id, is
    // a new block, named by its key.
    const json: BlockJSON = node.attrs.json;
    const id = own(node);

    if (id) children.push(json);
    else {
      const { id: _copied, ...copy } = json;

      children.push(fresh(node, undefined, copy));
    }
  });

  // A board always has a title; a cleared one saves as a new board's.
  return { title: doc.firstChild!.textContent.trim() || UNTITLED, document };
}

/**
 * A Markdown container's source. Unchanged content keeps `source` verbatim;
 * otherwise each paragraph, list or quote the edit left alone keeps its own
 * source, and only the rest is written fresh.
 */
export function markdownOf(node: PMNode, source?: string): string {
  const original = source === undefined ? undefined : parseCached(source);

  if (source !== undefined && node.content.eq(Fragment.from(original!.nodes)))
    return source;

  const trailing = (markdown: string) =>
    source?.endsWith("\n")
      ? `${markdown.replace(/\n*$/, "")}\n`
      : markdown.replace(/\n+$/, "");

  const whole = trailing(fragmentToMarkdown(node.content));

  if (!original) return whole;

  const parts: string[] = [];
  let reused = false;
  let from = 0;

  node.forEach((child) => {
    // Markdown can't hold an empty paragraph; the editor can, until saved.
    if (child.type === nodes.paragraph && !child.content.size) return;

    const at = original.nodes.findIndex(
      (candidate, i) => i >= from && candidate.eq(child),
    );

    const separator = parts.length
      ? "\n".repeat((child.attrs.gap ?? 1) + 1)
      : "";

    if (at >= 0) {
      reused = true;
      from = at + 1;
      parts.push(separator + original.slices[at]);
    } else
      parts.push(
        separator +
          fragmentToMarkdown(Fragment.from(child)).replace(/\n+$/, ""),
      );
  });

  if (!reused) return whole;
  const pieced = trailing(parts.join(""));

  return pieced === whole || parsedTree(pieced) === parsedTree(whole)
    ? pieced
    : whole;
}

/** A board's title until the person names it. */
export const UNTITLED = "Untitled";

/** A board just started from the sidebar or ⌘N, before anyone wrote on
 * it: an empty first version still called Untitled. */
export function isNewBoard(snapshot: {
  version: number;
  title: string;
  document: readonly unknown[];
}): boolean {
  return (
    snapshot.version === 0 &&
    snapshot.title === UNTITLED &&
    !snapshot.document.length
  );
}
