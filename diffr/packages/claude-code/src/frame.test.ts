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

test("the file header's box and V mark the whole file viewed: it closes, and the tree and the status line say so", async () => {
  const { pane } = await load(scopes);
  const header = () => screen(pane.frame(wide)).find((line) => line.includes("▌"))!;
  expect(header()).toMatch(/\+\d+ −\d+ \[ \] *$/);
  expect(screen(pane.frame(wide)).at(-1)).toContain("0/1 viewed");
  expect(cellAction(pane.frame(wide), "▌", "[ ]")).toEqual({ viewedFile: 0 });
  pane.input({ act: { viewedFile: 0 } });
  expect(header()).toMatch(/\[✓\] *$/);
  expect(header()).not.toMatch(/\+\d+/);
  expect(screen(pane.frame(wide)).some((line) => line.includes("for (const plugin"))).toBe(false);
  expect(screen(pane.frame(wide)).at(-1)).toContain("1/1 viewed");
  pane.input({ press: { key: "V" } });
  expect(header()).toMatch(/\[ \] *$/);
  expect(screen(pane.frame(wide)).some((line) => line.includes("for (const plugin"))).toBe(true);
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

test("the pointer on the header's viewed box puts what a click does beside it", async () => {
  const { pane } = await load(scopes);
  const header = () => screen(pane.frame(wide)).find((line) => line.includes("▌"))!;
  pane.hover({ file: 0, header: true });
  expect(header()).toMatch(/Mark as viewed · V +\[ \] *$/);
  pane.input({ press: { key: "V" } });
  expect(header()).toMatch(/Unmark viewed · V +\[✓\] *$/);
});

test("/ searches from the status line, q included as text; Enter lands on a match and paints it", async () => {
  const { pane } = await load(scopes);
  const type = (...keys: string[]) => keys.forEach((key) => pane.input({ press: { key } }));
  pane.frame(narrow);
  type("/", "q", "u", "a");
  expect(screen(pane.frame(narrow)).at(-1)).toStartWith("/qua▏ · ");
  type("backspace", "backspace", "backspace", "p", "l", "u", "g", "i", "n", "return");
  const status = screen(pane.frame(narrow)).at(-1)!;
  expect(status).toMatch(/^\/plugin · match 1 of \d+ in 1 files · n\/N/);
  const theme = loadBundledTheme("default-dark");
  const frame = pane.frame(narrow);
  const solid = frame.lines.flatMap((line) => line.segments).filter(([, , bg]) => frame.colors[bg] === theme.searchCurrent);
  expect(solid.map(([text]) => text.toLowerCase())).toContain("plugin");
  type("n");
  expect(screen(pane.frame(narrow)).at(-1)).toMatch(/^\/plugin · match 2 of/);
});

test("a narrow pane leads its status line with where the reader is, and swaps the diff for the tree on \\, ⌘B or the button", async () => {
  const { pane } = await load(greet);
  const body = () => screen(pane.frame(narrow)).slice(1, -1);
  expect(screen(pane.frame(narrow)).at(-1)).toStartWith("greet.ts · file 1 of 2 · 0% · 0/2 viewed");
  // No sidebar at this width: the code starts at the left edge.
  expect(body()[0]).toStartWith("▌▾ src/greet.ts");
  expect(cellAction(pane.frame(narrow), "☰ files", "☰")).toEqual({ files: true });
  pane.input({ act: { files: true } });
  expect(body().slice(0, 4).map((line) => line.trimEnd())).toEqual([
    "  ▾ src", expect.stringMatching(/^▸     greet\.ts +\+2 −0$/), "  ▾ tests", expect.stringMatching(/^      greet\.test\.ts +\+1 −0$/)]);
  expect(body().join("\n")).not.toContain("export function");
  pane.input({ press: { key: "j" } });
  pane.input({ press: { key: "j" } });
  pane.input({ press: { key: "return" } });
  expect(body()[0]).toStartWith("▌▸ tests/greet.test.ts");
  expect(screen(pane.frame(narrow)).at(-1)).toStartWith("greet.test.ts · file 2 of 2 · 100%");
  pane.input({ press: { key: "b", meta: true } });
  expect(body()[0]!.trimEnd()).toBe("  ▾ src");
  pane.input({ press: { key: "\\" } });
  expect(body()[0]).toStartWith("▌▸ tests/greet.test.ts");
});

test("Ctrl-P draws a picker over the bottom of the pane; a click on a file goes there and closes it", async () => {
  const { pane } = await load(greet);
  pane.frame(narrow);
  pane.input({ press: { key: "p", ctrl: true } });
  let shown = screen(pane.frame(narrow));
  expect(shown.some((line) => line.trimEnd().endsWith("2 of 2 changed files"))).toBe(true);
  // q is text for the picker, not a way to close the pane.
  expect(pane.input({ press: { key: "q" } })).toEqual({});
  pane.input({ press: { key: "backspace" } });
  for (const key of ["t", "e", "s", "t"]) pane.input({ press: { key } });
  shown = screen(pane.frame(narrow));
  expect(shown.some((line) => line.trimEnd().endsWith("1 of 2 changed files"))).toBe(true);
  // The picker sits at the bottom, below the file's own header in the diff.
  const frame = pane.frame(narrow);
  const y = screen(frame).findLastIndex((line) => line.includes("tests/greet.test.ts"));
  const act = frame.lines[y]!.hits!.find(([from, to]) => 5 >= from && 5 < to)![2];
  expect(act).toEqual({ pick: 1 });
  pane.input({ act });
  shown = screen(pane.frame(narrow));
  expect(shown.some((line) => line.includes("changed files"))).toBe(false);
  expect(shown[1]).toStartWith("▌▾ tests/greet.test.ts");
});
