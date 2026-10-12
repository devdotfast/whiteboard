import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, test } from "vitest";

import type { Board } from "./board-doc";
import { docToBoard } from "./board-doc";
import { pastedCopies } from "./editor-state";
import { applyVersion } from "./merge";
import { slashKey } from "./slash";
import { focusedBlock } from "./structure";
import { TestEditor } from "./testing";

const diagram = {
  id: "diagram-6",
  type: "sequence",
  title: "Saving an edit",
  actors: [],
  steps: [],
};

const board = (): Board => ({
  title: "Retries",
  document: [
    {
      id: "block-1",
      type: "section",
      title: "Why",
      children: [
        {
          id: "block-2",
          type: "markdown",
          markdown: "One version per save.\n\nSaves retry.",
        },
      ],
    },
    {
      id: "block-3",
      type: "section",
      title: "Plan",
      children: [
        { id: "block-4", type: "markdown", markdown: "Keep the queue." },
        diagram,
        {
          id: "block-5",
          type: "markdown",
          markdown: "Each step is one write.",
        },
      ],
    },
  ],
});

const editor = () => new TestEditor(board());

describe("lines", () => {
  test("Enter splits a line, and the new line stays in its block", () => {
    const e = editor().caret("One version", 3).press("Enter");

    expect(e.lines.slice(1, 3)).toEqual(["One", " version per save."]);
    expect(e.board.document[0]).toMatchObject({
      children: [
        { id: "block-2", markdown: "One\n\nversion per save.\n\nSaves retry." },
      ],
    });
  });

  test("Backspace at a line's start joins it to the line above, across blocks", () => {
    const e = editor().caret("Keep", 0).press("Backspace");

    expect(e.lines).toContain("# PlanKeep the queue.");
    expect(e.board.document[1]).toMatchObject({
      id: "block-3",
      title: "PlanKeep the queue.",
    });
  });

  test("Backspace at a heading's start makes it a line, and a second joins it up", () => {
    const e = editor().caret("Plan", 0).press("Backspace");

    expect(e.lines).toEqual([
      "# Why",
      "One version per save.",
      "Saves retry.",
      "Plan",
      "Keep the queue.",
      "[sequence]",
      "Each step is one write.",
    ]);
    // Its content joined the section above.
    expect(e.board.document).toHaveLength(1);

    e.press("Backspace");
    expect(e.lines).toContain("Saves retry.Plan");
  });

  test("Backspace at a heading's start keeps the block below it as it was", () => {
    const e = new TestEditor({
      title: "T",
      document: [
        {
          id: "block-1",
          type: "section",
          title: "Plan",
          children: [{ id: "block-2", type: "markdown", markdown: "Below." }],
        },
      ],
    }).caret("Plan", 0);

    e.press("Backspace");

    expect(e.lines).toEqual(["Plan", "Below."]);
    expect(e.board.document).toMatchObject([
      { id: "block-2", markdown: "Plan\n\nBelow." },
    ]);
  });

  test("Enter at the end of a heading starts a line in its section", () => {
    const e = editor().caret("Why").press("Enter").type("First.");

    expect(e.lines.slice(0, 2)).toEqual(["# Why", "First."]);
  });

  test("Enter on a selected title keeps it and goes to the body", () => {
    const e = editor();
    e.dispatch(
      e.state.tr.setSelection(TextSelection.create(e.state.doc, 1, 8)),
    );
    e.press("Enter").type("Intro. ");

    expect(e.state.doc.firstChild!.textContent).toBe("Retries");
    expect(e.lines[0]).toBe("# Intro. Why");
  });

  test("Enter in the title goes to the start of the body's first block, adding no line", () => {
    const e = new TestEditor({
      title: "Plan",
      document: [{ id: "block-1", type: "markdown", markdown: "Existing." }],
    });

    e.caret("Plan").press("Enter").type("New. ");

    expect(e.lines).toEqual(["New. Existing."]);
    expect(e.state.doc.firstChild!.textContent).toBe("Plan");
  });

  test("Enter in the title goes into the body's first line when it is empty", () => {
    const e = new TestEditor({ title: "Plan", document: [] });

    // The first Enter adds an empty line; the second goes into it.
    e.caret("Plan").press("Enter");
    e.caret("Plan").press("Enter").type("First.");

    expect(e.lines).toEqual(["First."]);
  });

  test("Enter in the title of a board with no body starts its first line", () => {
    const e = new TestEditor({ title: "Plan", document: [] });

    e.caret("Plan").press("Enter").type("First.");

    expect(e.lines).toEqual(["First."]);
    expect(e.state.doc.firstChild!.textContent).toBe("Plan");
  });
});

