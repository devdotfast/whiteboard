import type { ApiDocumentData } from "@canvas/api-document";
import { struckLinkStyles } from "@canvas/ui/struck-link";
import { boardLink } from "@dev.fast/whiteboard-document";
import * as stylex from "@stylexjs/stylex";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const unavailableLinkKey = new PluginKey<DecorationSet>(
  "unavailableLinks",
);

const struckAttrs = {
  class: stylex.props(struckLinkStyles.struck).className ?? "",
  "data-unavailable": "board",
};

function strike(
  state: EditorState,
  data: () => ApiDocumentData,
): DecorationSet {
  const { boards } = data();

  if (!boards.values().some((target) => target.missing))
    return DecorationSet.empty;
  const struck: Decoration[] = [];

  state.doc.forEach((block, offset) => {
    block.descendants((node, pos) => {
      if (!node.isText) return;
      const link = node.marks.find((mark) => mark.type.name === "link");
      const board = link && boardLink(link.attrs.href);

      if (!board || !boards.get(`${board.board}#${board.block ?? ""}`)?.missing)
        return;
      const from = offset + 1 + pos;

      struck.push(Decoration.inline(from, from + node.nodeSize, struckAttrs));
    });
  });

  return DecorationSet.create(state.doc, struck);
}

/** Strikes links to gone boards or blocks; set `unavailableLinkKey` meta
 * when targets change. */
export function unavailableLinks(
  data: () => ApiDocumentData,
): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: unavailableLinkKey,
    state: {
      init: (_config, state) => strike(state, data),
      apply: (tr, value, _old, state) =>
        tr.getMeta(unavailableLinkKey) || tr.docChanged
          ? strike(state, data)
          : value.map(tr.mapping, tr.doc),
    },
    props: {
      decorations: (state) => unavailableLinkKey.getState(state),
    },
  });
}
