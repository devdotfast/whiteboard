import {
  chainCommands,
  lift,
  newlineInCode,
  setBlockType,
  splitBlock,
} from "@tiptap/pm/commands";
import { type Node as PMNode, type ResolvedPos, Slice } from "@tiptap/pm/model";
import { liftListItem, splitListItem } from "@tiptap/pm/schema-list";
import {
  type Command,
  type EditorState,
  NodeSelection,
  Selection,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { replaceStep } from "@tiptap/pm/transform";

import { nodes } from "./schema";
import { deepestLevel } from "./structure";

// Keys that make a board edit like one plain Markdown file: block
// boundaries are invisible, Enter splits a line and Backspace joins two,
// anywhere. A styled line (a heading, a list item, a quote) first loses its
// style at Backspace; a rich block is selected by the first Backspace and
// deleted by the second.

/** A node a line can't enter: a rich block, a rule, a table kept as source. */
export const isSolid = (node: PMNode) => node.isAtom && node.isBlock;

/** The textblock the caret is in, when the selection is a caret. */
const caret = (state: EditorState) =>
  state.selection instanceof TextSelection ? state.selection.$cursor : null;

/** The line before a textblock that starts at `start`, crossing out of any
 * container: a textblock to join, or a solid node to select. */
export function lineBefore(doc: PMNode, start: number) {
  let $pos = doc.resolve(start - 1);

  for (;;) {
    const before = $pos.nodeBefore;

    if (before) {
      let node = before;
      let pos = $pos.pos - before.nodeSize;

      while (!node.isTextblock && !isSolid(node) && node.childCount) {
        pos += node.nodeSize - node.lastChild!.nodeSize - 1;
        node = node.lastChild!;
      }

      return { node, pos };
    }

    if ($pos.depth === 0) return undefined;
    $pos = doc.resolve($pos.before());
  }
}

/** The line after a textblock that ends at `end`. */
export function lineAfter(doc: PMNode, end: number) {
  let $pos = doc.resolve(end + 1);

  for (;;) {
    const after = $pos.nodeAfter;

    if (after) {
      let node = after;
      let pos = $pos.pos;

      while (!node.isTextblock && !isSolid(node) && node.childCount) {
        pos += 1;
        node = node.firstChild!;
      }

      return { node, pos };
    }

    if ($pos.depth === 0) return undefined;
    $pos = doc.resolve($pos.after());
  }
}

/** Join the textblock ending at `end` with the one starting at `start`,
 * as deleting a newline would. The second's style is lost. */
function joinLines(tr: Transaction, end: number, start: number): boolean {
  const $end = tr.doc.resolve(end);

  // A section title holds plain text; marks and inline atoms don't fit.
  if ($end.parent.type === nodes.section)
    tr.clearIncompatible(start - 1, nodes.section);
  else if ($end.parent.type === nodes.title)
    tr.clearIncompatible(start - 1, nodes.title);

  const step = replaceStep(tr.doc, end, start, Slice.empty);

  if (!step) return false;
  tr.step(step);
  tr.setSelection(TextSelection.create(tr.doc, end));

  return true;
}

/** Remove the node at `pos`, and the markdown container around it if it
 * leaves that empty. */
function deleteLine(tr: Transaction, $line: ResolvedPos) {
  const box =
    $line.depth >= 2 && $line.node(1).type === nodes.markdown
      ? $line.node(1)
      : null;

  if (box && box.childCount === 1 && $line.depth === 2)
    tr.delete($line.before(1), $line.after(1));
  else tr.delete($line.before(), $line.after());
}

/** A section heading becomes an ordinary line: its text joins the Markdown
 * around it, and its content the section above. */
export function sectionToParagraph(tr: Transaction, pos: number) {
  const section = tr.doc.nodeAt(pos)!;
  const paragraph = nodes.paragraph.create(null, section.content);
  const $pos = tr.doc.resolve(pos);
  const before = $pos.nodeBefore;
  const after = tr.doc.resolve(pos + section.nodeSize).nodeAfter;

  tr.delete(pos, pos + section.nodeSize);

  // The line joins the block above, or else starts the one below, which
  // keeps its id; only with neither is it a block of its own.
  if (before?.type === nodes.markdown) {
    tr.insert(pos - 1, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, pos));
  } else if (after?.type === nodes.markdown) {
    tr.insert(pos + 1, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, pos + 2));
  } else {
    tr.insert(pos, nodes.markdown.create(null, paragraph));
    tr.setSelection(TextSelection.create(tr.doc, pos + 2));
  }
}