describe("headings", () => {
  test("## at a line's start makes it a sub-section", () => {
    const e = editor().caret("Saves retry.", 0).type("## ");

    expect(e.lines).toContain("## Saves retry.");
    expect(e.outline[0]).toEqual({ Why: ["markdown", { "Saves retry.": [] }] });
  });

  test("⌘Z right after the shortcut brings back the typed ##", () => {
    const e = editor().caret("Saves retry.", 0).type("## ").press("Mod-z");

    expect(e.lines[2]).toBe("## Saves retry.");
    expect(e.board.document[0]).toMatchObject({
      children: [{ id: "block-2" }],
    });
    // The caret stays after what was typed.
    expect(e.state.selection.$from.parentOffset).toBe(3);
  });

  test("a section can be no deeper than one below the heading above it", () => {
    const e = editor().caret("Saves retry.", 0).type("### ");

    expect(e.lines).toContain("## Saves retry.");
  });

  test("an emptied heading goes away when the caret leaves it", () => {
    const e = editor().caret("Plan", 0);
    const at = e.find("Plan");
    e.dispatch(e.state.tr.delete(at, at + 4));
    e.caret("Keep");

    expect(e.lines).not.toContain("# ");
    expect(e.board.document[0]).toMatchObject({
      children: [
        { id: "block-2" },
        { id: "block-4" },
        { id: "diagram-6" },
        { id: "block-5" },
      ],
    });
  });
});

describe("shortcuts", () => {
  test.each([
    ["- ", "- item"],
    ["* ", "- item"],
    ["1. ", "1. item"],
    ["> ", "> item"],
  ])("%s starts a block", (shortcut, line) => {
    const e = editor()
      .caret("Each step is one write.")
      .press("Enter")
      .type(`${shortcut}item`);

    expect(e.lines.at(-1)).toBe(line);
  });

  test("``` and a space start a code block", () => {
    const e = editor()
      .caret("Each step is one write.")
      .press("Enter")
      .type("``` x = 1");

    expect(e.lines.at(-1)).toBe("```x = 1```");
  });

  test("inline marks format as typed", () => {
    const e = editor()
      .caret("Each step is one write.")
      .type(" **bold** and `code` and [a link](https://example.com)");

    expect(e.board.document[1]).toMatchObject({
      children: [
        {},
        {},
        {
          markdown:
            "Each step is one write. **bold** and `code` and [a link](https://example.com)",
        },
      ],
    });
  });

  test("a shortcut mid-sentence is just text", () => {
    const e = editor().caret("Keep").type(" # x");

    expect(e.lines).toContain("Keep # x the queue.");
  });
});

describe("rich blocks", () => {
  test("the first Backspace selects a rich block, the second deletes it, ⌘Z restores", () => {
    const e = editor().caret("Each", 0).press("Backspace");

    expect(e.selectedBlock).toEqual(diagram);

    e.press("Backspace");
    expect(e.lines).not.toContain("[sequence]");
    expect(JSON.stringify(e.board)).not.toContain("diagram-6");

    e.press("Mod-z");
    expect(e.lines).toContain("[sequence]");
    expect(e.board.document[1]).toMatchObject({ children: [{}, diagram, {}] });
  });

  test("Delete at the end of the line above selects it too", () => {
    const e = editor().caret("Keep the queue.").press("Delete");

    expect(e.selectedBlock).toEqual(diagram);
  });

  test("the first Esc lets go of a selected rich block, leaving a caret beside it", () => {
    const e = editor().caret("Each", 0).press("Backspace").press("Escape");

    expect(e.selectedBlock).toBeUndefined();
    expect(e.state.selection.empty).toBe(true);
    expect(e.lines).toContain("[sequence]");
  });

  test("typing with a rich block selected types on the line after it", () => {
    const e = editor().caret("Each", 0).press("Backspace").type("X");

    expect(e.lines).toContain("[sequence]");
    expect(e.lines).toContain("XEach step is one write.");
  });
});

