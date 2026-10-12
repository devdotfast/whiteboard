import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

import { type JsonValue, isJsonObject, isStringValue } from "@dev.fast/json";
import { respellDocumentLinks } from "@review/review-api/document";
import { personDocument } from "@review/review-api/store";
import { readStoredDocument } from "@review/stored-document-migration";
import { type Attrs, Fragment, type Node as PMNode } from "@tiptap/pm/model";
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  type BlockJSON,
  type Board,
  boardToDoc,
  docToBoard,
  markdownOf,
  storedBlocks,
} from "./board-doc";
import fixtures from "./corpus.fixture.json";
import { createBoardState } from "./editor-state";
import { isBlankParagraph, parseBlockMarkdown } from "./markdown";
import { boardSchema, nodes } from "./schema";

// A saved board, reloaded and saved again, changes nothing: not in the
// editor, which would save it again on its own, and not on the server,
// which would store something the editor did not send. Checked for every
// block kind the editor holds, in the committed boards, in boards built
// from every kind at random, and, with BOARD_EDITOR_CORPUS=/path/to/
// review-api.db, every version of every board in a copy of a real store.

/** What the editor saves after opening a board, with nothing typed. */
const reopened = (board: Board) =>
  docToBoard(createBoardState(board).doc, board);

/** What the editor saves once every block has been edited: each written
 * fresh from the editor's document, none kept from its stored source. */
const rewritten = (board: Board) =>
  docToBoard(boardToDoc(board), { title: board.title, document: [] });

/** What the store keeps of a person's save of `document`. */
const stored = (document: BlockJSON[]) =>
  storedBlocks(
    respellDocumentLinks(
      personDocument(
        // SAFETY: a board's blocks are JSON; personDocument mutates its input.
        structuredClone(document) as JsonValue[],
        1_000_000,
      ).document,
    ),
  );

/** Where `after` first differs from `before`, and how. Key order is not a
 * difference: the store compares blocks the same way. */
function difference(before: JsonValue, after: JsonValue, path = ""): string {
  if (isDeepStrictEqual(before, after)) return "";

  if (isJsonObject(before) && isJsonObject(after))
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      const found = difference(before[key]!, after[key]!, `${path}/${key}`);

      if (found) return found;
    }

  if (Array.isArray(before) && Array.isArray(after))
    for (
      let index = 0;
      index < Math.max(before.length, after.length);
      index++
    ) {
      const found = difference(
        before[index]!,
        after[index]!,
        `${path}/${index}`,
      );

      if (found) return found;
    }

  return `${path || "/"}: ${JSON.stringify(before)} became ${JSON.stringify(after)}`;
}

/** What the store keeps of `document`, or why it refuses it. */
function kept(document: BlockJSON[]): JsonValue {
  try {
    return json(stored(document));
  } catch (error) {
    return `refused: ${String(error).slice(0, 300)}`;
  }
}

/** A board or its blocks, to compare. */
// SAFETY: a board is plain JSON.
const json = (value: Board | BlockJSON[]) => value as JsonValue;

/** What saving `board` again would change, as one line per change: none
 * for a board that saves again unchanged. */
function changes(board: Board): string[] {
  const fresh = rewritten(board);

  const compared = {
    // Opened and saved with nothing typed.
    reopened: [json(board), json(reopened(board))],
    // What the store keeps of it.
    stored: [json(board.document), kept(board.document)],
    // Every block written fresh shows as it did...
    "rewritten shows": [boardToDoc(board).toJSON(), boardToDoc(fresh).toJSON()],
    // ...is kept as written, and saves again unchanged.
    "rewritten stored": [json(fresh.document), kept(fresh.document)],
    "rewritten reopened": [json(fresh), json(reopened(fresh))],
    "rewritten again": [json(fresh), json(rewritten(fresh))],
  } satisfies Record<string, [JsonValue, JsonValue]>;

  return Object.entries(compared)
    .map(([name, [before, after]]) => {
      const found = difference(before, after);

      return found && `${name} ${found}`;
    })
    .filter(Boolean);
}

/** Markdown of every kind the editor holds: each mark, link form and
 * block structure. */
