import type { Block } from "@dev.fast/whiteboard-document";
import { describe, expect, it } from "vitest";

import { documentHeadings } from "./document-headings.js";

describe("documentHeadings", () => {
  it("slugs the whole heading text, inline code and links included", () => {
    const block: Block = {
      id: "b1",
      type: "markdown",
      markdown: "# Title\n\n## The `store` and [its home](https://x.test)\n",
    };

    expect(documentHeadings([block])).toEqual([
      {
        id: "the-store-and-its-home",
        text: "The store and its home",
        level: "h2",
        block,
        index: 0,
        depth: 1,
      },
    ]);
  });

  it("falls back to `section` when a heading slugs to nothing", () => {
    const block: Block = { id: "b1", type: "markdown", markdown: "### ?!\n" };

    expect(documentHeadings([block])).toMatchObject([
      { id: "section", level: "h3" },
    ]);
  });

  it("numbers a block's headings among themselves, not among its nodes", () => {
    const block: Block = {
      id: "b1",
      type: "markdown",
      markdown: "Intro[^1]\n\n[^1]: note\n\n## One\n\nText\n\n### Two\n",
    };

    expect(documentHeadings([block])).toMatchObject([
      { id: "one", index: 0 },
      { id: "two", index: 1 },
    ]);
  });

  it("numbers a repeated slug in document order across blocks", () => {
    const nested: Block = {
      id: "b2",
      type: "markdown",
      markdown: "## Details\n\n#### Details\n",
    };

    const blocks: Block[] = [
      { id: "b1", type: "section", title: "Details", children: [nested] },
    ];

    expect(documentHeadings(blocks)).toMatchObject([
      { id: "details", text: "Details", level: "h2", block: blocks[0] },
      { id: "details-2", text: "Details", level: "h2", block: nested },
    ]);
  });

  it("puts each heading at its depth: sections by nesting, Markdown under its section", () => {
    const blocks: Block[] = [
      {
        id: "b1",
        type: "section",
        title: "One",
        children: [
          {
            id: "b2",
            type: "section",
            title: "Two",
            children: [
              {
                id: "b3",
                type: "markdown",
                markdown: "## Topic\n\n### Detail\n",
              },
              { id: "b4", type: "section", title: "Three", children: [] },
            ],
          },
        ],
      },
      { id: "b5", type: "section", title: "Next", children: [] },
    ];

    expect(
      documentHeadings(blocks).map(({ text, depth }) => [text, depth]),
    ).toEqual([
      ["One", 1],
      ["Two", 2],
      ["Topic", 3],
      ["Detail", 4],
      ["Three", 3],
      ["Next", 1],
    ]);
  });
});