describe("the / menu", () => {
  const slash = (e: TestEditor) => slashKey.getState(e.state)!;

  test("opens on an empty line and filters as you type", () => {
    const e = editor().caret("Keep the queue.").press("Enter").type("/");

    expect(slash(e)).toMatchObject({ open: true });

    e.type("he");
    expect(slash(e)).toMatchObject({
      items: [
        { label: "Heading 1" },
        { label: "Heading 2" },
        { label: "Heading 3" },
      ],
    });
  });

  test("Enter applies the highlighted item", () => {
    const e = editor()
      .caret("Keep the queue.")
      .press("Enter")
      .type("/he")
      .press("ArrowDown", "Enter");

    e.type("Risks");
    expect(e.lines).toContain("## Risks");
  });

  test("Esc closes it and leaves the slash", () => {
    const e = editor()
      .caret("Keep the queue.")
      .press("Enter")
      .type("/")
      .press("Escape");

    expect(slash(e).open).toBe(false);
    expect(e.lines).toContain("/");
  });

  test("closes when nothing matches", () => {
    const e = editor().caret("Keep the queue.").press("Enter").type("/zz");

    expect(slash(e).open).toBe(false);
  });

  test("a slash mid-sentence is just a slash", () => {
    const e = editor().caret("Keep").type("/");

    expect(slash(e).open).toBe(false);
  });
});

describe("pasting and dragging", () => {
  /** The blocks from block-4 to block-5, whole. */
  const slice = (e: TestEditor) => {
    let from = 0;
    let to = 0;

    e.state.doc.forEach((node, pos) => {
      if (node.attrs.id === "block-4") from = pos;

      if (node.attrs.id === "block-5") to = pos + node.nodeSize;
    });

    return e.state.doc.slice(from, to);
  };

  test("a dragged range keeps its blocks' ids and rich blocks, at the depth it lands", () => {
    const e = editor();
    const moved = pastedCopies(slice(e), e.state.doc, true);
    const ids: unknown[] = [];

    moved.content.forEach((node) =>
      ids.push([node.attrs.id, node.attrs.depth]),
    );
    expect(ids).toEqual([
      ["block-4", null],
      ["diagram-6", null],
      ["block-5", null],
    ]);
  });

  test("a pasted copy is new blocks, a rich block's copy included, and the originals keep their ids", () => {
    const e = editor();
    const copied = pastedCopies(slice(e), e.state.doc, false);
    const ids: unknown[] = [];

    copied.content.forEach((node) =>
      ids.push([node.attrs.id, node.attrs.key, node.attrs.json?.id]),
    );
    expect(ids).toEqual([
      [null, null, undefined],
      [null, null, undefined],
      [null, null, undefined],
    ]);

    // Saved, the copy of the rich block is a new block of its own.
    e.dispatch(e.state.tr.insert(e.state.doc.content.size, copied.content));

    const saved = docToBoard(e.state.doc, e.base).document;

    const every = (blocks: typeof saved): typeof saved =>
      blocks.flatMap((block) => [block, ...every(block.children ?? [])]);

    expect(
      every(saved)
        .filter((block) => block.type === "sequence")
        .map(({ id }) => id),
    ).toEqual(["diagram-6", undefined]);
  });

  test("a block cut and pasted on the same board keeps its id", () => {
    const e = editor();
    const cut = slice(e);
    const ids = new Set<string>();

    cut.content.forEach((node) => ids.add(node.attrs.id));

    // Cut: the blocks leave the board.
    let from = 0;
    let to = 0;

    e.state.doc.forEach((node, pos) => {
      if (node.attrs.id === "block-4") from = pos;

      if (node.attrs.id === "block-5") to = pos + node.nodeSize;
    });
    e.dispatch(e.state.tr.delete(from, to));

    const pasted = pastedCopies(cut, e.state.doc, false, ids);
    const kept: unknown[] = [];

    pasted.content.forEach((node) => kept.push(node.attrs.id));
    expect(kept).toEqual(["block-4", "diagram-6", "block-5"]);
  });
});