const markdown = [
  "Plain text.",
  "*em* _em_ **strong** __strong__ ~~strike~~ `code` ``co`de``",
  "***both*** **_mixed_** *em with `code` inside* **[strong link](https://example.com)**",
  '[inline](https://example.com) [titled](https://example.com "Title") <https://example.com> https://bare.example.com',
  "[ref][a] and [collapsed][] and [shortcut]\n\n[a]: https://example.com/a\n[collapsed]: https://example.com/c\n[shortcut]: https://example.com/s",
  "A [source](whiteboard:source/abc1234/src/a.ts#L1-L3), [head](whiteboard:source/head/src/a.ts#L2), [base](whiteboard:source/base/src/a.ts), a [diff](whiteboard:diff/src/a.ts), a [board](whiteboard:board/11111111-1111-4111-8111-111111111111), a [block](whiteboard:board/11111111-1111-4111-8111-111111111111#block-2) and an [anchor](#heading).",
  "Line one  \nline two\\\nline three",
  "Escapes: \\*not em\\*, 1\\. not a list, \\# not a heading, a\\_b, \\[x\\]",
  "Inline math $x^2$, an image ![alt](https://example.com/i.png), HTML <kbd>⌘K</kbd> and a footnote[^1].\n\n[^1]: The note.",
  "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6",
  "Setext one\n==========\n\nSetext two\n----------",
  "- one\n- two\n  - nested\n    1. ordered\n    2. deeper",
  "* star\n* list\n\n+ plus\n+ list",
  "1. one\n2. two\n\n3) paren\n4) list",
  "- loose\n\n- list\n\n  with a second paragraph",
  "- [ ] task\n- [x] done",
  "> A quote\n> over two lines\n>\n> > nested",
  "```ts\nconst x = 1;\n```",
  "~~~\ntilde fence\n~~~",
  "    indented code\n    block",
  "| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n| `x` | **y** | [z](https://example.com) |",
  "Above\n\n---\n\nBetween\n\n***\n\nBelow",
  "$$\nE = mc^2\n$$",
  "<details>\n<summary>More</summary>\n\nHidden.\n\n</details>",
  "Ünïcödé — 日本語 ‮RTL‬ \"quotes\" 'x' \\ back",
  "Trailing newline.\n",
  "Two\n\n\n\nwide gaps.",
];

/** A stored board as the editor gets it: read the way the store reads it. */
const read = (snapshot: { title: string; document: unknown }): Board => ({
  title: snapshot.title,
  document: storedBlocks(
    // SAFETY: a read document is an array of blocks.
    readStoredDocument(snapshot.document).document as object[],
  ),
});

const fixtureBoards = (fixtures as Board[]).map(read);

/** Every block that isn't Markdown or a section, from the fixtures and
 * one of each kind the fixtures lack. */
const richBlocks: BlockJSON[] = [
  ...fixtureBoards.flatMap((board) =>
    storedBlocks(board.document).filter(
      (block) => block.type !== "markdown" && block.type !== "section",
    ),
  ),
  { type: "divider", id: "block-1" },
  {
    type: "image",
    assetId: "asset-1",
    alt: "A chart",
    caption: "Orders by day",
    id: "block-1",
  },
  {
    type: "trace_quote",
    traceId: "trace-1",
    eventId: "event-1",
    text: "Ran the tests.",
    id: "block-1",
  },
  {
    type: "software_map",
    mapVersionId: "map-1",
    focusElementId: "element-1",
    id: "block-1",
  },
];

/** Numbers from `from` up. */
const counter = (from: number) => () => ++from;

/** The same block with every id in it fresh, so copies stay distinct. */
function renamed(block: BlockJSON, next: () => number): BlockJSON {
  const visit = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(visit);

    if (isJsonObject(value))
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [
          key,
          key === "id" && isStringValue(inner)
            ? `${inner.split("-")[0]}-${next()}`
            : visit(inner),
        ]),
      );

    return value;
  };

  // SAFETY: renaming ids keeps the block's shape.
  return (visit(json([block])) as BlockJSON[])[0]!;
}

/** A board of `count` blocks drawn from every kind, sections nested up to
 * four deep, from a seeded random sequence. */
