import { AllSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { BlockJSON } from "./board-doc";
import { memoryBoardServer } from "./memory-transport";
import { type SaveStatus, type VersionedBoard, openBoardSync } from "./sync";
import { TestEditor } from "./testing";

// Every way typing could be lost, driven through the board-sync module's
// interface against a server in memory.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const start = (): VersionedBoard => ({
  version: 3,
  title: "Plan",
  document: [
    { id: "block-1", type: "markdown", markdown: "First line." },
    { id: "block-2", type: "markdown", markdown: "Second line." },
  ],
});

/** An open board: an editor, its sync, and the server it saves to. */
function open(board = start(), server = memoryBoardServer(board)) {
  const statuses: SaveStatus[] = [];
  let e!: TestEditor;

  const sync = openBoardSync({
    board,
    transport: server.transport(),
    editor: { state: () => e.state, dispatch: (tr) => e.dispatch(tr) },
    onStatus: (status) => statuses.push(status),
  });

  e = new TestEditor(sync.initial);

  // Every transaction reaches the sync, as in the canvas.
  const apply = e.dispatch;

  e.dispatch = (tr) => {
    apply(tr);
    sync.tell({ tr });
  };

  /** Lets typing settle and every save run, as time passes. */
  const settle = (ms = 1_000) => vi.advanceTimersByTimeAsync(ms);

  return { e, sync, server, statuses, settle };
}

const markdown = (blocks: BlockJSON[]) => blocks.map((block) => block.markdown);

const lines = (server: { board: VersionedBoard }) =>
  markdown(server.board.document);

describe("saving", () => {
  test("saves once typing settles, against the version it last saw", async () => {
    const { e, server, settle, statuses } = open();

    e.caret("First line.").type(" Edited.");
    expect(server.saves).toHaveLength(0);
    expect(statuses.at(-1)).toBe("saving");

    await settle();
    expect(server.saves[0]!.baseVersion).toBe(3);
    expect(lines(server)).toEqual(["First line. Edited.", "Second line."]);
    expect(statuses.at(-1)).toBe("saved");
  });

  test("a new block takes the id the server gives it, so it is saved once", async () => {
    const { e, server, settle } = open();

    e.caret("Second line.").press("Enter").type("## Risks");
    await settle();
    e.type(" ahead");
    await settle();

    expect(server.saves[1]!.document.at(-1)).toMatchObject({
      id: "block-100",
      title: "Risks ahead",
    });
    expect(
      server.board.document.filter((block) => block.type === "section"),
    ).toHaveLength(1);
  });

  test("selecting text, opening and other authors' versions never save", async () => {
    const { e, sync, server, settle } = open();

    e.dispatch(
      e.state.tr.setSelection(TextSelection.create(e.state.doc, 1, 5)),
    );
    sync.tell({
      version: server.author((board) => {
        board.document.push({
          id: "block-7",
          type: "markdown",
          markdown: "Agent's.",
        });
      }),
    });
    await settle();

    expect(server.saves).toHaveLength(0);
    expect(e.lines).toContain("Agent's.");
  });

  test("a failing save retries, then says so; the next edit or Retry saves again", async () => {
    const { e, sync, server, settle, statuses } = open();

    vi.spyOn(console, "error").mockImplementation(() => {});
    server.fail(10);
    e.caret("First line.").type("!");
    await settle(10_000);

    expect(server.saves).toHaveLength(4);
    expect(statuses.at(-1)).toBe("failed");

    server.fail(0);
    sync.tell("retry");
    await settle();
    expect(lines(server)[0]).toBe("First line.!");

    server.fail(10);
    e.type("?");
    await settle(10_000);
    server.fail(0);
    e.type("!");
    await settle();
    expect(lines(server)[0]).toBe("First line.!?!");
  });
});