describe("block ids", () => {
  test("a second copy of any block, a rich one included, gets an id of its own", () => {
    const e = editor();
    let atom = e.state.doc.child(0);

    e.state.doc.forEach((node) => {
      if (node.attrs.id === "diagram-6") atom = node;
    });
    e.dispatch(e.state.tr.insert(e.state.doc.content.size, atom));

    const ids: unknown[] = [];

    e.state.doc.forEach((node) => {
      if (node.type.name === "atom") ids.push(node.attrs.id);
    });
    expect(ids).toEqual(["diagram-6", null]);
  });
});

describe("lists", () => {
  const listBoard = (markdown: string): Board => ({
    title: "Lists",
    document: [
      { id: "block-1", type: "markdown", markdown },
      { id: "block-2", type: "markdown", markdown: "After." },
    ],
  });

  /** Where the caret is: its line's text, and how many lists hold it. */
  const caretAt = (e: TestEditor) => {
    const $caret = e.state.selection.$from;
    let lists = 0;

    for (let depth = $caret.depth; depth > 0; depth--)
      if ($caret.node(depth).type.name === "list_item") lists++;

    return {
      line: $caret.parent.textContent,
      lists,
      block: $caret.node(1).attrs.id,
    };
  };

  test("Enter on an item with text splits it", () => {
    const e = new TestEditor(listBoard("- one\n- two")).caret("one", 2);

    e.press("Enter");
    expect(e.lines[0]).toBe("- on\n- e\n- two");
    expect(caretAt(e)).toEqual({ line: "e", lists: 1, block: "block-1" });
  });

  test("Enter on an empty nested item lifts it one level, and the caret stays in it", () => {
    const e = new TestEditor(listBoard("- one\n  - inner")).caret("inner");

    e.press("Enter");
    expect(caretAt(e)).toEqual({ line: "", lists: 2, block: "block-1" });
    e.press("Enter");
    expect(caretAt(e)).toEqual({ line: "", lists: 1, block: "block-1" });
    expect(e.board.document[0]!.markdown).toBe("- one\n  - inner\n-");
  });

  test("Enter on an empty top-level item leaves the list there, as an empty line between its halves", () => {
    const e = new TestEditor(listBoard("- one\n- two")).caret("one");

    e.press("Enter", "Enter");
    expect(caretAt(e)).toEqual({ line: "", lists: 0, block: "block-1" });
    expect(e.lines.slice(0, 3)).toEqual(["- one", "", "- two"]);
  });

  test("Shift-Tab and Backspace at the start of an empty item do what Enter does", () => {
    for (const key of ["Shift-Tab", "Backspace"]) {
      const nested = new TestEditor(listBoard("- one\n  - inner")).caret(
        "inner",
      );

      nested.press("Enter", key);
      expect(caretAt(nested)).toEqual({ line: "", lists: 1, block: "block-1" });

      const top = new TestEditor(listBoard("- one\n- two")).caret("one");

      top.press("Enter", key);
      expect(caretAt(top)).toEqual({ line: "", lists: 0, block: "block-1" });
      expect(top.lines.slice(0, 3)).toEqual(["- one", "", "- two"]);
    }
  });

  test("the line a lifted item leaves stays under the caret through its save and the version that comes back", () => {
    const e = new TestEditor(listBoard("- one\n  - inner")).caret("inner");

    e.press("Enter", "Enter");

    const saved = { ...e.board, document: e.board.document } as Board;
    const tr = applyVersion(e.state, e.base, saved, focusedBlock(e.state));

    if (tr) e.dispatch(tr);
    e.base = saved;

    expect(caretAt(e)).toEqual({ line: "", lists: 1, block: "block-1" });

    // Typing lands on that line, not the next one.
    e.type("two");
    expect(e.board.document[0]!.markdown).toBe("- one\n  - inner\n- two");
    expect(e.board.document[1]!.markdown).toBe("After.");
  });
});