function generated(seed: number, count: number): Board {
  let state = seed;

  const random = () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;

    return state / 2 ** 31;
  };

  const pick = <T>(list: readonly T[]) =>
    list[Math.floor(random() * list.length)]!;

  let id = 0;
  const next = () => ++id;

  const blocks = (left: { count: number }, depth: number): BlockJSON[] => {
    const list: BlockJSON[] = [];

    while (left.count > 0 && (list.length === 0 || random() > 0.15)) {
      left.count--;
      const roll = random();

      if (roll < 0.15 && depth < 4) {
        list.push({
          id: `block-${next()}`,
          type: "section",
          title: pick(["Why", "Plan", "Risks", "Ünïcödé", "Notes"]),
          children: blocks(left, depth + 1),
        });
      } else if (roll < 0.6) {
        list.push({
          id: `block-${next()}`,
          type: "markdown",
          markdown: [pick(markdown), pick(markdown)].join("\n\n"),
        });
      } else list.push(renamed(pick(richBlocks), next));
    }

    return list;
  };

  const left = { count };
  const document: BlockJSON[] = [];

  while (left.count > 0) document.push(...blocks(left, 1));

  return { title: `Generated ${seed}`, document };
}

describe("a saved board saves again unchanged", () => {
  test.each(fixtureBoards.map((board) => [board.title, board] as const))(
    "%s",
    (_title, board) => expect(changes(board)).toEqual([]),
  );

  test.each(markdown.map((source, index) => [index, source] as const))(
    "Markdown %i",
    (_index, source) =>
      expect(
        changes({
          title: "Markdown",
          document: [{ id: "block-1", type: "markdown", markdown: source }],
        }),
      ).toEqual([]),
  );

  test.each(richBlocks.map((block) => [block.type, block] as const))(
    "%s",
    (_type, block) =>
      expect(
        changes({
          title: "Rich",
          document: [
            {
              id: "block-90",
              type: "section",
              title: "Inside",
              children: [
                renamed(block, counter(100)),
                { id: "block-91", type: "markdown", markdown: "After." },
              ],
            },
          ],
        }),
      ).toEqual([]),
  );

  test("boards built at random from every kind", () => {
    const seeds = Array.from({ length: 40 }, (_, index) => index + 1);

    expect(
      seeds.flatMap((seed) =>
        changes(generated(seed, 30)).map((change) => `${seed}: ${change}`),
      ),
    ).toEqual([]);
  });

  test("a large board", () => {
    expect(changes(generated(2026, 1500))).toEqual([]);
  });
});

const corpus = process.env.BOARD_EDITOR_CORPUS;

test.skipIf(!corpus)(
  "every version in a real store saves again unchanged",
  () => {
    const db = new DatabaseSync(corpus!, { readOnly: true });
    const failed: string[] = [];
    let boards = 0;

    for (const row of db
      .prepare("SELECT review_id, version, snapshot FROM versions")
      .iterate()) {
      boards++;
      failed.push(
        ...changes(read(JSON.parse(String(row.snapshot)))).map(
          (change) =>
            `${String(row.review_id)}@${String(row.version)}: ${change.slice(0, 300)}`,
        ),
      );
    }

    expect(boards).toBeGreaterThan(0);
    expect(failed).toEqual([]);
  },
  600_000,
);

// ---------------------------------------------------------------------------
// Random Markdown content: editor documents built at random, not Markdown
// strings, so every mark nesting and structure the editor can hold is tried.

/** The run is the same every time; a failure prints its seed and the
 * shrunk document. */
const PROPERTY = { seed: 20_261_013, numRuns: 500 } as const;

const tricky = [
  ..."*_`~[]()<>|#\\!\t ",
  "é",
  "日本",
  "😀",
  "a",
  "b",
  "z",
  "1",
  ".",
];

const text = fc
  .array(fc.constantFrom(...tricky), { minLength: 1, maxLength: 8 })
  .map((parts) => parts.join(""));

const hrefs = [
  "https://example.com/a",
  "https://example.com/a b",
  "https://example.com/(x)",
  "https://example.com/<y>",
  "whiteboard:board/11111111-1111-4111-8111-111111111111#block-2",
  "#heading",
  "",
];

const mark = fc.oneof(
  fc
    .constantFrom("*", "_")
    .map((markup) => ({ type: "em", attrs: { markup } })),
  fc
    .constantFrom("*", "_")
    .map((markup) => ({ type: "strong", attrs: { markup } })),
  fc
    .constantFrom("~~", "~")
    .map((markup) => ({ type: "strike", attrs: { markup } })),
  fc.constant({ type: "code", attrs: { markup: null } }),
  fc
    .record({
      href: fc.constantFrom(...hrefs),
      title: fc.constantFrom(null, "Title", 'a "quoted" title', "it's (here)"),
    })
    .map(({ href, title }) => ({
      type: "link",
      attrs: { href, title, style: "inline", outer: false, reference: null },
    })),
);

