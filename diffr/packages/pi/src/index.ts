import { copyToClipboard, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { ansiLines } from "@diffr/consumer/ansi";
import { splitArgs } from "@diffr/consumer/args";
import { PointerInput } from "@diffr/consumer/pointer";
import { openComparison, type Comparison } from "@diffr/consumer/process";
import type { Outcome } from "@diffr/consumer/frame";
import type { Frame } from "@diffr/consumer/protocol";
import { fit } from "@diffr/consumer/paint";
import { Type } from "typebox";
import { opened, openDescription } from "@diffr/consumer/open-tool";
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

  async function open(args: string[], ctx: ExtensionContext, full = false, capture = true, signal?: AbortSignal) {
    if (ctx.mode !== "tui") throw new Error("Diffr requires Pi’s interactive terminal UI.");
    close();
    const id = generation;
    const report = (error: unknown) => ctx.ui.notify(`Diffr: ${error instanceof Error ? error.message : error}`, "error");
    let comparison: Comparison | undefined;
    try {
      comparison = await openComparison({ cwd: ctx.cwd, args,
        binary: pi.getFlag("diffr-bin") as string | undefined, input: pi.getFlag("diffr-input") as string | undefined });
      if (id !== generation) { comparison.dispose(); throw new Error("Diffr open was replaced or closed."); }
      const current = comparison;
      const pointer = new PointerInput();
      let frame: Frame | undefined;
      let layout: ReturnType<typeof mountPane>;
      let closed = false;
      let repaint = () => {};
      const focusChat = () => {
        pointer.reset();
        current.pane.blur();
        layout.focusChat();
      };
      const outcome = async (value: Outcome) => {
        if (value.close) { close(); return; }
        if (value.chat) {
          ctx.ui.pasteToEditor(`\n${value.chat.map(chip => chip.context).join("\n\n")}\n`);
          current.pane.chatted(value.chat.map(chip => chip.name));
          focusChat();
        }
        if (value.copy) {
          try { await copyToClipboard(value.copy.text); current.pane.copied(value.copy.what); }
          catch (error) { current.pane.copied(value.copy.what, String(error)); }
        }
        if (!closed) repaint();
      };
      layout = mountPane(ctx.ui, (terminal, fullscreen) => {
        repaint = () => terminal.requestRender();
        const component: Component = {
        render(width) {
          frame = current.pane.frame({ columns: width, rows: Math.max(1, Math.floor(terminal.terminal.rows * (fullscreen ? 1 : 0.75)) - 1) });
          const label = ` ${fullscreen ? "Floating panel" : "Full screen"} · F6  |  esc chat · q close`;
          return [fit(label, width).padEnd(width), ...ansiLines(frame)];
        },
        invalidate() {},
        handleInput(data) {
          const key = paneKey(data);
          if (!key) return;
          if (key.key === "escape") return focusChat();
          if (key.key === "f6") { void layout.toggle().catch(report); return; }
          void outcome(current.pane.input({ press: key }));
        },
        handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
          if ((event.type === "press" || event.type === "drag") && event.button !== "left") return;
          if (event.y === 0 && event.type === "press") { void layout.toggle().catch(report); return { handled: true, focus: true }; }
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
        return component;
      }, full, capture);
      const unsubscribe = current.pane.subscribe(repaint);
      active = { focus: () => layout.focus(), toggle: () => { void layout.toggle().catch(report); }, close() {
        closed = true; pointer.reset(); unsubscribe(); current.dispose(); layout.dispose();
      } };
      await layout.ready;
      const result = await opened(current, signal);
      if (id !== generation) throw new Error("Diffr open was replaced or closed.");
      return result;
    } catch (error) {
      comparison?.dispose();
      if (id === generation) close();
      throw error;
    }
  }
  const command = async (args: string, ctx: ExtensionContext, full = false) => {
    try { await open(splitArgs(args), ctx, full); }
    catch (error) { ctx.ui.notify(`Diffr: ${error instanceof Error ? error.message : error}`, "error"); }
  };
  pi.registerTool({ name: "diffr_open", label: "Open Diffr", description: openDescription,
    promptSnippet: "Open a comparison in Diffr for the person to review.",
    parameters: Type.Object({ args: Type.Optional(Type.Array(Type.String())) }),
    async execute(_id, params, signal, _update, ctx) {
      const text = await open(params.args ?? [], ctx, false, false, signal);
      return { content: [{ type: "text", text }], details: {} };
    },
  });
  pi.registerCommand("diffr", { description: "Review a comparison in a floating panel", handler: (args, ctx) => command(args, ctx) });
  pi.registerCommand("diffr-fullscreen", { description: "Toggle the full-screen Diffr view", handler: async (args, ctx) => active && !args ? active.toggle() : command(args, ctx, true) });
  pi.registerCommand("diffr-close", { description: "Close the Diffr pane", handler: async () => close() });
  pi.registerShortcut("f7", { description: "Focus or open Diffr", handler: ctx => active ? active.focus() : command("", ctx) });
}
