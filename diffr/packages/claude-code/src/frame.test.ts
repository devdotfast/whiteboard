import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDiffEvents } from "@diffr/viewer/protocol/events";
import { DiffStore } from "@diffr/viewer/protocol/store";
import { measureTextWidth } from "@diffr/viewer/terminal/text";
import type { Action, Frame, Line } from "./protocol";
import { loadBundledTheme } from "@diffr/viewer/theme/themes";
import type { Size } from "@diffr/viewer/viewer";
import { Pane } from "./frame";

/** Two files: src/greet.ts, open, and tests/greet.test.ts, hidden as a test file. */
const greet = readFileSync(`${import.meta.dir}/../../tui/test/fixtures/comparison.ndjson`, "utf8");
/** One TypeScript file with nested scopes and a context gap. */
const scopes = readFileSync(`${import.meta.dir}/../test/fixtures/scopes.ndjson`, "utf8");

async function load(ndjson: string) {
  const store = new DiffStore();
  async function* once() {
    yield ndjson;
  }
  for await (const event of parseDiffEvents(once())) store.accept(event);
  return { store, pane: new Pane(store, loadBundledTheme("default-dark")) };
}

const text = (line: Line) => line.segments.map(([text]) => text).join("");
const screen = (frame: Frame) => frame.lines.map(text);
function target(frame: Frame, matches: (act: Action) => boolean) {
  for (const line of frame.lines)
    for (const [, , act] of line.hits ?? []) if (matches(act)) return act;
}
/** What a click on the first `glyph` of the line showing `content` does. */
function cellAction(frame: Frame, content: string, glyph: string): Action {
  const y = screen(frame).findIndex((line) => line.includes(content));
  const x = screen(frame)[y]!.indexOf(glyph);
  const hit = frame.lines[y]!.hits!.find(([from, to]) => x >= from && x < to);
  if (!hit) throw new Error(`Nothing to click at ${glyph} on ${content}`);
  return hit[2];
}
const narrow: Size = { columns: 90, rows: 24 };
const wide: Size = { columns: 140, rows: 24 };

test("every line fills the pane exactly, whatever its size", async () => {
  const { pane } = await load(scopes);
  for (const size of [{ columns: 40, rows: 6 }, narrow, wide, { columns: 200, rows: 60 }]) {
    const frame = pane.frame(size);
    expect(frame.lines).toHaveLength(size.rows);
    for (const line of frame.lines) expect(measureTextWidth(text(line))).toBe(size.columns);
  }
});

test("clicking a scope's chevron folds it into its opener, and clicking again opens it", async () => {
  const { pane } = await load(scopes);
  const before = screen(pane.frame(narrow));
  const act = cellAction(pane.frame(narrow), "for (const plugin", "▾");
  pane.input({ act });
  const folded = screen(pane.frame(narrow));
  expect(folded.some((line) => line.includes("plugin.enabled"))).toBe(false);
  expect(folded.find((line) => line.includes("for (const plugin"))).toContain("⋯");
  pane.input({ act });
  expect(screen(pane.frame(narrow))).toEqual(before);
});

test("the file tree shows on wide panes, and backslash hides and shows it", async () => {
  const { pane } = await load(greet);
  const treeShown = () => target(pane.frame(wide), (act) => "jump" in act) !== undefined;
  expect(target(pane.frame(narrow), (act) => "jump" in act)).toBeUndefined();
  expect(treeShown()).toBe(true);
  pane.input({ press: { key: "\\" } });
  expect(treeShown()).toBe(false);
  pane.input({ press: { key: "\\" } });
  expect(treeShown()).toBe(true);
});