/** Text with up to three marks, or a hard break between two runs. */
const inline = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      type: fc.constant("text"),
      text,
      marks: fc.uniqueArray(mark, { maxLength: 3, selector: (m) => m.type }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.constant({ type: "hard_break", attrs: { markup: "\\" } }),
  },
);

/** Inline content that starts and ends with text: a break at either edge is
 * no break in Markdown. */
const inlines = fc
  .array(inline, { minLength: 1, maxLength: 6 })
  .filter(
    (content) => content[0]!.type === "text" && content.at(-1)!.type === "text",
  );

const tableCell = fc
  .array(
    fc.constantFrom("a", "b", "1", " ", "\\|", "*x*", "`c`", "é", "\\\\"),
    {
      minLength: 1,
      maxLength: 4,
    },
  )
  .map((parts) => parts.join("").trim() || "x");

/** A GFM table, which the editor keeps as its source. */
const table = fc
  .tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 0, max: 3 }))
  .chain(([columns, rows]) =>
    fc.tuple(
      fc.array(tableCell, { minLength: columns, maxLength: columns }),
      fc.array(fc.constantFrom("---", ":--", ":-:", "--:"), {
        minLength: columns,
        maxLength: columns,
      }),
      fc.array(
        fc.array(tableCell, { minLength: columns, maxLength: columns }),
        {
          maxLength: rows,
        },
      ),
    ),
  )
  .map(([head, align, body]) => ({
    type: "md_raw",
    attrs: {
      kind: "table",
      source: [head, align, ...body]
        .map((row) => `| ${row.join(" | ")} |`)
        .join("\n"),
    },
  }));

const code = fc
  .record({
    lang: fc.constantFrom(null, "ts", "py"),
    markup: fc.constantFrom("`", "~", null),
    text: fc.constantFrom(
      "const x = 1;",
      "```\nfenced inside\n```",
      "~~~ tildes",
      "a `tick` and ``two``",
      "  indented\n\ttabbed",
      "",
    ),
  })
  .map(({ lang, markup, text: value }) => ({
    type: "code_block",
    attrs: { lang, markup },
    ...(value && { content: [{ type: "text", text: value }] }),
  }));

const { block: mdBlock } = fc.letrec<{ block: object; item: object }>(
  (tie) => ({
    block: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      fc.record({ type: fc.constant("paragraph"), content: inlines }),
      fc.record({
        type: fc.constant("heading"),
        attrs: fc.record({ depth: fc.integer({ min: 1, max: 6 }) }),
        content: inlines,
      }),
      code,
      table,
      fc.constant({ type: "thematic_break", attrs: { markup: "---" } }),
      fc.record({
        type: fc.constant("blockquote"),
        content: fc.array(tie("block"), { minLength: 1, maxLength: 3 }),
      }),
      fc.record({
        type: fc.constantFrom("bullet_list", "ordered_list"),
        content: fc.array(tie("item"), { minLength: 1, maxLength: 3 }),
      }),
    ),
    item: fc.record({
      type: fc.constant("list_item"),
      content: fc
        .tuple(
          fc.record({ type: fc.constant("paragraph"), content: inlines }),
          fc.array(tie("block"), { maxLength: 2 }),
        )
        .map(([first, rest]) => [first, ...rest]),
    }),
  }),
);

/** A Markdown container's content, as the editor's document JSON. */
const markdownContent = fc.array(mdBlock, { minLength: 1, maxLength: 5 });

/**
 * Attrs that record how the source wrote a node, not what it is: the
 * delimiter (`markup`), blank lines before it (`gap`), a setext heading,
 * and how a link was spelled (`style`, `outer`, a reference's form). A
 * node made in the editor
 * has none, and reads back with the syntax it was written in; so the first
 * trip compares content with these set aside, and the second trip, from
 * what was read back, compares everything.
 */
const SYNTAX_ATTRS = ["markup", "gap", "setext", "style", "outer"];

