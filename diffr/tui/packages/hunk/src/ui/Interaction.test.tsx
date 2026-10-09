import {expect, test} from "bun:test";
import {act} from "react";
import {rgbToHex} from "@opentui/core";
import {testRender} from "@opentui/react/test-utils";
import {App} from "./App";
import {DiffStore} from "../diffr/store";
import {createGuideDiffFile, createTestDiffFile, startFor, withIdenticalLines} from "../diffr/fixture";
import {loadBundledTheme} from "../diffr/theme";
import type {DiffEvent, DiffFile} from "../diffr/wire";
const dark = loadBundledTheme("default-dark"), light = loadBundledTheme("default-light");
const themes = {initial: dark, dark, light};
async function publish(store: DiffStore, ...events: DiffEvent[]) {
  await act(async () => { events.forEach(e => store.accept(e)); await new Promise(r => setTimeout(r, 25)); });
}
const path = (file: DiffFile, name: string) => {
  file.file.lhs!.path = file.file.rhs!.path = name;
  return file;
};
test("loading slots animate, skip in either direction, and never steal navigation when a result arrives", async () => {
  const store = new DiffStore();
  const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map(name => path(withIdenticalLines(createTestDiffFile(), 40), name));
  store.accept(startFor(files)); store.accept(files[0]); store.accept(files[3]);
  const t = await testRender(<App store={store} themes={themes} onQuit={() => {}} />, {width:150, height:20});
  const frame = () => t.captureCharFrame();
  const header = () => frame().split("\n")[2].slice(28);
  const clickText = async (text: string) => {
    const lines = frame().split("\n"), y = lines.findIndex(l => l.includes(text));
    expect(y).toBeGreaterThanOrEqual(0);
    await act(async () => { await t.mockMouse.click(lines[y].indexOf(text) + 1, y); });
    await act(async () => { await t.renderOnce(); });
  };
  try {
    await act(async () => { await t.renderOnce(); });
    await clickText("b.ts");
    expect(header()).toContain("b.ts");
    expect(frame()).toContain("Computing diff");
    const before = header();
    await act(async () => { await new Promise(r => setTimeout(r, 100)); await t.renderOnce(); });
    await t.waitForFrame(f => f.split("\n")[2].slice(28) !== before);
    expect(header()).not.toBe(before);
    await clickText("next loaded");
    expect(header()).toContain("d.ts");
    await clickText("b.ts");
    await clickText("previous loaded");
    expect(header()).toContain("a.ts");
    await clickText("b.ts");
    await clickText("d.ts");
    await publish(store, files[1]);
    await act(async () => { await t.renderOnce(); });
    expect(header()).toContain("d.ts");
    // The result for a file being read replaces its own placeholder in place.
    await clickText("c.ts");
    await publish(store, files[2], {type:"complete", succeeded:4, failed:0});
    await act(async () => { await t.renderOnce(); });
    expect(header()).toContain("c.ts");
    expect(frame()).toContain("line 0");
    expect(frame()).not.toContain("Computing diff");
  } finally { await act(async () => { t.renderer.destroy(); }); }
});
test("Paper folds stay under the mouse, pair both sides, accent guides, and survive rapid toggles", async () => {
  const store = new DiffStore(), file = createGuideDiffFile();
  store.accept(startFor([file])); store.accept(file); store.accept({type:"complete", succeeded:1, failed:0});
  const t = await testRender(<App store={store} themes={themes} onQuit={() => {}} />, {width:170, height:25});
  const frame = () => t.captureCharFrame();
  const row = (text: string) => frame().split("\n").findIndex(l => l.includes(text));
  try {
    await act(async () => { await t.renderOnce(); });
    const y = row("if event.open"), x = frame().split("\n")[y].indexOf("▾");
    const accents = () => t.captureSpans().lines.flatMap(l => l.spans).filter(s => /[│┃]/.test(s.text) && rgbToHex(s.fg).toLowerCase() === dark.accent.toLowerCase()).length;
    expect(accents()).toBe(0);
    await act(async () => { await t.mockMouse.moveTo(x, y); await t.renderOnce(); });
    await t.waitFor(() => accents() > 0);
    expect(accents()).toBeGreaterThan(0);
    await act(async () => { await t.mockMouse.moveTo(3, 0); await t.renderOnce(); });
    await t.waitFor(() => accents() === 0);
    expect(accents()).toBe(0);
    await act(async () => { await t.mockMouse.click(x, y); await t.renderOnce(); });
    await t.renderOnce();
    expect(row("if event.open")).toBe(y);
    expect(frame()).not.toContain("open(true)");
    expect(frame()).not.toContain("open();");
    expect(frame().split("\n")[y].match(/⋯ 2 lines/g)).toHaveLength(2);
    // A collapsed body is clickable at its label, on either side.
    const rightLabel = frame().split("\n")[y].lastIndexOf("⋯");
    await act(async () => { await t.mockMouse.click(rightLabel, y); await t.renderOnce(); });
    await t.renderOnce();
    expect(row("if event.open")).toBe(y);
    expect(frame()).toContain("open(true)");
    expect(frame()).toContain("fn other() { ⋯ 2 lines }");
    await act(async () => {
      await t.mockMouse.click(x, y, 0, {delayMs:0});
      await t.mockMouse.click(x, y, 0, {delayMs:0});
      await t.renderOnce();
    });
    await t.waitForFrame(f => f.includes("open(true)"));
    expect(frame()).toContain("open(true)");
  } finally { await act(async () => { t.renderer.destroy(); }); }
});
test("a closed scope's pseudocode stands beside its rail: pointing at it arms the scope, and a click opens it", async () => {
  const store = new DiffStore(), file = createGuideDiffFile();
  if (file.diff.type !== "text") throw new Error();
  for (const source of [file.diff.lhs!, file.diff.rhs!])
    source.root.children[1]!.children[3]!.visibility = {collapsed: true, label: "call one\ncall two"};
  store.accept(startFor([file])); store.accept(file); store.accept({type:"complete", succeeded:1, failed:0});
  const t = await testRender(<App store={store} themes={themes} onQuit={() => {}} />, {width:170, height:25});
  const lines = () => t.captureCharFrame().split("\n");
  try {
    await act(async () => { await t.renderOnce(); });
    const header = lines().findIndex(l => l.includes("fn other() {"));
    expect(lines()[header].slice(0, 40)).toContain("▸");
    const y = lines().findIndex(l => l.includes("call one"));
    expect(lines()[y]).not.toContain("┃");
    await act(async () => { await t.mockMouse.moveTo(lines()[y].indexOf("call one") + 2, y); await t.renderOnce(); });
    await t.waitFor(() => lines()[y].includes("┃") && lines()[y + 1].includes("┃"));
    expect(lines()[y]).toContain("┃");
    await act(async () => { await t.mockMouse.click(lines()[y].indexOf("call one") + 2, y); await t.renderOnce(); });
    await t.waitForFrame(f => f.includes("one();"));
    expect(t.captureCharFrame()).not.toContain("call one");
  } finally { await act(async () => { t.renderer.destroy(); }); }
});
test("pointing at a rail arms that scope, even an outer one, and clicking the rail folds it", async () => {
  const store = new DiffStore(), file = createGuideDiffFile();
  store.accept(startFor([file])); store.accept(file); store.accept({type:"complete", succeeded:1, failed:0});
  const t = await testRender(<App store={store} themes={themes} onQuit={() => {}} />, {width:170, height:25});
  const frame = () => t.captureCharFrame();
  try {
    await act(async () => { await t.renderOnce(); });
    // `open(true)` sits inside impl, fn handle and if; its row crosses all three rails.
    const y = frame().split("\n").findIndex(l => l.includes("open(true)"));
    const row = frame().split("\n")[y], code = row.indexOf("│", row.indexOf(" 4 ") + 3);
    const handleRail = row.indexOf("│", code + 1);
    await act(async () => { await t.mockMouse.moveTo(handleRail, y); await t.renderOnce(); });
    await act(async () => { await t.renderOnce(); });
    // Armed, the fn handle rail thickens; the if rail inside it stays thin.
    expect(frame().split("\n")[y].indexOf("┃")).toBe(handleRail);
    await act(async () => { await t.mockMouse.click(handleRail, y); await t.renderOnce(); });
    await t.waitForFrame(f => f.includes("fn handle(&self) { ⋯ 2 lines · 1 line changed }"));
    expect(frame()).not.toContain("open(true)");
  } finally { await act(async () => { t.renderer.destroy(); }); }
});
test("closing a scrolled file and reopening it starts at its header and first source line", async () => {
  const store = new DiffStore();
  const file = path(withIdenticalLines(createTestDiffFile(), 120), "long.ts");
  store.accept(startFor([file])); store.accept(file); store.accept({type:"complete", succeeded:1, failed:0});
  const t = await testRender(<App store={store} themes={themes} onQuit={() => {}} />, {width:150, height:20});
  try {
    await act(async () => { await t.renderOnce(); });
    await act(async () => { t.mockInput.pressKey("PAGEDOWN"); });
    await act(async () => { await t.renderOnce(); });
    expect(t.captureCharFrame()).not.toContain("line 0 ");
    for (let i = 0; i < 2; i++) {
      await act(async () => { await t.mockMouse.click(40, 2); });
      await act(async () => { await t.renderOnce(); });
    }
    const lines = t.captureCharFrame().split("\n");
    expect(lines[2]).toContain("long.ts");
    expect(lines[3]).toContain("line 0");
  } finally { await act(async () => { t.renderer.destroy(); }); }
});
