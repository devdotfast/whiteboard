import { copyToClipboard, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { ansiLines } from "@diffr/consumer/ansi";
import { splitArgs } from "@diffr/consumer/args";
import { PointerInput } from "@diffr/consumer/pointer";
import { openComparison, type Comparison } from "@diffr/consumer/process";
import type { Outcome } from "@diffr/consumer/frame";
import type { Frame } from "@diffr/consumer/protocol";
import { fit } from "@diffr/consumer/paint";
import { mountPane } from "./layout";
import { paneKey } from "./keys";

export default function diffr(pi: ExtensionAPI) {
  let active: { close(): void; focus(): void; toggle(): void } | undefined;
  let generation = 0;
  pi.registerFlag("diffr-input", { description: "Open a saved Diffr NDJSON comparison", type: "string" });
  pi.registerFlag("diffr-bin", { description: "Path to the Diffr executable", type: "string" });
  const close = () => { generation++; active?.close(); active = undefined; };
  pi.on("session_shutdown", close);
  pi.on("session_start", close);

  async function open(args: string, ctx: ExtensionContext, full = false) {
    if (ctx.mode !== "tui") { ctx.ui.notify("Diffr's interactive view requires Pi's terminal UI.", "warning"); return; }
    close();
    const id = generation;
    let comparison: Comparison | undefined;
    try {
      let tui: TUI | undefined;
      ctx.ui.setWidget("diffr-host", host => { tui = host; return { render: () => [], invalidate() {} }; });
      ctx.ui.setWidget("diffr-host", undefined);
      if (!tui) throw new Error("Pi did not provide a terminal surface.");
      const terminal = tui;
      comparison = await openComparison({ cwd: ctx.cwd, args: splitArgs(args),
        binary: pi.getFlag("diffr-bin") as string | undefined, input: pi.getFlag("diffr-input") as string | undefined });
      if (id !== generation) { comparison.dispose(); return; }
      const current = comparison;
      const pointer = new PointerInput();
      let frame: Frame | undefined;
      let layout: ReturnType<typeof mountPane>;
      let closed = false;
      const repaint = () => terminal.requestRender();
      const focusChat = () => {
        pointer.reset();
        current.pane.blur();
        if (terminal.terminal.columns < 100) close();
        else layout.focusChat();
      };
      const outcome = async (value: Outcome) => {
        if (value.close) { close(); return; }
        if (value.chat) {
          ctx.ui.pasteToEditor(`\n${value.chat.map(chip => chip.context).join("\n\n")}\n`);
          current.pane.chatted(value.chat.map(chip => chip.name));
        }
        if (value.copy) {
          try { await copyToClipboard(value.copy.text); current.pane.copied(value.copy.what); }
          catch (error) { current.pane.copied(value.copy.what, String(error)); }
        }
        if (!closed) repaint();
      };
      const component: Component = {
        render(width) {
          frame = current.pane.frame({ columns: width, rows: Math.max(1, terminal.terminal.rows - 1) });
          const label = ` ${layout?.fullscreen ? "Split view" : "Full screen"} · F6  |  esc chat · q close`;
          return [fit(label, width).padEnd(width), ...ansiLines(frame)];
        },
        invalidate() {},
        handleInput(data) {
          const key = paneKey(data);
          if (!key) return;
          if (key.key === "escape") return focusChat();
          if (key.key === "f6") return layout.toggle();
          void outcome(current.pane.input({ press: key }));
        },
        handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
          if ((event.type === "press" || event.type === "drag") && event.button !== "left") return;
          if (event.y === 0 && event.type === "press") { layout.toggle(); return { handled: true, focus: true }; }
          if (!frame) return;
          if (event.type === "wheel") { current.pane.scroll(event.wheelDelta ?? 0, event.x); return { handled: true, render: true }; }
          const type = event.type === "press" ? "down" : event.type === "release" ? "up" : event.type === "click" ? undefined : event.type;
          if (!type) return { handled: true };
          const next = pointer.read(frame, { type, x: event.x, y: event.y - 1, alt: event.alt });
          if (next.hover !== undefined) current.pane.hover(next.hover);
          if (next.input) void outcome(current.pane.input(next.input));
          return { handled: true, capture: type === "down", focus: type === "down", render: true };
        },
      };
      layout = mountPane(terminal, component);
      const unsubscribe = current.pane.subscribe(repaint);
      active = { focus: () => layout.focus(), toggle: () => layout.toggle(), close() {
        closed = true; pointer.reset(); unsubscribe(); current.dispose(); layout.dispose();
      } };
      if (full) layout.toggle();
    } catch (error) {
      comparison?.dispose();
      ctx.ui.notify(`Diffr: ${error instanceof Error ? error.message : error}`, "error");
    }
  }
  pi.registerCommand("diffr", { description: "Review a comparison beside chat", handler: (args, ctx) => open(args, ctx) });
  pi.registerCommand("diffr-fullscreen", { description: "Toggle the full-screen Diffr view", handler: async (args, ctx) => active && !args ? active.toggle() : open(args, ctx, true) });
  pi.registerCommand("diffr-close", { description: "Close the Diffr pane", handler: async () => close() });
  pi.registerShortcut("f7", { description: "Focus or open Diffr", handler: ctx => active ? active.focus() : open("", ctx) });
}