/** `attrs` with their source syntax at the schema's defaults. */
function plainAttrs(
  attrs: Attrs,
  spec: Record<string, { default?: unknown }>,
): Attrs {
  return Object.fromEntries(
    Object.entries(attrs).map(([key, value]) => [
      key,
      SYNTAX_ATTRS.includes(key)
        ? spec[key]!.default
        : // A reference link's form, `[x][a]`, `[a][]` or `[a]`, is how it
          // was written; its label is what it means.
          key === "reference" && value
          ? { ...value, referenceType: null }
          : value,
    ]),
  );
}

/** Whether text is code, whose spaces are inside its backticks. */
const isCode = (node: PMNode) =>
  node.marks.some((mark) => mark.type === boardSchema.marks.code);

/** A node as Markdown means it, its source syntax set aside. Also what
 * the editor's Markdown drops: whitespace and line breaks at the edges of a
 * paragraph or heading, and whitespace beside a line break, marked or not
 * (Markdown trims whitespace at a line's ends, keeping it would take a
 * `&#x20;`, and a break at an edge is no break). Code keeps its spaces:
 * they are inside its backticks. */
function meaning(node: PMNode): PMNode {
  if (node.isText)
    return boardSchema.text(
      node.text!,
      node.marks.map((mark) =>
        mark.type.create(plainAttrs(mark.attrs, mark.type.spec.attrs ?? {})),
      ),
    );

  const children: PMNode[] = [];

  // A paragraph of only whitespace is dropped: Markdown trims it away.
  node.forEach((child) => {
    if (!isBlankParagraph(child)) children.push(meaning(child));
  });

  if (node.isTextblock && node.type !== nodes.code_block) {
    const edge = (index: number, trim: (value: string) => string) => {
      const child = children[index];

      if (child?.isText && !isCode(child)) {
        const value = trim(child.text!);

        if (value) children[index] = boardSchema.text(value, child.marks);
        else children.splice(index, 1);
      }
    };

    // Down to the first text that isn't only whitespace; a line break at
    // either edge is no break in Markdown, so it goes too.
    const bare = (child: PMNode | undefined) =>
      child?.type === nodes.hard_break ||
      (child?.isText && !isCode(child) && !child.text!.trim());

    while (bare(children[0])) children.shift();

    while (bare(children.at(-1))) children.pop();

    edge(0, (value) => value.replace(/^[ \t]+/, ""));
    edge(children.length - 1, (value) => value.replace(/[ \t]+$/, ""));

    // So does whitespace beside a line break: a line's ends.
    for (let index = children.length - 1; index >= 0; index--) {
      if (children[index]?.type !== nodes.hard_break) continue;

      while (children[index + 1]?.isText && !isCode(children[index + 1]!)) {
        const value = children[index + 1]!.text!.replace(/^[ \t]+/, "");

        if (value) {
          children[index + 1] = boardSchema.text(
            value,
            children[index + 1]!.marks,
          );
          break;
        }

        children.splice(index + 1, 1);
      }

      while (children[index - 1]?.isText && !isCode(children[index - 1]!)) {
        const value = children[index - 1]!.text!.replace(/[ \t]+$/, "");

        if (value) {
          children[index - 1] = boardSchema.text(
            value,
            children[index - 1]!.marks,
          );
          break;
        }

        children.splice(--index, 1);
      }
    }
  }

  // A `###` heading is one line: a line break in it, its sides trimmed
  // as any line's ends, is a space, or nothing right after one.
  if (node.type === nodes.heading && node.attrs.depth > 2)
    for (let index = 0; index < children.length; index++) {
      if (children[index]!.type !== nodes.hard_break) continue;
      const before = children[index - 1];

      if (before?.isText && !isCode(before) && /[ \t]$/.test(before.text!))
        children.splice(index--, 1);
      else children[index] = boardSchema.text(" ");
    }

  const attrs = { ...plainAttrs(node.attrs, node.type.spec.attrs ?? {}) };

  // Markdown keeps a paragraph, or a block kept as source, apart from a
  // paragraph or source block before it, or a quote or list that ends in
  // one, and a quote from the quote before it, only with a blank line; in
  // a list item that makes the item, and so its list, loose.
  const endsInParagraph = (block: PMNode | undefined): boolean =>
    block?.type === nodes.paragraph ||
    block?.type === nodes.md_raw ||
    (block !== undefined &&
      [
        nodes.blockquote,
        nodes.bullet_list,
        nodes.ordered_list,
        nodes.list_item,
      ].includes(block.type) &&
      endsInParagraph(block.lastChild ?? undefined));

  // A heading with a line break is written underlined, which would
  // otherwise underline the paragraph above into the heading.
  const underlined = (block: PMNode | undefined) =>
    block?.type === nodes.heading &&
    block.attrs.depth <= 2 &&
    block.content.content.some((child) => child.type === nodes.hard_break);

  // A list whose first item is empty can't interrupt a paragraph.
  const emptyFirst = (block: PMNode | undefined) =>
    (block?.type === nodes.bullet_list || block?.type === nodes.ordered_list) &&
    !block.firstChild!.childCount;

  const apart = (left: PMNode, right: PMNode | undefined) =>
    (endsInParagraph(left) &&
      ((right !== undefined &&
        [nodes.paragraph, nodes.md_raw].includes(right.type)) ||
        underlined(right) ||
        emptyFirst(right))) ||
    (left.type === nodes.blockquote && right?.type === nodes.blockquote);

  if (node.type === nodes.list_item)
    attrs.spread =
      node.attrs.spread ||
      children.some((child, index) => apart(child, children[index + 1]));

  // A list is loose when an item is, or a blank line parts two items:
  // the item's own gap when it was read with one, else the list's
  // looseness, which writes its items apart.
  if (node.type === nodes.bullet_list || node.type === nodes.ordered_list)
    attrs.spread =
      children.some((item) => item.attrs.spread) ||
      node.content.content
        .slice(1)
        .some((item) =>
          item.attrs.gap === null ? node.attrs.spread : item.attrs.gap > 0,
        );

  return node.type.create(attrs, Fragment.fromArray(children));
}

