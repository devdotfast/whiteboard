import { documentStyles as doc } from "@canvas/document-styles";
import { documentType } from "@canvas/document-type.stylex";
import { drawStyles } from "@canvas/draw-styles";
import { documentNodeMarker, proseMarker } from "@canvas/markers.stylex";
import { fontWeight, leading, space } from "@canvas/scale.stylex";
import type { StyleArg } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import { boardLink, traceQuoteLink } from "@review/review-api/document";
import * as stylex from "@stylexjs/stylex";
import {
  type DOMOutputSpec,
  type Mark,
  type Node,
  Schema,
} from "@tiptap/pm/model";

// One ProseMirror document per board. Our block JSON stays the stored
// format; this document is a view of it that edits like one continuous
// Markdown file.
//
//   doc       title block*
//   section   inline text: a section's title, `level` its depth (1 = top)
//   markdown  md+: one Markdown block, its paragraphs, lists, quotes, code
//   atom      a rich block (diagram, peek, lens, …): selected and deleted
//             whole, never edited inside
//
// Sections hold no children here: a section's content is everything after
// its heading up to the next heading at its depth or above, and nesting is
// derived again on save. A block loaded after a section's end, not inside
// it, keeps the depth it was at in `depth`. Inside a markdown container,
// nodes mirror mdast. `markup` attrs record source syntax mdast drops
// (bullet char, fence, …), so an unchanged block serializes back
// byte-identical.

const className = (...styles: StyleArg[]) =>
  stylex.props(...styles).className ?? "";

const block = className(drawStyles.blockChild);

const paragraph = className(doc.paragraph, drawStyles.blockChild);

const column = className(doc.column, drawStyles.blockChild);

// Every heading, a section's or one in a Markdown block, looks the same at
// its level.
const headingStyles = stylex.create({
  heading: {
    position: "relative",
    scrollMarginTop: "24px",
    width: `min(100%, ${tokens.reviewProseMaxWidth})`,
    maxWidth: `calc(100cqi - 2 * ${tokens.reviewDocumentPaddingInline})`,
    marginInline: "auto",
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
  },
  level1: {
    marginBlock: `${space.s40} ${space.s12}`,
    fontSize: documentType.h2,
    fontWeight: fontWeight.medium,
    lineHeight: leading.px32,
  },
  level2: {
    marginBlock: `${space.s32} ${space.s10}`,
    fontSize: documentType.h3,
    fontWeight: fontWeight.medium,
    lineHeight: leading.px28,
  },
  level3: {
    marginBlock: `${space.s24} ${space.s8}`,
    fontSize: documentType.body,
    fontWeight: fontWeight.semibold,
    lineHeight: leading.px26,
  },
});

const heading = [
  className(headingStyles.heading, headingStyles.level1, drawStyles.blockChild),
  className(headingStyles.heading, headingStyles.level2, drawStyles.blockChild),
  className(headingStyles.heading, headingStyles.level3, drawStyles.blockChild),
];

/** The visual level (1–3) of a section, or of a Markdown heading at `depth`:
 * `##` in a Markdown block reads as a top-level section title does. */
export const markdownHeadingLevel = (depth: number) =>
  Math.min(3, Math.max(1, depth - 1));

export const headingClass = (level: number) =>
  `${heading[Math.min(3, level) - 1]} review-board-h${Math.min(3, level)}`;

/** Where a link points on the page: a board or a trace by its anchor, as
 * the read-only page writes them; anything else as written. */
function shownHref(href: string) {
  const trace = traceQuoteLink(href);
  const board = boardLink(href);

  if (trace) return `#trace-${trace.traceId}`;

  return board ? `#board-${board.board}` : href;
}

/** Blank lines before a node in its Markdown source, when not the default. */
const gap = { gap: { default: null } };

// A cell's column alignment, and the spans prosemirror-tables reads: a GFM
// cell always spans one row and one column.
const cellAttrs = {
  align: { default: null },
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null },
};

const cellAlign = (dom: HTMLElement) => ({
  align: dom.style.textAlign || null,
});

const cellDOM = (node: Node, cls: string) => ({
  class: cls,
  ...(node.attrs.align && { style: `text-align: ${node.attrs.align}` }),
});

