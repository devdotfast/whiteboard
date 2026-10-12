import { describe, expect, test } from "vitest";

import type { BlockJSON, Board } from "./board-doc";
import { applyVersion } from "./merge";
import { focusedBlock } from "./structure";
import { TestEditor } from "./testing";

const base = (): Board => ({
  title: "Plan",
  document: [
    {
      id: "block-1",
      type: "section",
      title: "Why",
      children: [
        { id: "block-2", type: "markdown", markdown: "Agents write boards." },
      ],
    },
    {
      id: "block-3",
      type: "section",
      title: "How",
      children: [
        { id: "block-4", type: "markdown", markdown: "Type into the board." },
        {
          id: "diagram-5",
          type: "sequence",
          title: "Save",
          actors: [],
          steps: [],
        },
      ],
    },
  ],
});

const children = (board: Board, index: number) =>
  board.document[index]!.children as BlockJSON[];

/** The agent's version: rewrites block-2, adds block-9, removes the diagram. */
function agentVersion(): Board {
  const next = base();
  children(next, 0)[0]!.markdown = "Agents and people write boards.";
  children(next, 1).push({
    id: "block-9",
    type: "markdown",
    markdown: "Added by the agent.",
  });
  children(next, 1).splice(1, 1);

  return next;
}

function receive(e: TestEditor, next: Board) {
  const tr = applyVersion(e.state, e.base, next, focusedBlock(e.state));

  if (tr) e.dispatch(tr);
  e.base = next;
}

describe("another author's version", () => {
  test("lands around the person's typing in another block", () => {
    const e = new TestEditor(base())
      .caret("Type into the board.")
      .type(" Fast.");

    receive(e, agentVersion());

    expect(e.lines).toEqual([
      "# Why",
      "Agents and people write boards.",
      "# How",
      "Type into the board. Fast.",
      "Added by the agent.",
    ]);
    // The caret is where the person left it.
    expect(
      e.state.doc.textBetween(
        e.state.selection.from - 6,
        e.state.selection.from,
      ),
    ).toBe(" Fast.");
  });

  test("⌘Z undoes only the person's typing", () => {
    const e = new TestEditor(base())
      .caret("Type into the board.")
      .type(" Fast.");

    receive(e, agentVersion());
    e.press("Mod-z");

    expect(e.lines).toEqual([
      "# Why",
      "Agents and people write boards.",
      "# How",
      "Type into the board.",
      "Added by the agent.",
    ]);
  });

  test("keeps the block the person is in as they have it", () => {
    const e = new TestEditor(base()).caret("Agents write").type(" new");
    const next = agentVersion();

    receive(e, next);

    expect(e.lines[1]).toBe("Agents write new boards.");
  });

  test("keeps unsaved typing in a block the person has left", () => {
    const e = new TestEditor(base())
      .caret("Agents write")
      .type(" new")
      .caret("Type into the board.");

    receive(e, agentVersion());

    // Their rewrite of the block waits for the person's save to decide.
    expect(e.lines[1]).toBe("Agents write new boards.");
    expect(e.lines).toContain("Added by the agent.");
  });

  test("keeps a heading the person removed, removed", () => {
    const e = new TestEditor(base()).caret("Why", 0).press("Backspace");
    const next = base();
    children(next, 1)[0]!.markdown = "Type into the board, they said.";

    receive(e, next);

    expect(e.lines).toEqual([
      "Why",
      "Agents write boards.",
      "# How",
      "Type into the board, they said.",
      "[sequence]",
    ]);
  });

  test("adds a line the person typed to the blocks the agent left", () => {
    const e = new TestEditor(base()).caret("How").press("Enter").type("Mine.");

    receive(e, agentVersion());

    expect(e.lines).toContain("Mine.");
    expect(e.lines).toContain("Added by the agent.");
  });

  test("fills a new, empty board without leaving its blank first line", () => {
    const e = new TestEditor({ title: "New", document: [] }).caret("New");

    receive(e, base());

    expect(e.lines[0]).toBe("# Why");
  });
});