test("a scope's viewed box marks it and folds it; the file header's box and V mark the whole file", async () => {
  const { pane } = await load(scopes);
  const header = (frame: Frame) => screen(frame).find((line) => line.includes("▌"))!;
  expect(header(pane.frame(wide))).toContain("[ ]");
  // The pointer on a scope makes it current: its header line ends in what's left and a box.
  const fold = cellAction(pane.frame(wide), "for (const plugin", "▾");
  if (!("fold" in fold)) throw new Error("Expected the scope's chevron");
  pane.hover({ file: fold.file, id: fold.fold, armed: false });
  const scope = screen(pane.frame(wide)).find((line) => line.includes("for (const plugin"))!;
  expect(scope).toMatch(/\+\d+.* \[ \] *$/);
  const box = cellAction(pane.frame(wide), "for (const plugin", "[ ]");
  expect(box).toEqual({ viewed: fold.fold, file: fold.file });
  pane.input({ act: box });
  const marked = screen(pane.frame(wide));
  expect(marked.some((line) => line.includes("plugin.enabled"))).toBe(false);
  expect(marked.find((line) => line.includes("for (const plugin"))).toContain("✓");
  expect(header(pane.frame(wide))).toMatch(/\[-\]|\[✓\]/);
  pane.hover(null);
  pane.input({ press: { key: "V" } });
  expect(header(pane.frame(wide))).toContain("[✓]");
  expect(screen(pane.frame(wide)).at(-1)).toContain("1/1 viewed");
  expect(cellAction(pane.frame(wide), "▌", "[✓]")).toEqual({ viewedFile: 0 });
  pane.input({ act: { viewedFile: 0 } });
  expect(header(pane.frame(wide))).toContain("[ ]");
  expect(screen(pane.frame(wide)).at(-1)).toContain("0/1 viewed");
});

test("a drag across code lines selects them on one side; y copies them and Y copies a reference for an agent", async () => {
  const { pane } = await load(scopes);
  const at = (frame: Frame, content: string) => {
    const y = screen(frame).findIndex((line) => line.includes(content));
    // The second occurrence is the head side of the split.
    return { y, x: screen(frame)[y]!.lastIndexOf(content) };
  };
  const start = at(pane.frame(wide), "for (const plugin");
  pane.input({ select: start });
  const end = at(pane.frame(wide), "plugin.enabled");
  pane.input({ select: { ...end, extend: true } });
  // A selection keeps to one side: the head's lines in the drag light up, the deleted line between them doesn't.
  const highlight = loadBundledTheme("default-dark").highlight;
  const frame = pane.frame(wide);
  const lit = (content: string) => frame.lines[screen(frame).findIndex((line) => line.includes(content))]!
    .segments.some(([, , bg]) => frame.colors[bg] === highlight);
  expect(["for (const plugin", "Number(plugin.shape.lines)", "plugin.enabled"].map(lit)).toEqual([true, true, true]);
  expect(lit("Number(plugin.lines)")).toBe(false);
  const raw = pane.input({ press: { key: "y" } }).copy!;
  expect(raw.what).toBe("source lines");
  expect(raw.text.split("\n")[0]).toContain("for (const plugin");
  expect(raw.text).toContain("plugin.enabled");
  const forAgent = pane.input({ press: { key: "Y" } }).copy!;
  expect(forAgent.what).toBe("for agent");
  expect(forAgent.text).toMatch(/^\S+:\d+-\d+( at .+| in the git index \(staged\))?\n```/);
  expect(forAgent.text).toContain(raw.text);
  pane.copied("for agent");
  expect(screen(pane.frame(wide)).at(-1)).toStartWith("Copied for agent");
  pane.copied("for agent", "no-clipboard");
  expect(screen(pane.frame(wide)).at(-1)).toStartWith("Not copied: no-clipboard");
});

test("y with nothing selected says how to select, and copies nothing", async () => {
  const { pane } = await load(scopes);
  pane.frame(wide);
  expect(pane.input({ press: { key: "y" } })).toEqual({});
  expect(screen(pane.frame(wide)).at(-1)).toStartWith("Drag across lines to select them first");
});

test("the pointer on a viewed box puts what a click does beside it", async () => {
  const { pane } = await load(scopes);
  const fold = cellAction(pane.frame(wide), "for (const plugin", "▾");
  if (!("fold" in fold)) throw new Error("Expected the scope's chevron");
  pane.hover({ file: fold.file, id: fold.fold, armed: false, box: true });
  const scope = screen(pane.frame(wide)).find((line) => line.includes("for (const plugin"))!;
  expect(scope).toMatch(/Mark as viewed · v +\[ \] *$/);
  pane.hover({ file: 0, header: true });
  expect(screen(pane.frame(wide)).find((line) => line.includes("▌"))).toMatch(/Mark as viewed · V +\[ \] *$/);
  pane.input({ press: { key: "V" } });
  expect(screen(pane.frame(wide)).find((line) => line.includes("▌"))).toMatch(/Unmark viewed · V +\[✓\] *$/);
});
