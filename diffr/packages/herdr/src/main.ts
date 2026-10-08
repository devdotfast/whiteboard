import { BoxRenderable, createCliRenderer, RGBA, StyledText, TextAttributes, TextRenderable, type MouseEvent } from "@opentui/core";
import { openComparison } from "@diffr/consumer/process";
import { PointerInput } from "@diffr/consumer/pointer";
import { terminalKey } from "@diffr/consumer/key";
import type { Frame } from "@diffr/consumer/protocol";
import type { Outcome } from "@diffr/consumer/frame";
import { bindTarget, addToDraft, herdr, type DraftTarget } from "./target";

const socket = process.env.HERDR_SOCKET_PATH;
const self = process.env.HERDR_PANE_ID;
if (!socket || !self) throw new Error("Launch this consumer as a Herdr plugin pane.");
const context = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}");
const api = herdr(socket);
let target: DraftTarget | undefined;
let message = "F6 full screen · esc agent · q close";
try { target = await bindTarget(context.focused_pane_id, self, api.get); }
catch (error) { message = String(error); }
const args = JSON.parse(process.env.DIFFR_ARGS_JSON ?? "[]");
if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new Error("DIFFR_ARGS_JSON must be a JSON array of arguments.");
const comparison = await openComparison({ cwd: context.focused_pane_cwd ?? context.workspace_cwd ?? process.cwd(),
  input: process.env.DIFFR_INPUT, binary: process.env.DIFFR_BIN, args });
const renderer = await createCliRenderer({ useMouse: true, enableMouseMovement: true, exitOnCtrlC: false,
  exitSignals: [], screenMode: "alternate-screen" });
const root = new BoxRenderable(renderer, { id: "diffr", width: "100%", height: "100%", flexDirection: "column" });
renderer.root.add(root);
const toolbar = new TextRenderable(renderer, { id: "toolbar", height: 1, wrapMode: "none", selectable: false });
root.add(toolbar);
let frame: Frame;
const texts: TextRenderable[] = [];
const pointer = new PointerInput();
let closed = false;
let transferring = false;
function paint() {
  if (closed) return;
  frame = comparison.pane.frame({ columns: renderer.width, rows: Math.max(1, renderer.height - 1) });
  toolbar.content = message;
  const colors = frame.colors.map(color => RGBA.fromHex(color));
  while (texts.length > frame.lines.length) texts.pop()!.destroy();
  frame.lines.forEach((line, i) => {
    if (!texts[i]) {
      texts[i] = new TextRenderable(renderer, { id: `line-${i}`, height: 1, flexShrink: 0, wrapMode: "none", selectable: false });
      root.add(texts[i]);
    }
    texts[i].content = new StyledText(line.segments.map(([text, fg, bg, bold]) => ({
      __isChunk: true, text, fg: colors[fg], bg: colors[bg], attributes: bold ? TextAttributes.BOLD : 0,
    })));
  });
  renderer.requestRender();
}
function quit() {
  if (closed) return;
  closed = true;
  unsubscribe(); comparison.dispose(); renderer.destroy();
  process.exit(0);
}
function failed(error: unknown) { message = `Diffr: ${error instanceof Error ? error.message : error}`; paint(); }
async function focusAgent() {
  if (!target) throw new Error("No agent target. Close and reopen Diffr from an agent pane.");
  await api.zoom(self!, "off");
  await api.focus(target.pane_id);
}
async function outcome(value: Outcome) {
  if (value.close) { quit(); return; }
  if (value.chat && !transferring) {
    transferring = true;
    try {
      if (!target) throw new Error("No agent target. Close and reopen Diffr from an agent pane.");
      await addToDraft(target, `\n${value.chat.map(chip => chip.context).join("\n\n")}\n`, api.get, api.send);
      comparison.pane.chatted(value.chat.map(chip => chip.name));
      await focusAgent();
    } catch (error) { failed(error); }
    finally { transferring = false; }
  }
  if (value.copy) comparison.pane.copied(value.copy.what,
    renderer.copyToClipboardOSC52(value.copy.text) ? undefined : "Terminal clipboard unavailable");
}
root.onMouse = (event: MouseEvent) => {
  event.preventDefault(); event.stopPropagation();
  const x = event.x, y = event.y - 1;
  if (event.type === "down" && event.button !== 0) return;
  if (event.type === "down" && y < 0) { void api.zoom(self!, "toggle").catch(failed); return; }
  if (event.type === "scroll") {
    comparison.pane.scroll((event.scroll?.direction === "up" ? -1 : 1) * (event.scroll?.delta ?? 1), x); return;
  }
  const type = event.type === "drag-end" ? "up" : event.type;
  if (type !== "down" && type !== "drag" && type !== "up" && type !== "move") return;
  const next = pointer.read(frame, { type, x, y, alt: event.modifiers.alt });
  if (next.hover !== undefined) comparison.pane.hover(next.hover);
  if (next.input) void outcome(comparison.pane.input(next.input));
};
renderer.keyInput.on("keypress", key => {
  if (key.eventType === "release") return;
  if (key.ctrl && key.name === "c") return quit();
  if (key.name === "f6") { void api.zoom(self!, "toggle").catch(failed); return; }
  if (key.name === "escape") { comparison.pane.blur(); pointer.reset(); void focusAgent().catch(failed); return; }
  void outcome(comparison.pane.input({ press: terminalKey(key) }));
});
const unsubscribe = comparison.pane.subscribe(paint);
renderer.on("resize", paint);
process.on("SIGINT", quit); process.on("SIGTERM", quit); process.on("SIGHUP", quit);
process.on("uncaughtException", error => { renderer.destroy(); comparison.dispose(); console.error(error); process.exit(2); });
process.on("unhandledRejection", error => { renderer.destroy(); comparison.dispose(); console.error(error); process.exit(2); });
paint();
