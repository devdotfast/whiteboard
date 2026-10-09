import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { parseDiffEvents } from "@diffr/viewer/protocol/events";
import { DiffStore } from "@diffr/viewer/protocol/store";
import { measureTextWidth } from "@diffr/viewer/terminal/text";
import type { Action, Frame, Line } from "./protocol";
import { loadBundledTheme } from "@diffr/viewer/theme/themes";
import type { Size } from "@diffr/viewer/viewer";
import { Pane } from "./frame";

/** Two files: src/greet.ts, open, and tests/greet.test.ts, hidden as a test file. */
const greet = readFileSync(`${import.meta.dirname}/../../tui/test/fixtures/comparison.ndjson`, "utf8");
/** One TypeScript file with nested scopes and a context gap. */
const scopes = readFileSync(`${import.meta.dirname}/../test/fixtures/scopes.ndjson`, "utf8");

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

test("a unified drag selects every row it crosses, removed and added; y copies the new lines and Y a patch", async () => {
  const { pane } = await load(scopes);
  const at = (frame: Frame, content: string) => {
    const y = screen(frame).findIndex((line) => line.includes(content));
    return { y, x: screen(frame)[y]!.lastIndexOf(content) };
  };
  pane.input({ select: at(pane.frame(wide), "for (const plugin") });
  pane.input({ select: { ...at(pane.frame(wide), "plugin.enabled"), extend: true } });
  const highlight = loadBundledTheme("default-dark").highlight;
  const lit = (frame: Frame, content: string) => frame.lines[screen(frame).findIndex((line) => line.includes(content))]!
    .segments.some(([, , bg]) => frame.colors[bg] === highlight);
  const frame = pane.frame(wide);
  expect(["for (const plugin", "Number(plugin.lines)", "Number(plugin.shape.lines)", "plugin.enabled"].map((content) => lit(frame, content)))
    .toEqual([true, true, true, true]);
  const raw = pane.input({ press: { key: "y" } }).copy!;
  expect(raw.what).toBe("source lines");
  expect(raw.text).toBe("  for (const plugin of config.plugins) {\n    plugin.lines = Number(plugin.shape.lines);\n    plugin.enabled = true;");
  const forAgent = pane.input({ press: { key: "Y" } }).copy!;
  expect(forAgent.what).toBe("for agent");
  expect(forAgent.text).toMatch(/^Base: .+\nHead: .+\n\ndiff --git a\/old\/migrate\.ts b\/new\/migrate\.ts\n--- a\/old\/migrate\.ts\n\+\+\+ b\/new\/migrate\.ts\n@@ -6,3 \+6,3 @@\n /);
  expect(forAgent.text).toContain("\n-    plugin.lines = Number(plugin.lines);\n+    plugin.lines = Number(plugin.shape.lines);\n     plugin.enabled = true;\n");
  pane.copied("for agent");
  expect(screen(pane.frame(wide)).at(-1)!.trim()).toContain("Copied for agent");
  pane.copied("for agent", "no-clipboard");
  expect(screen(pane.frame(wide)).at(-1)!.trim()).toContain("Not copied: no-clipboard");
});