/** A Markdown container holding `content`, as the editor would. */
const container = (content: readonly PMNode[]) =>
  nodes.markdown.create(null, content);

/** What a Markdown block's content reads back as once saved and reopened. */
const reread = (content: readonly PMNode[]) =>
  parseBlockMarkdown(markdownOf(container(content))).nodes;

const meant = (content: readonly PMNode[]) =>
  Fragment.fromArray(
    content.flatMap((block) =>
      isBlankParagraph(block) ? [] : [meaning(block)],
    ),
  );

describe("random Markdown content", () => {
  test("reads back as it was written, and then saves again unchanged", () => {
    fc.assert(
      fc.property(markdownContent, (json) => {
        const content = json.map((block) => boardSchema.nodeFromJSON(block));
        const read = reread(content);

        // Written fresh, it means what it meant...
        expect(meant(read).toJSON()).toStrictEqual(meant(content).toJSON());
        expect(meant(read).eq(meant(content))).toBe(true);
        // ...and read back, it saves and reads exactly as it was.
        expect(Fragment.fromArray(reread(read)).toJSON()).toStrictEqual(
          Fragment.fromArray(read).toJSON(),
        );
        expect(
          Fragment.fromArray(reread(read)).eq(Fragment.fromArray(read)),
        ).toBe(true);
        // Saved as a board: one Markdown block, unless it saved as nothing,
        // which the editor never stores as a block.
        const markdown = markdownOf(container(content));

        expect(
          changes({
            title: "Random",
            document: markdown
              ? [{ id: "block-1", type: "markdown", markdown }]
              : [],
          }),
        ).toEqual([]);
      }),
      PROPERTY,
    );
  }, 600_000);
});

// ---------------------------------------------------------------------------
// Partial edits: one top-level child of a Markdown block changed, the rest
// kept as they were written.

/** Markdown blocks of more than one top-level child: the fixtures', and
 * random ones written by the editor. */
const multiBlockSource = fc
  .oneof(
    fc.constantFrom(
      ...fixtureBoards
        .flatMap((board) => storedBlocks(board.document))
        .flatMap(function sources(block): string[] {
          return block.type === "markdown"
            ? [String(block.markdown)]
            : (block.children ?? []).flatMap(sources);
        }),
      ...markdown,
    ),
    markdownContent.map((json) =>
      markdownOf(
        container(json.map((block) => boardSchema.nodeFromJSON(block))),
      ),
    ),
  )
  .filter((source) => parseBlockMarkdown(source).nodes.length > 1);