export const boardSchema = new Schema({
  nodes: {
    doc: { content: "title block*" },
    text: { group: "inline" },
    title: {
      content: "text*",
      marks: "",
      defining: true,
      parseDOM: [{ tag: "h1[data-board-title]" }],
      toDOM: () => ["h1", { "data-board-title": "" }, 0],
    },
    section: {
      group: "block",
      content: "text*",
      marks: "",
      defining: true,
      // `key` names a section not saved yet; the server gives it an id.
      attrs: {
        id: { default: null },
        key: { default: null },
        level: { default: 1 },
      },
      parseDOM: [{ tag: "h2[data-board-section]" }],
      toDOM: (node): DOMOutputSpec => [
        "h2",
        {
          "data-board-section": "",
          "data-review-node-id": node.attrs.id ?? undefined,
          // Selectable for Ask and Copy ref, as a section's title always was.
          "data-review-copy-prose": "",
          class: headingClass(node.attrs.level),
        },
        0,
      ],
    },
    markdown: {
      group: "block",
      content: "md*",
      attrs: {
        id: { default: null },
        key: { default: null },
        depth: { default: null },
      },
      parseDOM: [{ tag: "div[data-board-markdown]" }],
      toDOM: (node): DOMOutputSpec => [
        "div",
        {
          "data-board-markdown": "",
          "data-review-node-id": node.attrs.id ?? undefined,
          "data-review-copy-prose": "",
          class: className(
            documentNodeMarker,
            proseMarker,
            drawStyles.blockChild,
          ),
        },
        0,
      ],
    },
    atom: {
      group: "block",
      atom: true,
      selectable: true,
      draggable: false,
      // `json` is the stored block, verbatim.
      attrs: {
        id: { default: null },
        key: { default: null },
        json: {},
        depth: { default: null },
      },
      toDOM: (node): DOMOutputSpec => [
        "div",
        { "data-review-node-id": node.attrs.id ?? undefined },
      ],
    },

    // Markdown content, mirroring mdast.
    paragraph: {
      group: "md",
      content: "inline*",
      attrs: gap,
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", { class: paragraph }, 0],
    },
    heading: {
      group: "md",
      content: "inline*",
      defining: true,
      attrs: { ...gap, depth: { default: 2 }, setext: { default: false } },
      toDOM: (node): DOMOutputSpec => [
        `h${Math.min(6, node.attrs.depth)}`,
        { class: headingClass(markdownHeadingLevel(node.attrs.depth)) },
        0,
      ],
    },
    blockquote: {
      group: "md",
      content: "md*",
      attrs: gap,
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => [
        "blockquote",
        { class: className(doc.serif, doc.column, drawStyles.blockChild) },
        0,
      ],
    },
    bullet_list: {
      group: "md",
      content: "list_item+",
      attrs: { ...gap, spread: { default: false }, markup: { default: null } },
      parseDOM: [{ tag: "ul" }],
      toDOM: () => ["ul", { class: column }, 0],
    },
    ordered_list: {
      group: "md",
      content: "list_item+",
      attrs: {
        ...gap,
        start: { default: 1 },
        spread: { default: false },
        markup: { default: null },
      },
      parseDOM: [{ tag: "ol" }],
      toDOM: (node): DOMOutputSpec => [
        "ol",
        {
          class: column,
          start: node.attrs.start === 1 ? undefined : node.attrs.start,
        },
        0,
      ],
    },
    list_item: {
      // An item always has a line to type on: an empty one ("-") is an empty
      // paragraph, so lifting or splitting never leaves an item the caret
      // can't be in.
      content: "md+",
      defining: true,
      attrs: { ...gap, spread: { default: false }, checked: { default: null } },
      parseDOM: [{ tag: "li" }],
      toDOM: (node): DOMOutputSpec => [
        "li",
        {
          class: className(doc.item),
          "data-checked":
            node.attrs.checked === null
              ? undefined
              : String(node.attrs.checked),
        },
        0,
      ],
    },
    // A bulleted list of nothing but tasks, `- [ ]` and `- [x]`: its items
    // tick. A task in a numbered or mixed list is a list_item whose
    // `checked` keeps its `[x]`.
    task_list: {
      group: "md",
      content: "task_item+",
      attrs: { ...gap, spread: { default: false }, markup: { default: null } },
      parseDOM: [{ tag: "ul[data-board-tasks]" }],
      toDOM: () => ["ul", { class: column, "data-board-tasks": "" }, 0],
    },
    task_item: {
      content: "md+",
      defining: true,
      attrs: {
        ...gap,
        spread: { default: false },
        checked: { default: false },
      },
      parseDOM: [
        {
          tag: "li[data-checked]",
          getAttrs: (dom) => ({
            checked: dom.getAttribute("data-checked") === "true",
          }),
        },
      ],
      toDOM: (node): DOMOutputSpec => [
        "li",
        {
          class: `${className(doc.item)} review-board-task`,
          "data-checked": String(node.attrs.checked),
        },
        0,
      ],
    },
    // A GFM table. A cell holds one line of inline text and knows its
    // column's alignment; `markup` records whether the source padded its
    // cells and lined up its pipes. The first row is the header.
    table: {
      group: "md",
      content: "table_row+",
      tableRole: "table",
      isolating: true,
      attrs: { ...gap, markup: { default: null } },
      parseDOM: [{ tag: "table" }],
      toDOM: (): DOMOutputSpec => [
        "table",
        {
          class: `${className(doc.table, drawStyles.blockChild)} review-board-table`,
        },
        ["tbody", 0],
      ],
    },
    table_row: {
      content: "(table_header | table_cell)+",
      tableRole: "row",
      parseDOM: [{ tag: "tr" }],
      toDOM: () => ["tr", 0],
    },
    table_header: {
      content: "paragraph",
      tableRole: "header_cell",
      isolating: true,
      attrs: cellAttrs,
      parseDOM: [{ tag: "th", getAttrs: cellAlign }],
      toDOM: (node): DOMOutputSpec => [
        "th",
        cellDOM(node, className(doc.cell, doc.headerCell)),
        0,
      ],
    },
    table_cell: {
      content: "paragraph",
      tableRole: "cell",
      isolating: true,
      attrs: cellAttrs,
      parseDOM: [{ tag: "td", getAttrs: cellAlign }],
      toDOM: (node): DOMOutputSpec => [
        "td",
        cellDOM(node, className(doc.cell)),
        0,
      ],
    },
    code_block: {
      group: "md",
      content: "text*",
      code: true,
      marks: "",
      defining: true,
      attrs: {
        ...gap,
        lang: { default: null },
        meta: { default: null },
        markup: { default: null },
      },
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
      toDOM: () => [
        "pre",
        { class: `${column} review-board-code` },
        ["code", { "data-review-copy-prose": "" }, 0],
      ],
    },
    thematic_break: {
      group: "md",
      atom: true,
      attrs: { ...gap, markup: { default: null } },
      parseDOM: [{ tag: "hr" }],
      toDOM: () => ["hr", { class: block }],
    },
    // Display math, HTML, definitions, footnotes: kept as their source.
    md_raw: {
      group: "md",
      atom: true,
      attrs: { ...gap, kind: { default: null }, source: { default: "" } },
      toDOM: (node): DOMOutputSpec => [
        "pre",
        { class: paragraph },
        node.attrs.source,
      ],
    },

    // Inline.
    hard_break: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: false,
      attrs: { markup: { default: "\\" } },
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"],
    },
    // Inline math, images, HTML, footnote references: kept as their source.
    inline_raw: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { kind: { default: null }, source: { default: "" } },
      toDOM: (node): DOMOutputSpec => [
        "span",
        { "data-inline-raw": node.attrs.kind },
        node.attrs.source,
      ],
    },
  },
  marks: {
    link: {
      attrs: {
        href: {},
        title: { default: null },
        // How the source wrote it: inline `[x](u)`, `<u>`, a bare URL, or a
        // reference.
        style: { default: "inline" },
        // `[**x**](u)` rather than `**[x](u)**`.
        outer: { default: false },
        reference: { default: null },
      },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom) => ({
            href: dom.getAttribute("data-href") ?? dom.getAttribute("href"),
          }),
        },
      ],
      toDOM: (mark: Mark): DOMOutputSpec => [
        "a",
        {
          href: shownHref(mark.attrs.href),
          "data-href": mark.attrs.href,
          title: mark.attrs.title,
          class: className(doc.link),
        },
        0,
      ],
    },
    em: {
      attrs: { markup: { default: "*" } },
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM: () => ["em", 0],
    },
    strong: {
      attrs: { markup: { default: "*" } },
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0],
    },
    strike: {
      attrs: { markup: { default: "~~" } },
      parseDOM: [{ tag: "s" }, { tag: "del" }],
      toDOM: () => ["del", 0],
    },
    code: {
      attrs: { markup: { default: null } },
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", { class: className(doc.code) }, 0],
    },
  },
});

export const nodes = boardSchema.nodes;

/** A top-level node that stands for a stored block. */
export const isBlockNode = (node: Node) =>
  node.type === nodes.section ||
  node.type === nodes.markdown ||
  node.type === nodes.atom;
