import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import diffr from "./index";

function harness() {
  let component!: Component;
  let tool: any;
  let draft = "Keep my draft.";
  let captures: boolean[] = [];
  let closed = 0;
  const events = new Map<string, () => void>();
  const ctx: any = { mode: "tui", cwd: process.cwd(), ui: {
    notify() {}, pasteToEditor(text: string) { draft += text; },
    custom(factory: any, options: any) {
      return new Promise<void>(resolve => {
        component = factory({ terminal: { columns: 120, rows: 40 }, requestRender() {} }, {}, {}, () => { closed++; resolve(); });
        captures.push(!options.overlayOptions.nonCapturing);
        queueMicrotask(() => options.onHandle({ hide() { closed++; }, setHidden() {}, focus() {}, unfocus() {} }));
      });
    },
  } };
  diffr({ registerFlag() {}, registerCommand() {}, registerShortcut() {}, on(name: string, fn: () => void) { events.set(name, fn); },
    registerTool(value: any) { tool = value; },
    getFlag(name: string) { if (name === "diffr-input") return fileURLToPath(new URL("../../claude-code/test/fixtures/scopes.ndjson", import.meta.url)); },
  } as any);
  return { ctx, events, get component() { return component; }, get tool() { return tool; }, get draft() { return draft; }, captures, get closed() { return closed; } };
}

test.each(["unified", "split"] as const)("Pi %s region selection preserves both sides across redraws and appends to an unsent draft", async layout => {
  const h = harness();
  const result = await h.tool.execute("call", { args: [] }, undefined, undefined, h.ctx);
  expect(result.content[0].text).toContain("1 changed files");
  expect(h.captures).toEqual([false]);
  if (layout === "split") { h.component.render(120); h.component.handleInput!("s"); }
  const lines = h.component.render(120).map(line => Bun.stripANSI(line));
  const start = lines.findIndex(line => line.includes("for (const plugin"));
  const middle = lines.findIndex(line => line.includes("Number(plugin.lines)"));
  const end = lines.findIndex(line => line.includes("plugin.enabled"));
  expect(start).toBeGreaterThan(0);
  const mouse = (type: TuiMouseEvent["type"], x: number, y: number) => {
    h.component.handleMouse!({ type, x, y, screenX: x, screenY: y, width: 120, height: 30,
      button: "left", shift: false, alt: false, ctrl: false });
    h.component.render(120);
  };
  mouse("press", 45, start); mouse("drag", 45, middle); mouse("drag", 100, end); mouse("release", 100, end);
  h.component.handleInput!("\r");
  expect(h.draft).toStartWith("Keep my draft.");
  expect(h.draft).toContain("-    plugin.lines = Number(plugin.lines);");
  expect(h.draft).toContain("+    plugin.lines = Number(plugin.shape.lines);");
  expect(h.draft).toContain("     plugin.enabled = true;");
  const forward = h.draft;
  h.component.render(120);
  mouse("press", 100, end); mouse("drag", 100, middle); mouse("drag", 45, start); mouse("release", 45, start);
  h.component.handleInput!("\r");
  expect(h.draft.slice(forward.length)).toBe(forward.slice("Keep my draft.".length));
  // Session replacement closes the view and its producer, without changing the draft.
  const draft = h.draft;
  h.events.get("session_start")!();
  expect(h.closed).toBe(1);
  expect(h.draft).toBe(draft);
});

test("headless tool calls report an unavailable UI instead of claiming success", async () => {
  const h = harness();
  h.ctx.mode = "rpc";
  await expect(h.tool.execute("call", {}, undefined, undefined, h.ctx)).rejects.toThrow("interactive terminal");
  expect(h.captures).toEqual([]);
});