/** A paragraph of a markdown container becomes a section heading at
 * `level`, splitting the container around it; the caret goes `offset`
 * into its text. */
export function paragraphToSection(
  tr: Transaction,
  $paragraph: ResolvedPos,
  level: number,
  offset = 0,
) {
  const box = $paragraph.node(1);
  const boxPos = $paragraph.before(1);
  const index = $paragraph.index(1);
  const paragraph = $paragraph.parent;

  const heading = nodes.section.create(
    { level: Math.min(level, deepestLevel(tr.doc, $paragraph.before(1))) },
    paragraph.textContent
      ? nodes.title.schema.text(paragraph.textContent)
      : undefined,
  );

  const part = (from: number, to: number) => {
    const content: PMNode[] = [];

    for (let i = from; i < to; i++) content.push(box.child(i));

    return content;
  };

  const before = part(0, index);
  const after = part(index + 1, box.childCount);

  const replacement = [
    ...(before.length ? [box.type.create(box.attrs, before)] : []),
    heading,
    // The block keeps its id in the part that has its first line.
    ...(after.length
      ? [nodes.markdown.create(before.length ? null : box.attrs, after)]
      : []),
  ];

  tr.replaceWith(boxPos, boxPos + box.nodeSize, replacement);
  const headingPos = boxPos + (before.length ? replacement[0]!.nodeSize : 0);

  tr.setSelection(
    TextSelection.create(
      tr.doc,
      headingPos + 1 + Math.min(offset, heading.content.size),
    ),
  );

  return headingPos;
}

/** Where Enter in the title lands: the start of the body's first block,
 * or, on a board with no body yet, a first line added for it. */
function bodyStart(tr: Transaction): Selection {
  const title = tr.doc.firstChild!;

  if (tr.doc.childCount === 1)
    tr.insert(
      title.nodeSize,
      nodes.markdown.create(null, nodes.paragraph.create()),
    );

  return Selection.findFrom(tr.doc.resolve(title.nodeSize), 1)!;
}

/** Insert an empty line before or after the top-level node at `pos`,
 * inside the markdown container next to it when there is one. Returns the
 * new line's text position. */
function emptyLineBeside(
  tr: Transaction,
  pos: number,
  side: "before" | "after",
): number {
  const node = tr.doc.nodeAt(pos)!;

  if (side === "after") {
    const end = pos + node.nodeSize;
    const next = tr.doc.resolve(end).nodeAfter;

    if (next?.type === nodes.markdown) {
      tr.insert(end + 1, nodes.paragraph.create());

      return end + 2;
    }

    tr.insert(end, nodes.markdown.create(null, nodes.paragraph.create()));

    return end + 2;
  }

  const previous = tr.doc.resolve(pos).nodeBefore;

  if (previous?.type === nodes.markdown) {
    tr.insert(pos - 1, nodes.paragraph.create());

    return pos;
  }

  tr.insert(pos, nodes.markdown.create(null, nodes.paragraph.create()));

  return pos + 2;
}

/** Enter in the title, wherever the selection is in it, goes to the body. */
const enterInTitle: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;

  if ($from.parent.type !== nodes.title || $to.parent.type !== nodes.title)
    return false;

  if (dispatch) {
    const tr = state.tr;
    dispatch(tr.setSelection(bodyStart(tr)).scrollIntoView());
  }

  return true;
};

