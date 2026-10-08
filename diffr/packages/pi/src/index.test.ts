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

test("registered Pi tool opens without focus and mouse-selected code appends to an unsent draft", async () => {
  const h = harness();
  const result = await h.tool.execute("call", { args: [] }, undefined, undefined, h.ctx);
  expect(result.content[0].text).toContain("1 changed files");
  expect(h.captures).toEqual([false]);
  const lines = h.component.render(120).map(line => Bun.stripANSI(line));
  const start = lines.findIndex(line => line.includes('throw new Error("missing config")'));
  const end = lines.findIndex(line => line.includes('throw new Error(`missing config'));
  expect(start).toBeGreaterThan(0);
  const mouse = (type: TuiMouseEvent["type"], y: number) => h.component.handleMouse!({
    type, x: lines[y]!.indexOf("throw"), y, screenX: 0, screenY: y, width: 120, height: 30,
    button: "left", shift: false, alt: false, ctrl: false,
  });
  mouse("press", start); mouse("drag", end); mouse("release", end);
  h.component.handleInput!("\r");
  expect(h.draft).toStartWith("Keep my draft.");
  expect(h.draft).toContain("new/migrate.ts");
  expect(h.draft).toContain("missing config");
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