describe("another author's version", () => {
  test("merges in around typing in another block", async () => {
    const { e, sync, server, settle } = open();

    e.caret("First line.").type(" Mine.");
    sync.tell({
      version: server.author((board) => {
        board.document[1]!.markdown = "Theirs.";
      }),
    });
    await settle();

    expect(lines(server)).toEqual(["First line. Mine.", "Theirs."]);
  });

  test("never deletes the block the person is typing in", async () => {
    const { e, sync, server, settle } = open();

    e.caret("First line.").type(" Mine.");
    sync.tell({
      version: server.author((board) => {
        board.document.splice(0, 1);
      }),
    });
    await settle();

    expect(lines(server)).toEqual(["First line. Mine.", "Second line."]);
  });

  test("never deletes a block left with unsaved typing", async () => {
    const { e, sync, server, settle } = open();

    server.holdAnswers();
    e.caret("First line.").type(" Mine.").caret("Second");
    sync.tell({
      version: server.author((board) => {
        board.document.splice(0, 1);
      }),
    });
    await settle();
    await server.answer();
    await settle();
    await server.answer();

    expect(lines(server)).toContain("First line. Mine.");
  });

  test("never renames over a title the person is typing", async () => {
    const { e, sync, server, settle } = open();

    e.caret("Plan").type(" B");
    sync.tell({
      version: server.author((board) => {
        board.title = "Their plan";
      }),
    });
    await settle();

    expect(server.board.title).toBe("Plan B");
  });

  test("renames a title the person hasn't touched", async () => {
    const { e, sync, server } = open();

    sync.tell({
      version: server.author((board) => {
        board.title = "Their plan";
      }),
    });

    expect(e.state.doc.firstChild!.textContent).toBe("Their plan");
  });

  test("refusing a save merges in, from the server if the stream is quiet, and saves again", async () => {
    const { e, server, settle } = open();

    // Changed on the server but never streamed.
    server.author((board) => {
      board.document[1]!.markdown = "Theirs.";
    });
    e.caret("First line.").type(" Mine.");
    await settle(3_000);

    expect(lines(server)).toEqual(["First line. Mine.", "Theirs."]);
  });

  test("arriving during a save waits for its answer", async () => {
    const { e, sync, server, settle } = open();

    server.holdAnswers();
    e.caret("First line.").type(" Edited.");
    await settle();

    const theirs = server.author((board) => {
      board.document.push({
        id: "block-8",
        type: "markdown",
        markdown: "Agent's.",
      });
    });

    sync.tell({ version: theirs });
    expect(e.lines).toEqual(["First line. Edited.", "Second line."]);

    await server.answer();
    await settle();
    expect(e.lines).toContain("Agent's.");
  });

  test("the version the editor has, arriving during a save, doesn't mark the save's typing saved", async () => {
    const { e, sync, server, settle, statuses } = open();

    server.holdAnswers();
    server.fail(1);
    e.caret("First line.").type(" Edited.");
    await settle();

    sync.tell({ version: start() });
    await server.answer();
    expect(statuses.at(-1)).not.toBe("saved");

    await settle(2_000);
    await server.answer();
    expect(lines(server)[0]).toBe("First line. Edited.");
  });

  test("a save whose answer is lost names its new blocks once, from the stream", async () => {
    const { e, sync, server, settle } = open();

    server.holdAnswers();
    e.caret("Second line.").press("Enter").type("## Risks");
    await settle();

    // The server saves it; its answer never comes, its version does.
    await server.answer();
    sync.tell({ version: server.board });
    await settle();

    expect(e.state.doc.child(3).attrs.id).toBe("block-100");
    expect(server.saves).toHaveLength(1);
  });
});

describe("⌘Z after a save", () => {
  const board = (): VersionedBoard => ({
    version: 3,
    title: "Plan",
    document: [
      {
        id: "block-1",
        type: "section",
        title: "Why",
        children: [
          { id: "block-2", type: "markdown", markdown: "First line." },
        ],
      },
      {
        id: "diagram-3",
        type: "sequence",
        title: "Flow",
        actors: {},
        steps: [],
      },
      { id: "block-4", type: "markdown", markdown: "Last line." },
    ],
  });

  const ids = (blocks: BlockJSON[]): string[] =>
    blocks.flatMap((block) => [block.id ?? "?", ...ids(block.children ?? [])]);

  test("clearing the board, saving and ⌘Z bring the blocks back once, with their ids", async () => {
    const { e, server, settle } = open(board());

    e.dispatch(e.state.tr.setSelection(new AllSelection(e.state.doc)));
    e.press("Backspace");
    await settle();
    expect(server.board.document).toEqual([]);

    e.press("Mod-z");
    await settle();
    expect(ids(server.board.document)).toEqual([
      "block-1",
      "block-2",
      "diagram-3",
      "block-4",
    ]);

    const saves = server.saves.length;

    await settle();
    expect(server.saves).toHaveLength(saves);
  });

  test("deleting a rich block, saving and ⌘Z bring it back once", async () => {
    const { e, server, settle } = open(board());

    e.caret("Last", 0).press("Backspace", "Backspace");
    await settle();
    expect(ids(server.board.document)).toEqual([
      "block-1",
      "block-2",
      "block-4",
    ]);

    e.press("Mod-z");
    await settle();
    expect(ids(server.board.document)).toEqual([
      "block-1",
      "block-2",
      "diagram-3",
      "block-4",
    ]);
  });
});

