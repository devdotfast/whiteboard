import { NodeSelection } from "@tiptap/pm/state";
import { describe, expect, test } from "vitest";

import type { Board } from "./board-doc";
import { slashKey } from "./slash";
import { TestEditor } from "./testing";

const table = [
  "| Step | Owner |",
  "| ---- | ----- |",
  "| Save | Ann   |",
  "| Undo | Bo    |",
].join("\n");

const board = (markdown: string): Board => ({
  title: "Plan",
  document: [{ id: "block-1", type: "markdown", markdown }],
});

const editor = (markdown = `${table}\n\nAfter.`) =>
  new TestEditor(board(markdown));

const saved = (e: TestEditor) => String(e.board.document[0]!.markdown);

const slash = (e: TestEditor, label: string) => {
  e.type("/");
  const menu = slashKey.getState(e.state)!;

  if (!menu.open) throw new Error("The / menu is closed.");

  e.press(
    ...Array<string>(menu.items.findIndex((item) => item.label === label)).fill(
      "ArrowDown",
    ),
    "Enter",
  );

  return e;
};

describe("tables", () => {
  test("an untouched table keeps its source", () => {
    const e = editor().caret("After.").type("!");

    expect(saved(e)).toBe(`${table}\n\nAfter.!`);
  });

  test("an edited table is written whole, its pipes lined up as they were", () => {
    const e = editor().caret("Ann").type("e");

    expect(saved(e)).toBe(
      [
        "| Step | Owner |",
        "| ---- | ----- |",
        "| Save | Anne  |",
        "| Undo | Bo    |",
        "",
        "After.",
      ].join("\n"),
    );
  });

  test("a table written without padding stays that way", () => {
    const e = editor("|a|b|\n|-|-|\n|1|2|").caret("1").type("0");

    expect(saved(e)).toBe("|a|b|\n|-|-|\n|10|2|");
  });

  test("a line break typed in a cell saves as a space", () => {
    const e = editor().caret("Save").press("Shift-Enter").type("it");

    expect(saved(e)).toContain("| Save it | Ann   |");
  });

  test("Tab and Shift-Tab move between cells; the last cell's Tab adds a row", () => {
    const e = editor().caret("Save").press("Tab").type("!");

    expect(saved(e)).toContain("Ann!");
    e.press("Shift-Tab").type("?");
    expect(saved(e)).toContain("Save?");

    e.caret("Bo").press("Tab").type("Cy");
    expect(e.lines[0]).toBe(
      "| Step | Owner |\n| Save? | Ann! |\n| Undo | Bo |\n| Cy |  |",
    );
  });

  test("Enter goes to the cell below, and adds a row under the last", () => {
    const e = editor().caret("Owner").press("Enter").type("1");

    expect(saved(e)).toContain("Ann1");

    e.caret("Bo").press("Enter").type("Di");
    expect(e.lines[0]!.split("\n").at(-1)).toBe("|  | Di |");
  });

  test("Backspace after a table selects it, and a second deletes it", () => {
    const e = editor().caret("After.", 0).press("Backspace");

    expect(e.state.selection).toBeInstanceOf(NodeSelection);
    expect((e.state.selection as NodeSelection).node.type.name).toBe("table");

    e.press("Backspace");
    expect(saved(e)).toBe("After.");
  });

  test("Backspace at a cell's start never merges cells", () => {
    const e = editor().caret("Ann", 0).press("Backspace");

    expect(saved(e)).toBe(`${table}\n\nAfter.`);
  });

  test("the / menu adds and deletes rows and columns, and keeps the header", () => {
    const e = editor().caret("Ann").press("Enter").press("Enter");

    // An empty new row: its first cell takes the menu.
    e.press("Shift-Tab");
    slash(e, "Column right");
    expect(e.lines[0]!.split("\n")[0]).toBe("| Step |  | Owner |");

    // The header's new, empty cell: its row stays.
    slash(e.caret("Step").press("Tab"), "Delete row");
    expect(e.lines[0]!.split("\n")[0]).toBe("| Step |  | Owner |");

    // The new row's: it goes.
    slash(e.caret("Undo").press("Enter"), "Delete row");
    expect(e.lines[0]!.split("\n")).toHaveLength(3);
  });

  test("a new table from the / menu, written padded and lined up", () => {
    const e = editor("Intro.").caret("Intro.").press("Enter");

    slash(e, "Table").type("A").press("Tab").type("B");
    expect(saved(e)).toContain("| A | B |   |");
  });
});

describe("tasks", () => {
  const list = "- [ ] Write it\n- [x] Ship it";

  test("a bulleted list of tasks ticks, and saves its boxes", () => {
    const e = editor(list);
    let pos = -1;

    e.state.doc.descendants((node, at) => {
      if (pos < 0 && node.type.name === "task_item") pos = at;
    });
    e.dispatch(
      e.state.tr.setNodeMarkup(pos, undefined, {
        ...e.state.doc.nodeAt(pos)!.attrs,
        checked: true,
      }),
    );

    expect(saved(e)).toBe("- [x] Write it\n- [x] Ship it");
  });

  test("Enter makes the next task, unticked", () => {
    const e = editor(list).caret("Ship it").press("Enter").type("Tell them");

    expect(saved(e)).toBe("- [ ] Write it\n- [x] Ship it\n- [ ] Tell them");
  });

  test("a numbered or mixed list keeps its [x] as it was", () => {
    for (const source of ["1. [x] One\n2. [ ] Two", "- [x] One\n- Two"]) {
      const e = editor(source);

      expect(e.lines[0]).not.toContain("- [x]");
      expect(saved(e.caret("One").type("!"))).toContain("[x] One!");
    }
  });

  test("the / menu starts a to-do list", () => {
    const e = editor("Intro.").caret("Intro.").press("Enter");

    slash(e, "To-do list").type("Call");
    expect(saved(e)).toBe("Intro.\n\n- [ ] Call");
  });
});
