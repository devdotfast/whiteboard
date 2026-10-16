import { type MarkdownNode, parseMarkdown } from "@review/markdown";
import type { Fragment, Mark, Node as PMNode, Schema } from "@tiptap/pm/model";
import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";
import {
  type Handle,
  type Info,
  type Options,
  type State,
  defaultHandlers,
  toMarkdown,
} from "mdast-util-to-markdown";

import { boardSchema } from "./schema";

// mdast <-> ProseMirror. Parsing uses the app's
// parseMarkdown, so math and `review-source:` / `whiteboard:` links read the
// same way they render. Serializing goes back through mdast and
// mdast-util-to-markdown, with handlers that honor the source syntax recorded
// in `markup` attrs.

/** An inline code span's source fence and padding. */
interface CodeMarkup {
  fence: string;
  pad: string;
}

/** A list's source marker, numbering and indent. */
interface ListMarkup {
  bullet: string;
  increment: boolean;
  indent: "one" | "tab";
}

/** Source syntax a node was read with, carried to the to-markdown handlers. */
interface MdastData {
  gap?: number | null;
  /** A table's: whether its cells were padded and its pipes lined up. */
  padding?: boolean;
  aligned?: boolean;
  setext?: boolean;
  style?: string;
  markup?: string | CodeMarkup | ListMarkup | null;
}

interface Mdast extends MarkdownNode {
  position?: {
    start: { offset?: number; column?: number };
    end: { offset?: number };
  };
  children?: Mdast[];
  data?: MdastData;
  referenceType?: string;
  meta?: string | null;
  spread?: boolean | null;
}

/** The parent a to-markdown handler is called with. */
type MdastParent = Parameters<Handle>[1];

// ---------------------------------------------------------------------------
// mdast -> ProseMirror

/** A Markdown block's top-level nodes, and the source each was read from. */
export interface ParsedMarkdown {
  nodes: PMNode[];
  slices: string[];
}

export function parseBlockMarkdown(
  source: string,
  schema: Schema = boardSchema,
): ParsedMarkdown {
  const tree: Mdast = parseMarkdown(source);
  const children = tree.children ?? [];
  const nodes = new MdastToPM(source, schema).blocks(children);

  if (!nodes.length)
    return { nodes: [schema.nodes.paragraph!.create()], slices: [""] };

  return {
    nodes,
    slices: children.map((child) =>
      source.slice(child.position!.start.offset, child.position!.end.offset),
    ),
  };
}

export const markdownToFragment = (
  source: string,
  schema: Schema = boardSchema,
) => parseBlockMarkdown(source, schema).nodes;

class MdastToPM {
  constructor(
    private source: string,
    private schema: Schema,
  ) {}

  private slice(node: Mdast) {
    return this.source.slice(
      node.position!.start.offset,
      node.position!.end.offset,
    );
  }

  /** A raw node's source, without the container prefix on later lines. */
  private rawBlock(node: Mdast) {
    const indent = node.position!.start.column! - 1;

    return this.slice(node)
      .split("\n")
      .map((line, index) => (index === 0 ? line : line.slice(indent)))
      .join("\n");
  }

  private at(node: Mdast, offset = 0) {
    return this.source[node.position!.start.offset! + offset];
  }

  /** Blank lines between a node and its previous sibling in the source. */
  private gap(children: Mdast[], index: number) {
    const previous = children[index - 1];

    if (!previous) return null;

    // The blank lines between this node and where the one before it ends:
    // the end of its last content, as a list may end on blank lines of its
    // own, and a quote's `>` alone on a line is blank too.
    const contentEnd = (node: Mdast): number =>
      node.children?.length
        ? contentEnd(node.children.at(-1)!)
        : node.position!.end.offset!;

    const lines = this.source
      .slice(contentEnd(previous), children[index]!.position!.start.offset)
      .split("\n")
      .slice(1, -1);

    return lines.filter((line) => /^[\s>]*$/.test(line)).length;
  }

  blocks(children: Mdast[]): PMNode[] {
    return children.map((child, index) => {
      const node = this.block(child);

      return node.type.create(
        { ...node.attrs, gap: this.gap(children, index) },
        node.content,
        node.marks,
      );
    });
  }