test("in split, a drag kept to one column selects that version's lines; one that crosses takes both", async () => {
  const { pane } = await load(scopes);
  const split: Size = wide;
  pane.frame(split);
  pane.input({ press: { key: "s" } });
  expect(screen(pane.frame(split))[0]).toContain("split [s]");
  const at = (content: string, nth: "first" | "last") => {
    const frame = pane.frame(split);
    const y = screen(frame).findIndex((line) => line.includes(content));
    return { y, x: nth === "first" ? screen(frame)[y]!.indexOf(content) : screen(frame)[y]!.lastIndexOf(content) };
  };
  const highlight = loadBundledTheme("default-dark").highlight;
  const litHalves = (content: string) => {
    const frame = pane.frame(split);
    const line = frame.lines[screen(frame).findIndex((each) => each.includes(content))]!;
    let x = 0;
    const halves = new Set<string>();
    // The halves' divider is the last │ before a line number; indent guides are │ too, but before code.
    const divider = [...text(line).matchAll(/│ +\d+ /g)].at(-1)!.index;
    for (const [segment, , bg] of line.segments) {
      if (frame.colors[bg] === highlight) halves.add(x < divider ? "left" : "right");
      x += measureTextWidth(segment);
    }
    return [...halves].sort();
  };
  pane.input({ select: at("for (const plugin", "last") });
  pane.input({ select: { ...at("plugin.enabled", "last"), extend: true } });
  expect(litHalves("Number(plugin.shape.lines)")).toEqual(["right"]);
  expect(pane.input({ press: { key: "Y" } }).copy!.text).toContain("+    plugin.lines = Number(plugin.shape.lines);\n");
  pane.input({ select: at("Number(plugin.lines)", "first") });
  pane.input({ select: { ...at("plugin.enabled", "last"), extend: true } });
  expect(litHalves("Number(plugin.lines)")).toEqual(["left", "right"]);
  expect(pane.input({ press: { key: "Y" } }).copy!.text).toContain("-    plugin.lines = Number(plugin.lines);\n+    plugin.lines = Number(plugin.shape.lines);\n");
});

test("while lines are selected the status line is a bright bar naming them, with a button and Enter to add them to the chat", async () => {
  const { pane } = await load(scopes);
  const at = (frame: Frame, content: string) => {
    const y = screen(frame).findIndex((line) => line.includes(content));
    return { y, x: screen(frame)[y]!.lastIndexOf(content) };
  };
  const select = () => {
    pane.input({ select: at(pane.frame(wide), "for (const plugin") });
    pane.input({ select: { ...at(pane.frame(wide), "plugin.enabled"), extend: true } });
  };
  const status = () => pane.frame(wide).lines.at(-1)!;
  expect(text(status())).not.toContain("Add to chat");
  select();
  expect(target(pane.frame(wide), (act) => "chat" in act)).toEqual({ chat: true });

  const chat = pane.input({ press: { key: "return" } }).chat!;
  expect(chat).toHaveLength(1);
  expect(chat[0]!.name).toBe("new/migrate.ts:L6-R8");
  expect(chat[0]!.context).toContain("diff --git a/old/migrate.ts b/new/migrate.ts\n");
  expect(chat[0]!.context).toContain("for (const plugin");
  expect(chat[0]!.context).toContain("plugin.enabled");
  pane.chatted([chat[0]!.name]);
  expect(text(status())).toContain(`Added ${chat[0]!.name} to the chat · esc to type`);

  select();
  expect(pane.input({ act: { chat: true } }).chat).toEqual(chat);
  select();
  expect(pane.input({ press: { key: "l", meta: true } }).chat).toEqual(chat);
  select();
  pane.blur();
  expect(text(status())).not.toContain("Add to chat");
  expect(pane.input({ press: { key: "return" } }).chat).toBeUndefined();
});

test("a narrow pane leads its status line with where the reader is, and swaps the diff for the tree on \\, ⌘B or the button", async () => {
  const { pane } = await load(greet);
  const body = () => screen(pane.frame(narrow)).slice(1, -1);
  expect(body()[0]).toContain("▌▾ src/greet.ts");
  expect(cellAction(pane.frame(narrow), "☰ files", "☰")).toEqual({ files: true });
  pane.input({ act: { files: true } });
  expect(body().join("\n")).not.toContain("export function");
  pane.input({ press: { key: "j" } });
  pane.input({ press: { key: "j" } });
  pane.input({ press: { key: "return" } });
  expect(body()[0]).toContain("▌▸ tests/greet.test.ts");
  pane.input({ press: { key: "b", meta: true } });
  expect(body()[0]!.trimEnd()).toBe("  ▾ src");
  pane.input({ press: { key: "\\" } });
  expect(body()[0]).toContain("▌▸ tests/greet.test.ts");
});