const enterInSection: Command = (state, dispatch) => {
  const $cursor = caret(state);

  if ($cursor?.parent.type !== nodes.section) return false;

  if (dispatch) {
    const tr = state.tr;
    const pos = $cursor.before();
    const heading = $cursor.parent;

    if ($cursor.parentOffset === heading.content.size) {
      const at = emptyLineBeside(tr, pos, "after");
      tr.setSelection(TextSelection.create(tr.doc, at));
    } else if ($cursor.parentOffset === 0) {
      emptyLineBeside(tr, pos, "before");
    } else {
      tr.split($cursor.pos, 1, [
        { type: nodes.section, attrs: { level: heading.attrs.level } },
      ]);
    }

    dispatch(tr.scrollIntoView());
  }

  return true;
};

/** Enter on the empty last line of a code block leaves it. */
const exitCodeBlock: Command = (state, dispatch) => {
  const $cursor = caret(state);

  if (!$cursor || $cursor.parent.type !== nodes.code_block) return false;
  const text = $cursor.parent.textContent;

  if ($cursor.parentOffset !== text.length || !text.endsWith("\n"))
    return false;

  if (dispatch) {
    const tr = state.tr.delete($cursor.pos - 1, $cursor.pos);
    const after = tr.mapping.map($cursor.after());
    tr.insert(after, nodes.paragraph.create());
    dispatch(
      tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView(),
    );
  }

  return true;
};

/** "```lang" and Enter starts a code block. */
const enterCodeFence: Command = (state, dispatch) => {
  const $cursor = caret(state);

  if ($cursor?.parent.type !== nodes.paragraph) return false;
  const match = /^```([\w+-]*)$/.exec($cursor.parent.textContent);

  if (!match || $cursor.parentOffset !== $cursor.parent.content.size)
    return false;

  if (dispatch) {
    const tr = state.tr.delete($cursor.start(), $cursor.end());
    tr.setBlockType($cursor.start(), $cursor.start(), nodes.code_block, {
      lang: match[1] || null,
      markup: "`",
    });
    dispatch(tr.scrollIntoView());
  }

  return true;
};

/** An empty line directly in a container stays a line: no lifting out. */
const liftEmptyNested: Command = (state, dispatch) => {
  const $cursor = caret(state);

  if (!$cursor || $cursor.parent.content.size || $cursor.depth <= 2)
    return false;

  return lift(state, dispatch);
};

export const enter: Command = chainCommands(
  enterInTitle,
  enterInSection,
  exitCodeBlock,
  newlineInCode,
  enterCodeFence,
  splitListItem(nodes.list_item),
  liftEmptyNested,
  splitBlock,
);

/** Select a solid node and say so; the caret leaves the text. */
const selectSolid = (tr: Transaction, pos: number) =>
  tr.setSelection(NodeSelection.create(tr.doc, pos));

/** Backspace on a selected rich block deletes it; the caret goes to the
 * line that took its place. */
export const deleteSelectedBlock: Command = (state, dispatch) => {
  const { selection } = state;

  if (!(selection instanceof NodeSelection) || !isSolid(selection.node))
    return false;

  if (dispatch) {
    const tr = state.tr.deleteSelection();
    const $at = tr.doc.resolve(tr.mapping.map(selection.from));
    dispatch(
      tr
        .setSelection(
          Selection.findFrom($at, 1, true) ??
            Selection.findFrom($at, -1, true) ??
            tr.selection,
        )
        .scrollIntoView(),
    );
  }

  return true;
};