  block(node: Mdast): PMNode {
    const { nodes } = this.schema;

    switch (node.type) {
      case "paragraph":
        return nodes.paragraph!.create(null, this.inlines(node.children, []));
      case "heading":
        return nodes.heading!.create(
          { depth: node.depth, setext: !this.slice(node).startsWith("#") },
          this.inlines(node.children, []),
        );
      case "blockquote":
        return nodes.blockquote!.create(null, this.blocks(node.children!));
      case "list": {
        // A bulleted list of nothing but tasks is a task list, whose items
        // tick; any other list keeps an item's `[x]` as it was.
        const tasks =
          !node.ordered &&
          node.children!.every(
            (item) => item.checked !== null && item.checked !== undefined,
          );

        const items = node.children!.map((item, index) =>
          (tasks ? nodes.task_item! : nodes.list_item!).create(
            {
              spread: item.spread ?? false,
              checked: tasks ? item.checked : (item.checked ?? null),
              gap: this.gap(node.children!, index),
            },
            item.children?.length
              ? this.blocks(item.children)
              : [nodes.paragraph!.create()],
          ),
        );

        // Loose when an item is, or a blank line parts two items, as
        // CommonMark has it. mdast also counts a quote's `>` line after the
        // last item, which would make a list loose for what follows it.
        const spread = items.some(
          (item, index) => item.attrs.spread || (index > 0 && item.attrs.gap),
        );

        if (tasks)
          return nodes.task_list!.create(
            { spread, markup: this.listMarkup(node) },
            items,
          );

        return node.ordered
          ? nodes.ordered_list!.create(
              {
                start: node.start ?? 1,
                spread,
                markup: this.listMarkup(node),
              },
              items,
            )
          : nodes.bullet_list!.create(
              { spread, markup: this.listMarkup(node) },
              items,
            );
      }

      case "code": {
        const fenced = /^[`~]/.test(this.slice(node));

        return nodes.code_block!.create(
          {
            lang: node.lang ?? null,
            meta: node.meta ?? null,
            markup: fenced ? this.at(node) : "indent",
          },
          node.value ? this.schema.text(node.value) : [],
        );
      }

      case "thematicBreak":
        return nodes.thematic_break!.create({ markup: this.slice(node) });
      case "table":
        return this.table(node);
      default:
        // math, html, definition, footnoteDefinition, …
        return nodes.md_raw!.create({
          kind: node.type,
          source: this.rawBlock(node),
        });
    }
  }

  /** A GFM table, every row as wide as its header, as GFM reads it. */
  private table(node: Mdast): PMNode {
    const { nodes } = this.schema;
    const rows = node.children!;
    const width = rows[0]!.children!.length;
    const align = node.align ?? [];
    const lines = this.slice(node).split("\n");
    const padding = /^\|? +\S/.test(lines[0]!.trimStart());

    return nodes.table!.create(
      {
        markup: {
          padding,
          // Lined up: padded cells whose pipes stand in columns. A table
          // without padding is never lined up, even when its cells happen
          // to be as wide as each other.
          aligned:
            padding && lines.every((line) => line.length === lines[0]!.length),
        },
      },
      rows.map((row, index) =>
        nodes.table_row!.create(
          null,
          Array.from({ length: width }, (_, column) =>
            (index === 0 ? nodes.table_header! : nodes.table_cell!).create(
              { align: align[column] ?? null },
              nodes.paragraph!.create(
                null,
                this.inlines(row.children![column]?.children, []),
              ),
            ),
          ),
        ),
      ),
    );
  }

  private listMarkup(list: Mdast) {
    const items = list.children!;
    const first = this.slice(items[0]!);
    const marker = /^(\d*)([-*+.)])( *)/.exec(first)!;
    const second = items[1] && /^\d+/.exec(this.slice(items[1]))?.[0];

    return {
      bullet: marker[2],
      // "1. 1. 1." lists don't count up.
      increment:
        !list.ordered || second === undefined || +second !== +marker[1]!,
      // Space between marker and content; >1 means "tab"-style indent.
      indent: marker[3]!.length > 1 ? "tab" : "one",
    };
  }

  inlines(children: Mdast[] | undefined, marks: readonly Mark[]): PMNode[] {
    return (children ?? []).flatMap((child) => this.inline(child, marks));
  }

  inline(node: Mdast, marks: readonly Mark[]): PMNode[] {
    const { schema } = this;
    const with_ = (mark: Mark) => mark.addToSet(marks);

    switch (node.type) {
      case "text":
        return node.value ? [schema.text(node.value, marks)] : [];
      case "inlineCode": {
        // Fence length and padding: ``` `` `x` `` ``` or `` ` — x — ` ``.
        const source = this.slice(node);
        const fence = /^`+/.exec(source)![0];
        const inner = source.slice(fence.length, -fence.length);
        const pad = inner === node.value ? "" : " ";

        return [
          schema.text(
            node.value!,
            with_(schema.marks.code!.create({ markup: { fence, pad } })),
          ),
        ];
      }

      case "emphasis":
        return this.inlines(
          node.children,
          with_(schema.marks.em!.create({ markup: this.at(node) })),
        );
      case "strong":
        return this.inlines(
          node.children,
          with_(schema.marks.strong!.create({ markup: this.at(node) })),
        );
      case "delete":
        return this.inlines(
          node.children,
          with_(
            schema.marks.strike!.create({
              markup: this.at(node, 1) === "~" ? "~~" : "~",
            }),
          ),
        );
      case "link": {
        const first = this.at(node);

        const style = node.identifier
          ? "reference"
          : first === "<"
            ? "autolink"
            : first === "["
              ? "inline"
              : "literal";

        return this.inlines(
          node.children,
          with_(
            schema.marks.link!.create({
              href: node.url,
              title: node.title ?? null,
              style,
              // `[**x**](url)` rather than `**[x](url)**`.
              outer:
                node.children!.length === 1 &&
                ["strong", "emphasis", "delete"].includes(
                  node.children![0]!.type,
                ),
              reference: node.identifier
                ? {
                    identifier: node.identifier,
                    label: node.label,
                    referenceType: node.referenceType,
                  }
                : null,
            }),
          ),
        );
      }

      case "break":
        return [
          schema.nodes.hard_break!.create({
            markup:
              this.at(node) === "\\"
                ? "\\"
                : this.slice(node).replace(/\n$/, ""),
          }),
        ];
      default:
        // inlineMath, image, html, footnoteReference, linkReference, …
        return [
          schema.nodes.inline_raw!.create(
            { kind: node.type, source: this.slice(node) },
            undefined,
            marks,
          ),
        ];
    }
  }
}

// ---------------------------------------------------------------------------
// ProseMirror -> mdast

export function fragmentToMdast(content: Fragment): Mdast {
  return { type: "root", children: blocksToMdast(content) };
}

/** A paragraph of nothing but whitespace text, marked or not. */
export const isBlankParagraph = (node: PMNode) => {
  let blank = node.type.name === "paragraph";

  node.forEach((child) => {
    if (!child.isText || child.text!.trim()) blank = false;
  });

  return blank;
};

function blocksToMdast(content: Fragment): Mdast[] {
  const out: Mdast[] = [];
  content.forEach((child) => {
    // Markdown can't hold an empty paragraph, or one of only whitespace,
    // which it trims away; the editor can, until saved.
    if (!isBlankParagraph(child)) out.push(blockToMdast(child));
  });

  return out;
}

function blockToMdast(node: PMNode): Mdast {
  const mdast = blockToMdastBare(node);
  mdast.data = { ...mdast.data, gap: node.attrs.gap };

  return mdast;
}

function blockToMdastBare(node: PMNode): Mdast {
  const a = node.attrs;

  switch (node.type.name) {
    case "paragraph":
      return { type: "paragraph", children: inlinesToMdast(node) };
    case "heading":
      return {
        type: "heading",
        depth: a.depth,
        children: inlinesToMdast(node),
        data: { setext: a.setext },
      };
    case "blockquote":
      return { type: "blockquote", children: blocksToMdast(node.content) };
    case "bullet_list":
    case "ordered_list":
    case "task_list": {
      const children: Mdast[] = [];
      node.forEach((item) =>
        children.push({
          type: "listItem",
          data: { gap: item.attrs.gap },
          spread: item.attrs.spread,
          checked: item.attrs.checked,
          children: blocksToMdast(item.content),
        }),
      );

      return {
        type: "list",
        ordered: node.type.name === "ordered_list",
        start: node.type.name === "ordered_list" ? a.start : null,
        spread: a.spread,
        children,
        data: { markup: a.markup },
      };
    }

    case "code_block":
      return {
        type: "code",
        lang: a.lang,
        meta: a.meta,
        value: node.textContent,
        data: { markup: a.markup },
      };
    case "thematic_break":
      return { type: "thematicBreak", data: { markup: a.markup } };
    case "table": {
      const rows: Mdast[] = [];
      const align: (string | null)[] = [];

      node.forEach((row, _offset, index) => {
        const cells: Mdast[] = [];

        row.forEach((cell) => {
          if (index === 0) align.push(cell.attrs.align);
          cells.push({
            type: "tableCell",
            children: inlinesToMdast(cell.firstChild!, true),
          });
        });
        rows.push({ type: "tableRow", children: cells });
      });

      return {
        type: "table",
        align,
        children: rows,
        data: { padding: a.markup?.padding, aligned: a.markup?.aligned },
      };
    }

    case "md_raw":
      return { type: "raw", value: a.source };
    default:
      throw new Error(`No mdast for ${node.type.name}`);
  }
}

/** A leaf of inline content: text or an inline atom, with its marks. */
type Leaf = { node: Mdast; marks: readonly Mark[] };

/** `inCell`: a table cell is one line, so a line break in it is a space. */
function inlinesToMdast(block: PMNode, inCell = false): Mdast[] {
  const leaves: Leaf[] = [];

  block.forEach((child) => {
    const code = child.marks.find((mark) => mark.type.name === "code");

    const marks = child.marks.filter((mark) => mark !== code);
    let node: Mdast;

    if (child.isText)
      node = code
        ? {
            type: "inlineCode",
            value: child.text!,
            data: { markup: code.attrs.markup },
          }
        : { type: "text", value: child.text! };
    else if (child.type.name === "hard_break")
      node = inCell
        ? { type: "text", value: " " }
        : { type: "break", data: { markup: child.attrs.markup } };
    else node = { type: "raw", value: child.attrs.source };

    // Adjacent plain text merges, as mdast would have it, and so does
    // adjacent code: two spans side by side would read as one.
    const previous = leaves.at(-1);

    if (
      (node.type === "text" || node.type === "inlineCode") &&
      previous?.node.type === node.type &&
      sameMarks(previous.marks, marks)
    )
      previous.node.value += node.value!;
    else leaves.push({ node, marks });
  });

  // Markdown drops whitespace at a paragraph's edges (to-markdown would keep
  // it as `&#x20;`); so do we, marked or not, down to the first text that
  // isn't only whitespace. Enter after a space leaves one there.
  // A line break there is no break either: it would read as a backslash.
  const trim = (at: () => Leaf | undefined, edge: RegExp) => {
    let leaf = at();

    while (leaf?.node.type === "text" || leaf?.node.type === "break") {
      if (leaf.node.type === "text") {
        leaf.node.value = leaf.node.value!.replace(edge, "");

        if (leaf.node.value) break;
      }

      leaves.splice(leaves.indexOf(leaf), 1);
      leaf = at();
    }
  };

  trim(() => leaves[0], /^[ \t]+/);
  trim(() => leaves.at(-1), /[ \t]+$/);

  // So does whitespace on either side of a line break: a line's ends.
  for (const leaf of [...leaves])
    if (leaf.node.type === "break" && leaves.includes(leaf)) {
      const beside = (step: number) => () => {
        const next = leaves[leaves.indexOf(leaf) + step];

        return next?.node.type === "text" ? next : undefined;
      };

      trim(beside(-1), /[ \t]+$/);
      trim(beside(1), /^[ \t]+/);
    }

  // A `###` heading is one line: a line break in it is a space, or nothing
  // right after one.
  if (block.type.name === "heading" && block.attrs.depth > 2)
    for (let index = 0; index < leaves.length; index++) {
      if (leaves[index]!.node.type !== "break") continue;
      const before = leaves[index - 1]?.node;

      if (before?.type === "text" && /[ \t]$/.test(before.value!))
        leaves.splice(index--, 1);
      else leaves[index] = { node: { type: "text", value: " " }, marks: [] };
    }

  return nest(leaves, 0);
}

const sameMarks = (a: readonly Mark[], b: readonly Mark[]) =>
  a.length === b.length && a.every((mark) => inSet(mark, b));

/** Whether `mark` is one of `marks`. Emphasis, strong and strike written
 * with different delimiters are one run: side by side they would merge
 * into one delimiter run anyway (`~~a~~~b~`), and the run must nest the
 * same however it was written. */
const inSet = (mark: Mark, marks: readonly Mark[]) =>
  marks.some(
    (other) =>
      other.eq(mark) ||
      (other.type === mark.type &&
        ["em", "strong", "strike"].includes(mark.type.name)),
  );

/** Rebuild mark nesting: the mark spanning the longest run wraps outermost. */
function nest(leaves: Leaf[], depth: number, open: Mark[] = []): Mdast[] {
  const out: Mdast[] = [];
  let i = 0;

  while (i < leaves.length) {
    const pending = leaves[i]!.marks.filter((mark) => !inSet(mark, open));

    if (!pending.length) {
      out.push(leaves[i]!.node);
      i++;
      continue;
    }

    const runEnd = (mark: Mark) => {
      let end = i;

      while (end < leaves.length && inSet(mark, leaves[end]!.marks)) end++;

      return end;
    };

    // Longest run outermost. On a tie a link that wrapped its marks goes
    // outside them, and one they wrapped inside.
    const rank = (mark: Mark) =>
      runEnd(mark) * 4 +
      (mark.type.name !== "link" ? 1 : mark.attrs.outer ? 2 : 0);

    const outer = pending.reduce((best, mark) =>
      rank(mark) > rank(best) ? mark : best,
    );

    const end = runEnd(outer);
    out.push(
      markToMdast(
        outer,
        nest(leaves.slice(i, end), depth + 1, [...open, outer]),
      ),
    );
    i = end;
  }

  return out;
}

function markToMdast(mark: Mark, children: Mdast[]): Mdast {
  const a = mark.attrs;

  switch (mark.type.name) {
    case "em":
      return { type: "emphasis", children, data: { markup: a.markup } };
    case "strong":
      return { type: "strong", children, data: { markup: a.markup } };
    case "strike":
      return { type: "delete", children, data: { markup: a.markup } };
    case "link":
      return a.reference
        ? { type: "linkReference", children, ...a.reference }
        : {
            type: "link",
            url: a.href,
            title: a.title,
            children,
            data: { style: a.style },
          };
    default:
      throw new Error(`No mdast for mark ${mark.type.name}`);
  }
}

// ---------------------------------------------------------------------------
// mdast -> markdown

/** Run a default handler (and its peek) with options swapped in for this node. */
function withOptions(
  name: keyof typeof defaultHandlers,
  options: (node: Mdast) => Options,
) {
  const wrap =
    (handle: Handle) =>
    (node: Mdast, parent: MdastParent, state: State, info: Info) => {
      const saved = { ...state.options };
      Object.assign(state.options, options(node));

      try {
        return handle(node, parent, state, info);
      } finally {
        Object.assign(state.options, saved);
      }
    };

  const handle: Handle & { peek?: Handle } = defaultHandlers[name];

  return Object.assign(wrap(handle), {
    peek: handle.peek && wrap(handle.peek),
  });
}

/** The delimiter a node was written with, or nothing for a new node. */
const delimiter = <Delimiter extends string>(node: Mdast) =>
  // SAFETY: emphasis, strong and code nodes record the delimiter character
  // they were parsed with (or "indent"), as markToMdast/blockToMdast copy it.
  node.data?.markup as Delimiter | null | undefined;

const defaultInlineCode: Handle = defaultHandlers.inlineCode;

const defaultText: Handle = defaultHandlers.text;

// SAFETY: mdast-util-gfm's to-markdown extensions include strikethrough,
// which handles `delete`.
const defaultDelete = gfmToMarkdown().extensions!.find(
  (extension) => extension.handlers?.delete,
)!.handlers!.delete as Handle;

/** micromark's kind of character: whitespace (or the line's edge),
 * punctuation, or neither. */
const characterKind = (code: number) =>
  Number.isNaN(code) || /\s/.test(String.fromCharCode(code))
    ? "whitespace"
    : /[\p{P}\p{S}]/u.test(String.fromCharCode(code))
      ? "punctuation"
      : "other";

/** Which characters beside a `~~` delimiter must be written as character
 * references for it to open or close: the one inside it, the one outside,
 * as mdast-util-to-markdown works it out for `*`. */
function attentionEncoding(outside: number, inside: number) {
  const out = characterKind(outside);
  const into = characterKind(inside);

  if (into !== "whitespace")
    return {
      inside: false,
      outside: out === "other" && into === "punctuation",
    };

  return { inside: true, outside: out !== "punctuation" };
}

const reference = (code: number) => `&#x${code.toString(16).toUpperCase()};`;

/** Struck text whose edges, or the characters beside it, would keep its
 * `~~` from opening or closing, written as character references, as
 * mdast-util-to-markdown does for emphasis. */
const struck: Handle & { peek: Handle } = Object.assign(
  (...[node, parent, state, info]: Parameters<Handle>) => {
    const written = defaultDelete(node, parent, state, info);
    const marker = /^~+/.exec(written)![0];
    let between = written.slice(marker.length, -marker.length);

    const open = attentionEncoding(
      info.before.charCodeAt(info.before.length - 1),
      between.charCodeAt(0),
    );

    if (open.inside)
      between = reference(between.charCodeAt(0)) + between.slice(1);

    const close = attentionEncoding(
      info.after.charCodeAt(0),
      between.charCodeAt(between.length - 1),
    );

    if (close.inside)
      between =
        between.slice(0, -1) +
        reference(between.charCodeAt(between.length - 1));

    state.attentionEncodeSurroundingInfo = {
      before: open.outside,
      after: close.outside,
    };

    return marker + between + marker;
  },
  // Peeking writes nothing: a full write would leave its encoding behind.
  { peek: () => "~" },
);

/**
 * Emphasis or strong in the delimiter it was written with, unless the
 * emphasis or strong right before it ends in the same character, as when
 * `_a_` meets `__b__`: the delimiters would merge into `___`.
 */
function attentionMarker(node: Mdast, parent: MdastParent): "*" | "_" {
  // SAFETY: phrasing siblings here came from inlinesToMdast.
  const siblings = (parent?.children ?? []) as Mdast[];
  const previous = siblings[siblings.indexOf(node) - 1];
  const own = delimiter<"*" | "_">(node) ?? "*";

  if (!previous || !["emphasis", "strong"].includes(previous.type)) return own;

  return attentionMarker(previous, parent) === own
    ? own === "*"
      ? "_"
      : "*"
    : own;
}

function attention(name: "emphasis" | "strong") {
  const write = (node: Mdast, parent: MdastParent) =>
    withOptions(name, () => ({ [name]: attentionMarker(node, parent) }));

  // SAFETY: to-markdown calls this handler for the emphasis and strong
  // nodes inlinesToMdast built, which are Mdast.
  const handle: Handle & { peek?: Handle } = (node, parent, state, info) =>
    write(node as Mdast, parent)(node as Mdast, parent, state, info);

  // SAFETY: as above.
  handle.peek = (node, parent, state, info) =>
    write(node as Mdast, parent).peek!(node as Mdast, parent, state, info);

  return handle;
}

/** `\(` and `\)` escapes as character references: the board reads
 * `\(…\)` as inline math (markdown-latex-math), so a pair of escaped
 * parentheses, CommonMark's way to write them, would turn into math. */
const withoutLatexEscapes = (markdown: string) =>
  markdown.replace(
    /(?<!\\)((?:\\\\)*)\\([()])/g,
    (_, before: string, paren: string) =>
      `${before}&#x${paren === "(" ? "28" : "29"};`,
  );

/**
 * Text, with a backslash right before its last character escaped when
 * emphasis, strong or strike follows it or ends with it: that character
 * may be written as a character reference so the delimiter can open or
 * close (`&#x7A;~~`, `*x&#x9;*`), and a bare backslash before it would
 * then escape its `&`.
 */
const plainText: Handle = (node, parent, state, info) => {
  const written = withoutLatexEscapes(defaultText(node, parent, state, info));
  // SAFETY: phrasing nodes and their siblings here came from
  // inlinesToMdast.
  const siblings = (parent?.children ?? []) as Mdast[];
  // SAFETY: as above.
  const next = siblings[siblings.indexOf(node as Mdast) + 1];
  const attention = ["emphasis", "strong", "delete"];

  // The last character may be written as a reference by the emphasis
  // after the text, or by the one around it when it ends it.
  return (next && attention.includes(next.type)) ||
    (!next && parent && attention.includes(parent.type))
    ? // Before ASCII punctuation the backslash is an escape already.
      written.replace(/(?<!\\)((?:\\\\)*)\\([^!-/:-@[-`{-~])$/u, "$1\\\\$2")
    : written;
};

/** The GFM table extension's handlers, for a table written with its cells
 * padded or not and its pipes lined up or not. */
const tableExtension = (padding: boolean, aligned: boolean) =>
  // SAFETY: mdast-util-gfm's to-markdown extensions include the table's.
  gfmToMarkdown({
    tableCellPadding: padding,
    tablePipeAlign: aligned,
  }).extensions!.find((extension) => extension.handlers?.table)!.handlers!;

const tableHandlers = new Map(
  [true, false].flatMap((padding) =>
    [true, false].map(
      (aligned) =>
        [`${padding}:${aligned}`, tableExtension(padding, aligned)] as const,
    ),
  ),
);

/** A table as its source wrote it: cells padded with a space or not, and
 * pipes lined up or not. A new table is padded and lined up. An untouched
 * table keeps its source; an edited one is written whole, and its
 * delimiter row is written again from the alignment: dashes as wide as
 * the column when lined up, `:` at the side it aligns to, so `|---|` may
 * come back as `| ----- |`. */
const table: Handle = (node, parent, state, info) => {
  // SAFETY: tables reach this handler as blockToMdast built them.
  const data = (node as Mdast).data;

  return tableHandlers.get(`${data?.padding ?? true}:${data?.aligned ?? true}`)!
    .table!(node, parent, state, info);
};

// SAFETY: the table extension's inline code escapes a `|` in a cell.
const inlineCodeInTable = tableExtension(true, true).inlineCode as Handle;

const handlers = {
  raw: (node: Mdast) => node.value!,
  text: plainText,
  delete: struck,
  table,
  inlineCode: Object.assign(
    (node: Mdast, parent: MdastParent, state: State, info: Info) => {
      // In a cell, a `|` must be escaped even inside code.
      if (state.stack.includes("tableCell") && node.value!.includes("|"))
        return inlineCodeInTable(node, parent, state, info);
      // SAFETY: inline code records its code mark's fence and padding.
      const m = node.data?.markup as CodeMarkup | null | undefined;
      const value = node.value!;

      // Keep the source fence and padding while they still delimit the
      // new value: no run of the fence inside, no backtick against it, and
      // no space at both ends that a bare span would strip.
      if (
        m &&
        !value.includes(m.fence) &&
        !value.includes("\n") &&
        // Padding keeps a backtick off the fence; without it, a backtick
        // at an end would join it, and spaces at both ends would be cut.
        (m.pad
          ? /[^ ]/.test(value)
          : !/^`|`$/.test(value) && !/^ .*[^ ].* $/.test(value))
      )
        return m.fence + m.pad + value + m.pad + m.fence;

      return defaultInlineCode(node, parent, state, info);
    },
    { peek: () => "`" },
  ),
  emphasis: attention("emphasis"),
  strong: attention("strong"),
  heading: withOptions("heading", (node) => ({
    setext: Boolean(node.data?.setext),
  })),
  list: withOptions("list", (node) => {
    // A list the source didn't write (new, or pasted) writes `-` and `1.`.
    // SAFETY: a list records the ListMarkup that listMarkup() read, or nothing.
    const m = (node.data?.markup as ListMarkup | null | undefined) ?? {
      bullet: node.ordered ? "." : "-",
      increment: true,
      indent: "one",
    };

    // SAFETY: listMarkup() reads the bullet from `[-*+.)]`: `.`/`)` on an
    // ordered list, `-`/`*`/`+` on a bullet list.
    return node.ordered
      ? {
          bulletOrdered: m.bullet as "." | ")",
          incrementListMarker: m.increment,
          listItemIndent: m.indent,
        }
      : {
          bullet: m.bullet as "-" | "*" | "+",
          listItemIndent: m.indent,
        };
  }),
  code: withOptions("code", (node) => {
    const fence = delimiter<"`" | "~" | "indent">(node);

    return fence === "indent"
      ? { fences: false }
      : { fences: true, fence: fence ?? "`" };
  }),
  thematicBreak: (node: Mdast, parent: MdastParent, state: State) => {
    // SAFETY: a thematic break records its source text.
    const markup = (node.data?.markup as string | null) ?? "---";
    const siblings = parent?.children ?? [];

    // SAFETY: blocks here came from blockToMdast.
    const previous = siblings[siblings.indexOf(node as never) - 1] as
      | Mdast
      | undefined;

    // First in a list item, a break of the item's own marker would make
    // the whole line one break: `- ---`.
    if (!previous && parent?.type === "listItem")
      return state.bulletCurrent === "*" ? "---" : "***";

    // Right under a paragraph's last line, dashes would underline it into a
    // heading; stars still break.
    return previous?.type === "paragraph" &&
      !node.data?.gap &&
      markup.startsWith("-")
      ? "***"
      : markup;
  },
  // SAFETY: a hard break records its source text before the newline.
  break: (node: Mdast) => `${(node.data?.markup as string) ?? "\\"}\n`,
  link: (node: Mdast, parent: MdastParent, state: State, info: Info) => {
    const style = node.data?.style;

    if (style === "literal") return node.children!.map((c) => c.value).join("");

    const write = withOptions("link", () => ({
      resourceLink: style === "inline",
    }));

    // A destination with parentheses goes in `<…>`, where they need no
    // `\(` escape that would read as math.
    if (!/[()]/.test(node.url ?? "") || /[<>\n]/.test(node.url!))
      return write(node, parent, state, info);

    const placeholder = "WHITEBOARDDESTINATION";

    return write({ ...node, url: placeholder }, parent, state, info).replace(
      placeholder,
      `<${node.url!.replace(/\\/g, "\\\\")}>`,
    );
  },
};

/**
 * mdast-util-to-markdown escapes conservatively (`review\_edit`, `\~5`,
 * `\[x]`); agents rarely write those escapes. Drop them, and keep the result
 * only if it parses to the same tree as the conservative output.
 */
const minimalText = (
  node: Mdast,
  parent: MdastParent,
  state: State,
  info: Info,
) =>
  plainText(node, parent, state, info)
    .replace(/(?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu, "_")
    .replace(/(?<![~\\])\\~(?!~)/g, "~")
    .replace(/(?<!\\)\\([[\]])/g, "$1");

/** Also drop `\\*` and `\\_` escapes; kept only when the parse agrees. */
const aggressiveText = (
  node: Mdast,
  parent: MdastParent,
  state: State,
  info: Info,
) => minimalText(node, parent, state, info).replace(/(?<!\\)\\([*_])/g, "$1");

/** Whether a block's last line is one the next line would continue: a
 * paragraph's, or a block kept as source's (a table takes the next line as
 * a row, HTML runs to a blank line), in a quote or list item too. */
const endsInParagraph = (node: Mdast): boolean =>
  ["paragraph", "raw", "table"].includes(node.type) ||
  (["blockquote", "list", "listItem"].includes(node.type) &&
    endsInParagraph(node.children?.at(-1) ?? { type: "root" }));

/** mdast-util-to-markdown writes a character reference for one UTF-16
 * unit, so an emoji beside `*` or `~~` comes out as half a reference and
 * half a surrogate. Write the whole character's. */
const wholeCharacters = (markdown: string) =>
  markdown
    .replace(
      /&#x(D[89AB][0-9A-F]{2});&#x(D[C-F][0-9A-F]{2});/gi,
      (_, high: string, low: string) =>
        `&#x${String.fromCharCode(parseInt(high, 16), parseInt(low, 16))
          .codePointAt(0)!
          .toString(16)
          .toUpperCase()};`,
    )
    .replace(
      /([\uD800-\uDBFF])&#x(D[C-F][0-9A-F]{2});/gi,
      (_, high: string, low: string) =>
        `&#x${String.fromCharCode(high.charCodeAt(0), parseInt(low, 16)).codePointAt(0)!.toString(16).toUpperCase()};`,
    )
    .replace(
      /&#x(D[89AB][0-9A-F]{2});([\uDC00-\uDFFF])/gi,
      (_, high: string, low: string) =>
        `&#x${String.fromCharCode(parseInt(high, 16), low.charCodeAt(0)).codePointAt(0)!.toString(16).toUpperCase()};`,
    );

/** Whether a block right under a line that runs on would continue it. */
const continues = (node: Mdast): boolean =>
  ["paragraph", "raw", "table"].includes(node.type) ||
  (node.type === "heading" &&
    node.depth! < 3 &&
    (Boolean(node.data?.setext) ||
      JSON.stringify(node.children).includes('"type":"break"'))) ||
  (node.type === "list" && !node.children?.[0]?.children?.length);

const serialize = (tree: Mdast, text?: typeof minimalText) =>
  wholeCharacters(
    // SAFETY: the tree holds mdast nodes plus `raw`, which `handlers` writes.
    toMarkdown(tree as never, {
      extensions: [gfmToMarkdown(), mathToMarkdown()],
      handlers: text ? { ...handlers, text } : handlers,
      // Blank lines between siblings as the source had them.
      // SAFETY: every block here came from blockToMdast, so it is an Mdast.
      join: [
        // A paragraph, or a block kept as source (a table, math, HTML), right
        // after a block whose last line runs on would continue it, and two
        // quotes in a row would be one quote: a tight list item takes the
        // blank line it needs.
        // So would an underlined heading's text, and a list whose first
        // item is empty, which can't interrupt a paragraph.
        (left, right) =>
          // SAFETY: blocks here came from blockToMdast.
          (endsInParagraph(left as Mdast) && continues(right as Mdast)) ||
          (left.type === "blockquote" && right.type === "blockquote")
            ? 1
            : undefined,
        // Lists side by side take different markers, so they need no blank
        // line between them; in a quote, one would make the first loose.
        (left, right) =>
          left.type === "list" && right.type === "list" ? 0 : undefined,
        (_left, right) => (right as Mdast).data?.gap,
      ],
    }),
  );

/** Markdown's parsed tree without positions: equal when the syntax agrees. */
export const parsedTree = (markdown: string) =>
  JSON.stringify(parseMarkdown(markdown), (key, value) =>
    key === "position" ? undefined : value,
  );

export function mdastToMarkdown(tree: Mdast): string {
  const conservative = serialize(tree);
  const expected = parsedTree(conservative);

  for (const text of [aggressiveText, minimalText]) {
    const candidate = serialize(tree, text);

    if (candidate === conservative || parsedTree(candidate) === expected)
      return candidate;
  }

  return conservative;
}

export function fragmentToMarkdown(content: Fragment): string {
  return mdastToMarkdown(fragmentToMdast(content));
}