type Edit = "text" | "mark" | "item" | "split" | "join";

/** `content` with its child at `at` edited, and where each child before
 * the edit is now (undefined for the edited ones). */
function edited(
  content: readonly PMNode[],
  at: number,
  edit: Edit,
  text: readonly PMNode[],
):
  | { content: PMNode[]; moved: (index: number) => number | undefined }
  | undefined {
  const child = content[at]!;
  const next = [...content];
  const same = (index: number) => (index === at ? undefined : index);

  switch (edit) {
    case "text":
      if (!child.isTextblock || child.type === nodes.code_block)
        return undefined;
      next[at] = child.type.create(child.attrs, text);

      return { content: next, moved: same };
    case "mark": {
      if (!child.isTextblock || child.type === nodes.code_block)
        return undefined;
      const em = boardSchema.marks.em!.create({ markup: "*" });
      let marked = true;

      child.forEach((inline) => {
        if (inline.isText && !em.isInSet(inline.marks)) marked = false;
      });

      const toggled: PMNode[] = [];

      child.forEach((inline) =>
        toggled.push(
          inline.isText
            ? inline.mark(
                marked
                  ? em.removeFromSet(inline.marks)
                  : em.addToSet(inline.marks),
              )
            : inline,
        ),
      );
      next[at] = child.type.create(child.attrs, toggled);

      return { content: next, moved: same };
    }

    case "item": {
      if (child.type !== nodes.bullet_list && child.type !== nodes.ordered_list)
        return undefined;
      const items: PMNode[] = [];

      child.forEach((item) => items.push(item));

      if (items.length > 1) items.pop();
      else items.push(items[0]!);
      next[at] = child.type.create(child.attrs, items);

      return { content: next, moved: same };
    }

    case "split": {
      if (child.type !== nodes.paragraph || child.content.size < 2)
        return undefined;
      let middle = Math.floor(child.content.size / 2);

      // A caret never sits inside an emoji's pair of UTF-16 units.
      if (
        /[\uD800-\uDBFF]$/.test(child.content.textBetween(middle - 1, middle))
      )
        middle++;

      next.splice(
        at,
        1,
        child.type.create(child.attrs, child.content.cut(0, middle)),
        child.type.create({ gap: 1 }, child.content.cut(middle)),
      );

      return {
        content: next,
        moved: (index) =>
          index === at ? undefined : index > at ? index + 1 : index,
      };
    }

    case "join": {
      const after = content[at + 1];

      if (child.type !== nodes.paragraph || after?.type !== nodes.paragraph)
        return undefined;
      next.splice(
        at,
        2,
        child.type.create(child.attrs, child.content.append(after.content)),
      );

      return {
        content: next,
        moved: (index) =>
          index === at || index === at + 1
            ? undefined
            : index > at
              ? index - 1
              : index,
      };
    }
  }
}

describe("a partial edit", () => {
  test("keeps the untouched children as written, and saves again unchanged", () => {
    fc.assert(
      fc.property(
        multiBlockSource,
        fc.nat(),
        fc.constantFrom<Edit>("text", "mark", "item", "split", "join"),
        inlines,
        (source, pick, edit, json) => {
          const original = parseBlockMarkdown(source);
          const at = pick % original.nodes.length;

          const change = edited(
            original.nodes,
            at,
            edit,
            json.map((inline) => boardSchema.nodeFromJSON(inline)),
          );

          fc.pre(
            change !== undefined &&
              !change.content.some((child) => isBlankParagraph(child)),
          );

          // Saved the editor's way: each untouched child from its source.
          const saved = markdownOf(container(change!.content), source);
          const read = parseBlockMarkdown(saved);

          expect(meant(read.nodes).toJSON()).toStrictEqual(
            meant(change!.content).toJSON(),
          );

          // Every untouched child reads back from its source as written.
          const kept = original.slices.flatMap((slice, index) => {
            const now = change!.moved(index);

            return now === undefined ? [] : [[read.slices[now], slice]];
          });

          expect(kept.map(([now]) => now)).toEqual(
            kept.map(([, before]) => before),
          );
          expect(
            changes({
              title: "Edited",
              document: [{ id: "block-1", type: "markdown", markdown: saved }],
            }),
          ).toEqual([]);
        },
      ),
      PROPERTY,
    );
  }, 600_000);
});
