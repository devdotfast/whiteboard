import { expect, test } from "vitest";
import { stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import diffr from "./index";
import { host } from "../test/host";
import { terminalHost } from "../test/terminal-host";

function harness(h: ReturnType<typeof host> | ReturnType<typeof terminalHost> = host()) {
  let tool: any;
  const events = new Map<string, () => void>();
  const ctx: any = { mode: "tui", cwd: process.cwd(), ui: h.ui };
  diffr({ registerFlag() {}, registerCommand() {}, registerShortcut() {}, on(name: string, fn: () => void) { events.set(name, fn); },
    registerTool(value: any) { tool = value; },
    getFlag(name: string) { if (name === "diffr-input") return fileURLToPath(new URL("../../consumer/test/fixtures/scopes.ndjson", import.meta.url)); },
  } as any);
  return { ctx, events, input: h.input, get component() { return h.widget!; }, get tool() { return tool; },
    get draft() { return h.ui.getEditorText(); }, get submitted() { return h.submitted; } };
}

test.each(["unified", "split"] as const)("Pi %s region selection preserves both sides across redraws and appends to an unsent draft", async layout => {
  const h = harness();
  const result = await h.tool.execute("call", { args: [] }, undefined, undefined, h.ctx);
  expect(result.content[0].text).toContain("1 changed files");
  h.input(" Still writing.");
  expect(h.draft).toContain(" Still writing.");
  h.input("\x1b[18~"); // F7 focuses the diff.
  let lines = h.component.render(360).map(line => stripVTControlCharacters(line));
  if (!lines.some(line => line.includes(`${layout} [s]`))) h.input("s");
  lines = h.component.render(360).map(line => stripVTControlCharacters(line));
  const start = lines.findIndex(line => line.includes("for (const plugin"));
  const middle = lines.findIndex(line => line.includes("Number(plugin.lines)"));
  const end = lines.findIndex(line => line.includes("plugin.enabled"));
  expect(start).toBeGreaterThan(0);
  const mouse = (type: TuiMouseEvent["type"], x: number, y: number) => {
    h.component.handleMouse!({ type, x, y, screenX: x, screenY: y, width: 360, height: 30,
      button: "left", shift: false, alt: false, ctrl: false });
    h.component.render(360);
  };
  const left = lines[start]!.indexOf("for (const plugin");
  const right = lines[end]!.lastIndexOf("plugin.enabled");
  const before = h.draft;
  mouse("press", left, start); mouse("drag", left, middle); mouse("drag", right, end); mouse("release", right, end);
  h.input("\r");
  expect(h.draft).toContain("Keep my draft.");
  expect(h.draft).toContain("-    plugin.lines = Number(plugin.lines);");
  expect(h.draft).toContain("+    plugin.lines = Number(plugin.shape.lines);");
  expect(h.draft).toContain("     plugin.enabled = true;");
  const forward = h.draft;
  h.component.render(360);
  mouse("press", right, end); mouse("drag", right, middle); mouse("drag", left, start); mouse("release", left, start);
  h.input("\r");
  expect(h.draft.slice(forward.length)).toBe(forward.slice(before.length));
  const draft = h.draft;
  h.events.get("session_start")!();
  expect(h.submitted).toBe(0);
  expect(h.draft).toBe(draft);
});

test("headless tool calls report an unavailable UI instead of claiming success", async () => {
  const h = harness();
  h.ctx.mode = "rpc";
  await expect(h.tool.execute("call", {}, undefined, undefined, h.ctx)).rejects.toThrow("interactive terminal");
  expect(h.draft).toBe("Keep my draft.");
});

test("docked folding survives height changes and picker cancellation leaves the draft intact", async () => {
  const h = harness();
  await h.tool.execute("call", {}, undefined, undefined, h.ctx);
  h.input("\x1b[18~");
  const lines = () => h.component.render(180).map(line => stripVTControlCharacters(line));
  expect(lines().some(line => line.includes("plugin.enabled"))).toBe(true);
  h.input("z"); h.input("M");
  expect(lines().some(line => line.includes("plugin.enabled"))).toBe(false);
  h.input("\x1b[17~"); // F6 expands the same comparison.
  expect(lines().some(line => line.includes("plugin.enabled"))).toBe(false);
  h.input("z"); h.input("R");
  expect(lines().some(line => line.includes("plugin.enabled"))).toBe(true);
  const before = h.draft;
  h.input("\x10"); h.input("\x03"); // file picker then cancel
  expect(h.draft).toBe(before);
  const rendered = lines();
  const row = rendered.findIndex(line => line.includes("▌▾"));
  const x = rendered[row]!.indexOf("▌▾") + 1;
  h.component.handleMouse!({ type: "press", x, y: row, screenX: x, screenY: row,
    width: 180, height: 40, button: "left", shift: false, alt: false, ctrl: false });
  expect(lines().some(line => line.includes("plugin.enabled"))).toBe(false);
  h.component.handleMouse!({ type: "press", x, y: row, screenX: x, screenY: row,
    width: 180, height: 40, button: "left", shift: false, alt: false, ctrl: false });
  expect(lines().some(line => line.includes("plugin.enabled"))).toBe(true);
  expect(h.submitted).toBe(0);
  h.events.get("session_start")!();
});


test("real Pi mouse routing returns typing to the draft and preserves caret clicks after selection", async () => {
  const terminal = terminalHost();
  const h = harness(terminal);
  try {
    await h.tool.execute("call", {}, undefined, undefined, h.ctx);
    terminal.tui.renderNow();
    const lines = () => h.component.render(180).map(line => stripVTControlCharacters(line));
    const original = lines();
    const row = original.findIndex(line => line.includes("▾") && line.includes("for (const plugin"));
    expect(row).toBeGreaterThan(0);
    const caret = original[row]!.indexOf("▾");
    const code = original[row]!.indexOf("for (const plugin");
    const bodyRow = original.findIndex(line => line.includes("Number(plugin.lines)"));
    const rail = original[bodyRow]!.lastIndexOf("│");
    terminal.mouse(35, rail + 1, bodyRow); // Motion without a pressed button.
    expect(lines()[bodyRow]![rail]).toBe("┃");
    terminal.mouse(35, code + 12, row);
    expect(lines()[bodyRow]![rail]).toBe("│");
    terminal.click(code, row);
    const editorRow = lines().length + 1;
    terminal.click(3, editorRow);
    const before = h.draft;
    for (const char of "typing") terminal.input(char);
    expect(h.draft).not.toBe(before);
    expect(h.draft).toContain("typing");
    for (let i = 0; i < 4; i++) {
      terminal.click(caret - 1, row);
      expect(lines()[row]).toContain("▸");
      terminal.click(caret + 1, row);
      expect(lines()[row]).toContain("▾");
    }
    terminal.mouse(0, code, row);
    terminal.mouse(32, code + 8, row + 1);
    terminal.mouse(0, code + 8, row + 1, true);
    const selection = lines();
    const bar = selection.findIndex(line => line.includes("Add to chat"));
    expect(bar).toBeGreaterThan(0);
    terminal.click(selection[bar]!.indexOf("Add to chat"), bar);
    expect(h.draft).toContain("diff --git");
    expect(terminal.tui.getFocusedComponent()).toBe(terminal.editor);
    terminal.input("after paste");
    expect(h.draft).toContain("after paste");
    expect(h.submitted).toBe(0);
  } finally { h.events.get("session_shutdown")!(); terminal.stop(); }
});
