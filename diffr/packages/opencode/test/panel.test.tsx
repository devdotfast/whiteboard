/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { TextareaRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import type { Context, KeymapCommand, PanelInput, SlotClaim } from "@opencode/plugin/tui/context";
import plugin from "../src/index";

// Exercise real OpenTUI input dispatch and editor content, with only the host panel API replaced.
test.each(["unified", "split"] as const)("%s region drags survive redraws and append both sides to the draft", async layout => {
  const [visible, setVisible] = createSignal(false);
  const [fullscreen, setFullscreen] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  let draft!: TextareaRenderable;
  let renderPanel!: (panel: PanelInput) => any;
  let cleanup: (() => void | Promise<void>) | void = undefined;
  const commands = new Map<string, KeymapCommand>();
  const errors: string[] = [];
  const panel: PanelInput = {
    name: "diffr.review", sessionID: "qa",
    get width() { return 120; },
    get presentation() { return fullscreen() ? "fullscreen" : "panel"; },
    get focused() { return focused(); },
    focus: () => setFocused(true), close: () => setVisible(false),
    toggleFullscreen: () => setFullscreen(value => !value),
  };
  const host = await testRender(() => <box flexDirection="column">
    <textarea ref={draft} height={3} initialValue="KEEP THIS DRAFT" />
    <Show when={visible()}>{renderPanel(panel)}</Show>
  </box>, { width: 120, height: 36 });
  try {
    draft.focus();
    cleanup = await plugin.setup({
      renderer: host.renderer,
      options: { input: new URL("../../claude-code/test/fixtures/scopes.ndjson", import.meta.url).pathname },
      location: { directory: process.cwd() },
      theme: { background: { base: "#000000" } },
      ui: {
        dialog: { clear() {} }, toast: { show(value: { message: string }) { errors.push(value.message); } },
        router: { current: () => ({ type: "session", sessionID: "qa" }) },
        slot(claim: SlotClaim) { renderPanel = claim.render as typeof renderPanel; return () => {}; },
        panel: {
          open(_name: string, options?: { presentation?: string }) {
            setFullscreen(options?.presentation === "fullscreen"); setVisible(true); setFocused(true); return true;
          },
          close() { setVisible(false); setFocused(false); draft.focus(); },
          current() { return visible() ? { name: "diffr.review", sessionID: "qa" } : undefined; },
        },
      },
      keymap: {
        layer(factory: () => { commands: KeymapCommand[] }) { for (const command of factory().commands) commands.set(command.id!, command); },
        dispatch(id: string) { if (id === "pane.focus.left") { setFocused(false); draft.focus(); } },
      },
      client: { rpc: () => ({ events: { on: () => () => {} } }) },
    } as unknown as Context);
    commands.get("diffr.open")!.run();
    await host.waitForFrame(frame => frame.includes("missing config"));
    host.mockInput.pressKey("F6");
    await host.flush();
    expect(fullscreen()).toBe(true);
    if (layout === "split") { host.mockInput.pressKey("s"); await host.flush(); }
    const rows = host.captureCharFrame().split("\n");
    const start = rows.findIndex(row => row.includes("for (const plugin"));
    const middle = rows.findIndex(row => row.includes("Number(plugin.lines)"));
    const end = rows.findIndex(row => row.includes("plugin.enabled"));
    expect(start).toBeGreaterThan(0);
    // Real drags span rendered frames. Keep the button down across redraws.
    await host.mockMouse.pressDown(45, start);
    await host.flush();
    await host.mockMouse.emitMouseEvent("drag", 45, middle);
    await host.flush();
    await host.mockMouse.emitMouseEvent("drag", 100, end);
    await host.flush();
    await host.mockMouse.release(100, end);
    await host.flush();
    expect(host.captureCharFrame()).toContain("Add to chat");
    host.mockInput.pressEnter();
    await host.flush();
    expect(draft.plainText).toStartWith("KEEP THIS DRAFT\n");
    expect(draft.plainText).toContain("-    plugin.lines = Number(plugin.lines);");
    expect(draft.plainText).toContain("+    plugin.lines = Number(plugin.shape.lines);");
    expect(draft.plainText).toContain("     plugin.enabled = true;");
    expect(visible()).toBe(false);
    expect(draft.focused).toBe(true);
    commands.get("diffr.open")!.run();
    await host.flush();
    expect(host.captureCharFrame()).toContain("Added");
    // The same region dragged in reverse must produce the same patch, including both sides.
    const firstDraft = draft.plainText;
    const expected = firstDraft.slice("KEEP THIS DRAFT".length);
    commands.get("diffr.focus")!.run();
    await host.flush();
    await host.mockMouse.pressDown(100, end);
    await host.flush();
    await host.mockMouse.emitMouseEvent("drag", 100, middle);
    await host.flush();
    await host.mockMouse.emitMouseEvent("drag", 45, start);
    await host.flush();
    await host.mockMouse.release(45, start);
    host.mockInput.pressEnter();
    await host.flush();
    expect(draft.plainText.slice(firstDraft.length)).toBe(expected);
    expect(errors).toEqual([]);
  } finally { await cleanup?.(); host.renderer.destroy(); }
}, 10000);