describe("the hold", () => {
  test("stays on a block left with unsaved typing until its save lands", async () => {
    const { e, sync, server, settle } = open();

    server.holdAnswers();
    sync.tell({ focused: true });
    e.caret("First line.").type(" Mine.");
    expect(server.holds.at(-1)).toEqual({ blockId: "block-1", open: true });

    e.caret("Second");
    await settle(0);
    expect(server.saves).toHaveLength(1);
    expect(server.holds.at(-1)!.blockId).toBe("block-1");

    await server.answer();
    expect(server.holds.at(-1)!.blockId).toBe("block-2");
  });

  test("leaving the editor keeps it too, then lets go", async () => {
    const { e, sync, server, settle } = open();

    server.holdAnswers();
    sync.tell({ focused: true });
    e.caret("First line.").type(" Mine.");
    sync.tell({ focused: false });
    await settle(0);

    expect(server.saves).toHaveLength(1);
    expect(server.holds.at(-1)!.blockId).toBe("block-1");

    await server.answer();
    expect(server.holds.at(-1)).toEqual({ blockId: null, open: true });
  });
});

describe("the server's spelling", () => {
  // The store writes a commit link's short id out in full.
  const store = (markdown: string) =>
    markdown.replace("/commit/abc1234)", "/commit/abc1234def5678)");

  const link = " [the fix](https://github.com/o/r/commit/abc1234)";

  const full = "[the fix](https://github.com/o/r/commit/abc1234def5678)";

  const saved = (e: TestEditor) => markdown(e.board.document)[0];

  test("a saved block takes it, the hold moves on, and nothing saves again", async () => {
    const board = start();
    const server = memoryBoardServer(board, { store });
    const { e, sync, settle } = open(board, server);

    server.holdAnswers({ stored: true });
    sync.tell({ focused: true });
    e.caret("First line.").type(link);
    await settle();
    expect(server.saves).toHaveLength(1);

    // Still in the block: the version streams in before the save's answer,
    // then the answer.
    sync.tell({ version: structuredClone(server.board) });
    await server.answer();
    expect(saved(e)).toBe(`First line. ${full}`);

    // Moving on, the hold follows: the block is saved.
    e.caret("Second");
    expect(server.holds.at(-1)!.blockId).toBe("block-2");

    await settle(2_000);
    expect(server.saves).toHaveLength(1);
  });

  test("the answer first, then the version: the same", async () => {
    const board = start();
    const server = memoryBoardServer(board, { store });
    const { e, sync, settle } = open(board, server);

    sync.tell({ focused: true });
    e.caret("First line.").type(link);
    await settle();
    const caret = e.state.selection.from;

    sync.tell({ version: structuredClone(server.board) });

    expect(saved(e)).toBe(`First line. ${full}`);
    // The caret stays at the end of the line, where the typing stopped.
    expect(e.state.selection.from).toBe(caret);
    await settle(2_000);
    expect(server.saves).toHaveLength(1);
  });

  test("typing that goes on in the block during its save is kept", async () => {
    const board = start();
    const server = memoryBoardServer(board, { store });
    const { e, sync, settle } = open(board, server);

    server.holdAnswers();
    sync.tell({ focused: true });
    e.caret("First line.").type(link);
    await settle();
    expect(server.saves).toHaveLength(1);

    e.type(" More.");
    sync.tell({ version: structuredClone(server.board) });
    await server.answer();

    expect(saved(e)).toBe(`First line.${link} More.`);

    // Its next save carries it, and takes the server's spelling then.
    await settle();
    sync.tell({ version: structuredClone(server.board) });
    await server.answer();
    sync.tell({ version: structuredClone(server.board) });
    expect(saved(e)).toBe(`First line. ${full} More.`);
  });
});