export const backspaceAtLineStart: Command = (state, dispatch) => {
  const $cursor = caret(state);

  if (!$cursor || $cursor.parentOffset !== 0) return false;
  const line = $cursor.parent;
  const tr = state.tr;

  if (line.type === nodes.title) return true;

  if (line.type === nodes.section) {
    sectionToParagraph(tr, $cursor.before());
    dispatch?.(tr.scrollIntoView());

    return true;
  }

  if (
    line.type === nodes.heading ||
    (line.type === nodes.code_block && !line.content.size)
  )
    return setBlockType(nodes.paragraph)(state, dispatch);

  const parent = $cursor.node(-1);

  if (parent.type === nodes.list_item && $cursor.index(-1) === 0)
    return liftListItem(nodes.list_item)(state, dispatch);

  if (parent.type === nodes.blockquote && $cursor.index(-1) === 0)
    return lift(state, dispatch);

  const before = lineBefore(state.doc, $cursor.before() + 1);

  if (!before) return true;

  if (isSolid(before.node)) {
    dispatch?.(selectSolid(tr, before.pos).scrollIntoView());

    return true;
  }

  // The body never joins into the board's title: an empty first line goes
  // away, and the caret moves up.
  if (before.node.type === nodes.title) {
    if (!line.content.size && line.type === nodes.paragraph)
      deleteLine(tr, $cursor);
    tr.setSelection(
      TextSelection.create(tr.doc, before.pos + before.node.nodeSize - 1),
    );
    dispatch?.(tr.scrollIntoView());

    return true;
  }

  if (!joinLines(tr, before.pos + before.node.nodeSize - 1, $cursor.pos))
    return false;
  dispatch?.(tr.scrollIntoView());

  return true;
};

export const deleteAtLineEnd: Command = (state, dispatch) => {
  const $cursor = caret(state);

  if (!$cursor || $cursor.parentOffset !== $cursor.parent.content.size)
    return false;

  if ($cursor.parent.type === nodes.title) return true;
  const after = lineAfter(state.doc, $cursor.after() - 1);

  if (!after) return true;
  const tr = state.tr;

  if (isSolid(after.node)) {
    dispatch?.(selectSolid(tr, after.pos).scrollIntoView());

    return true;
  }

  if (!joinLines(tr, $cursor.pos, after.pos + 1)) return false;
  dispatch?.(tr.scrollIntoView());

  return true;
};

/** With a rich block selected, a key that would type moves the caret to
 * the line after it first, so the block is never typed over. */
export function leaveSelectedBlock(state: EditorState): Transaction | null {
  const { selection } = state;

  if (!(selection instanceof NodeSelection) || !isSolid(selection.node))
    return null;
  const $after = state.doc.resolve(selection.to);
  const next = Selection.findFrom($after, 1, true);

  if (next) return state.tr.setSelection(next);

  const tr = state.tr.insert(
    selection.to,
    nodes.markdown.create(null, nodes.paragraph.create()),
  );

  return tr.setSelection(TextSelection.create(tr.doc, selection.to + 2));
}

/**
 * Esc steps out of editing one level at a time: a selected block or a
 * selection of text first collapses to a caret, then the caret leaves the
 * board. Leaving blurs the editor, which saves now and lets go of the
 * block, and hands focus to the page around it so shortcuts keep working
 * and typing lands nowhere. An open popover keeps its own Esc.
 */
export const leaveEditing: Command = (state, dispatch, view) => {
  const { selection } = state;

  if (selection instanceof NodeSelection) {
    dispatch?.(
      state.tr.setSelection(Selection.near(state.doc.resolve(selection.to))),
    );

    return true;
  }

  if (!selection.empty) {
    dispatch?.(
      state.tr.setSelection(TextSelection.create(state.doc, selection.head)),
    );

    return true;
  }

  if (!view || view.dom.ownerDocument.querySelector(":popover-open"))
    return false;

  if (dispatch) {
    const page = view.dom.parentElement?.closest<HTMLElement>("[tabindex]");

    if (page) page.focus({ preventScroll: true });
    else view.dom.blur();
    // No caret is left in the page to type at.
    view.dom.ownerDocument.getSelection()?.removeAllRanges();
  }

  return true;
};
