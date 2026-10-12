import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "@tiptap/pm/inputrules";
import type { MarkType, Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

import { paragraphToSection } from "./commands";
import { boardSchema, nodes } from "./schema";

// Markdown shortcuts as you type: `#`/`##`/`###` start a section, `-`/`*`
// and `1.` a list, `>` a quote, ``` a code block; `**bold**`, `` `code` ``
// and `[text](url)` format in place. ⌘Z right after one restores what was
// typed.

const marks = boardSchema.marks;

/** A line directly in a markdown container, where a section can start. */
export const isTopLine = (state: EditorState, pos: number) => {
  const $pos = state.doc.resolve(pos);

  return (
    $pos.depth === 2 &&
    $pos.parent.type === nodes.paragraph &&
    $pos.node(1).type === nodes.markdown
  );
};

const sectionRule = new InputRule(
  /^(#{1,3})\s$/,
  (state, match, start, end) => {
    if (!isTopLine(state, start)) return null;
    const tr = state.tr.delete(start, end);

    paragraphToSection(tr, tr.doc.resolve(start), match[1]!.length);

    return tr;
  },
);

/** New lists write `-` and `1.`, one space after the marker. */
const listMarkup = (bullet: string) => ({
  bullet,
  increment: true,
  indent: "one",
});

const inlineRule = (
  pattern: RegExp,
  build: (match: RegExpMatchArray) => {
    text: string;
    mark: ReturnType<MarkType["create"]>;
  },
) =>
  new InputRule(pattern, (state, match, start, end) => {
    const { text, mark } = build(match);
    const $start = state.doc.resolve(start);

    if (!$start.parent.type.allowsMarkType(mark.type)) return null;
    const existing = $start.marks();

    return state.tr
      .replaceWith(start, end, boardSchema.text(text, mark.addToSet(existing)))
      .removeStoredMark(mark.type);
  });

export const shortcutRules = [
  sectionRule,
  wrappingInputRule(/^\s*([-*])\s$/, nodes.bullet_list, (match) => ({
    markup: listMarkup(match[1]!),
  })),
  wrappingInputRule(
    /^(\d+)([.)])\s$/,
    nodes.ordered_list,
    (match) => ({ start: Number(match[1]), markup: listMarkup(match[2]!) }),
    (match, node: PMNode) =>
      node.childCount + node.attrs.start === Number(match[1]),
  ),
  wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
  textblockTypeInputRule(/^```([\w+-]*)\s$/, nodes.code_block, (match) => ({
    lang: match[1] || null,
    markup: "`",
  })),
  inlineRule(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, (match) => ({
    text: match[1]!,
    mark: marks.strong.create({ markup: "*" }),
  })),
  inlineRule(/(?<!`)`([^`]+)`$/, (match) => ({
    text: match[1]!,
    mark: marks.code.create({ markup: { fence: "`", pad: "" } }),
  })),
  inlineRule(/\[([^\]]+)\]\(([^()\s]+)\)$/, (match) => ({
    text: match[1]!,
    mark: marks.link.create({ href: match[2], style: "inline" }),
  })),
];

export const shortcuts = () => inputRules({ rules: shortcutRules });