describe("closing", () => {
  test("saves what was typed, even during a save, then lets go of the board", async () => {
    const { e, sync, server, settle } = open();

    server.holdAnswers();
    e.caret("First line.").type(" One.");
    await settle();
    e.type(" Two.");

    const closed = sync.close();

    await server.answer();
    await settle();
    await server.answer();
    await closed;

    expect(lines(server)[0]).toBe("First line. One. Two.");
    expect(server.holds.at(-1)).toEqual({ blockId: null, open: false });
  });

  test("keeps trying a save that fails, and saves it once it can", async () => {
    const { e, sync, server, settle } = open();

    server.fail(3);
    e.caret("First line.").type(" Mine.");

    const closed = sync.close();

    await settle(10_000);
    await closed;

    expect(lines(server)[0]).toBe("First line. Mine.");
    expect(server.kept).toBeUndefined();
  });

  test("merges a version that refused its save, though no stream reaches it, and saves", async () => {
    const { e, sync, server, settle } = open();

    e.caret("First line.").type(" Mine.");
    server.author((board) => {
      board.document[1]!.markdown = "Theirs.";
    });

    const closed = sync.close();

    await settle(10_000);
    await closed;

    expect(lines(server)).toEqual(["First line. Mine.", "Theirs."]);
  });

  test("still saves on close after saving failed", async () => {
    const { e, sync, server, settle, statuses } = open();

    vi.spyOn(console, "error").mockImplementation(() => {});
    server.fail(4);
    e.caret("First line.").type("!");
    await settle(10_000);
    expect(statuses.at(-1)).toBe("failed");

    const closed = sync.close();

    await settle(10_000);
    await closed;
    expect(lines(server)[0]).toBe("First line.!");
  });

  test("keeps what it couldn't save, and the board brings it back and saves it", async () => {
    const { e, sync, server, settle } = open();

    server.fail(100);
    e.caret("First line.").type(" Mine.");

    const closed = sync.close();

    await settle(15_000);
    await closed;
    expect(markdown(server.kept!.document)[0]).toBe("First line. Mine.");

    server.fail(0);

    const again = open(start(), server);

    expect(again.e.lines[0]).toBe("First line. Mine.");
    await again.settle();
    expect(lines(server)[0]).toBe("First line. Mine.");
  });
  test("merges kept typing onto what came after the close, never replacing it", async () => {
    const { e, sync, server, settle } = open();

    server.fail(100);
    e.caret("First line.").type(" Mine.");

    const closed = sync.close();

    await settle(15_000);
    await closed;
    expect(server.kept!.baseVersion).toBe(3);

    // While it was closed, an agent edited the other block.
    const latest = server.author((board) => {
      board.document[1]!.markdown = "Second line, the agent's.";
    });

    server.fail(0);

    const again = open(latest, server);

    await again.settle();
    expect(lines(server)).toEqual([
      "First line. Mine.",
      "Second line, the agent's.",
    ]);
    // No save went out against a version older than the agent's.
    expect(server.saves.at(-1)!.baseVersion).toBe(latest.version);
  });
});

describe("the window closing", () => {
  test("saves what's typed and waits for it", async () => {
    const { e, server } = open();

    e.caret("First line.").type(" Mine.");

    const shut = server.shutdown();

    await vi.advanceTimersByTimeAsync(0);
    await shut;
    expect(lines(server)[0]).toBe("First line. Mine.");
  });

  test("waits for a board still closing", async () => {
    const { e, sync, server } = open();

    server.fail(2);
    e.caret("First line.").type(" Mine.");

    const closed = sync.close();
    const shut = server.shutdown();

    await vi.advanceTimersByTimeAsync(10_000);
    await shut;
    await closed;
    expect(lines(server)[0]).toBe("First line. Mine.");
  });
});
