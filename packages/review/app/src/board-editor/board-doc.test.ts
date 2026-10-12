import { describe, expect, test } from "vitest";

import { type Board, isNewBoard } from "./board-doc";
import { TestEditor } from "./testing";

// Markdown the way agents write it, with the syntax a re-serializer would
// normalize: `*` bullets, `__bold__`, a setext heading, a loose list, math.
const prose = [
  "Intro with __bold__, *em*, `code`, a [link](whiteboard:board/b-1), and $x^2$.",
  "* first\n* second\n\n  more of second",
  "Setext heading\n--------------",
  "1) one\n2) two",
  "> quoted\n> lines",
  "```ts\nconst x = 1;\n```",
  "| a | b |\n| - | - |\n| 1 | 2 |",
  "$$\ny = mx + b\n$$",
  "Line with a hard break\\\nand more.",
].join("\n\n");

const board = (): Board => ({
  title: "Fidelity",
  document: [
    { id: "block-1", type: "markdown", markdown: prose },
    {
      type: "section",
      id: "block-2",
      title: "Nested",
      defaultCollapsed: true,
      children: [
        { type: "markdown", markdown: "Under nested.\n", id: "block-3" },
        {
          id: "block-4",
          type: "section",
          title: "Deeper",
          children: [
            {
              id: "block-5",
              type: "code_peek",
              source: {
                file: "a.ts",
                start: { side: "head", line: 1 },
                end: { side: "head", line: 4 },
              },
            },
          ],
        },
      ],
    },
    // After a section's end, not in it.
    { id: "block-7", type: "markdown", markdown: "Top level again." },
    { id: "block-6", type: "section", title: "Last", children: [] },
  ],
});

describe("a board in the editor", () => {
  test("an edit to one paragraph leaves the source of the rest as written", () => {
    const e = new TestEditor(board()).caret("Intro with ").type("an ");
    const markdown = e.board.document[0]!.markdown as string;

    expect(markdown).toBe(prose.replace("Intro with ", "Intro with an "));
  });

  test("a section keeps its other fields and their order", () => {
    const e = new TestEditor(board()).caret("Nested").type("!");

    expect(Object.keys(e.board.document[1]!)).toEqual([
      "type",
      "id",
      "title",
      "defaultCollapsed",
      "children",
    ]);
    expect(e.board.document[1]).toMatchObject({
      title: "Nested!",
      defaultCollapsed: true,
    });
  });

  test("a heading nests by its level, at most one below the one above", () => {
    const e = new TestEditor(board())
      .caret("Under nested.")
      .press("Enter")
      .type("### Third")
      .press("Enter")
      .type("Text under third.");

    expect(e.outline[1]).toEqual({
      Nested: ["markdown", { Third: ["markdown"] }, { Deeper: ["code_peek"] }],
    });
    expect(e.board.document[1]).toMatchObject({
      children: [{}, { children: [{ markdown: "Text under third." }] }, {}],
    });
  });
});

test("counts a board as new only while it is an empty first version still called Untitled", () => {
  const blank = { version: 0, title: "Untitled", document: [] };

  expect(isNewBoard(blank)).toBe(true);
  // An agent's empty board has a name; a saved or written board is not new.
  expect(isNewBoard({ ...blank, title: "Plan" })).toBe(false);
  expect(isNewBoard({ ...blank, version: 1 })).toBe(false);
  expect(isNewBoard({ ...blank, document: [{ id: "b1" }] })).toBe(false);
});
