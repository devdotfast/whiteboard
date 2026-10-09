/** Exercise the real renderer against a saved stream; keep colored frames for visual review.
 * bun run test/review-smoke.tsx /tmp/comparison.ndjson /tmp/diffr-review
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rgbToHex } from "@opentui/core";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../src/ui/App";
import { DiffStore } from "../src/diffr/store";
import { eventSchema } from "../src/diffr/wire";
import { loadBundledTheme } from "../src/diffr/theme";
const [input, output = "/tmp/diffr-review"] = process.argv.slice(2);
if (!input) throw new Error("Pass a saved NDJSON comparison");
mkdirSync(output, {recursive: true});
const events = readFileSync(input, "utf8").trim().split("\n").map(line => eventSchema.parse(JSON.parse(line)));
const store = new DiffStore();
const dark = loadBundledTheme("default-dark"), light = loadBundledTheme("default-light");
store.accept(events[0]);
const start = performance.now();
const t = await testRender(<App store={store} onQuit={() => {}} themes={{initial: dark, dark, light}} />, {width: 180, height: 44});
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function capture(name: string) {
  await act(async () => { await t.renderOnce(); });
  const frame = t.captureSpans();
  writeFileSync(`${output}/${name}.txt`, t.captureCharFrame());
  const html = frame.lines.map(line => line.spans.map(span =>
    `<span style="color:${rgbToHex(span.fg)};background:${rgbToHex(span.bg)}">${escape(span.text)}</span>`).join("")).join("\n");
  const background = rgbToHex(frame.lines[3].spans[0].bg);
  writeFileSync(`${output}/${name}.html`, `<!doctype html><meta charset="utf-8"><title>${name}</title><style>body{margin:0;background:${background}}pre{font:14px/20px Menlo,monospace;margin:16px;white-space:pre}span{display:inline-block;height:20px;vertical-align:top}</style><pre>${html}</pre>`);
}
async function key(name: string) { await act(async () => { t.mockInput.pressKey(name); }); }
try {
  await capture("01-loading");
  await act(async () => {
    events.slice(1).forEach(event => store.accept(event));
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  await capture("02-loaded");
  const replayMs = Math.round(performance.now() - start);
  for (let i = 0; i < 3; i++) await act(async () => { await t.mockMouse.scroll(100, 15, "down"); });
  await capture("03-scroll");
  await key("z"); await key("R");
  await capture("04-unfold-all");
  const lines = t.captureCharFrame().split("\n");
  const foldY = lines.findIndex((line, y) => y > 2 && line.slice(28).includes("▾"));
  if (foldY >= 0) {
    const x = lines[foldY].indexOf("▾", 28);
    await act(async () => { await t.mockMouse.click(x, foldY); });
    await capture("05-click-fold");
    await act(async () => { await t.mockMouse.click(x, foldY); });
    await capture("06-click-reopen");
  }
  await act(async () => { await t.mockMouse.drag(27, 12, 39, 12); });
  await capture("07-resize-sidebar");
  await key("s"); await capture("08-unified");
  await key("w"); await capture("09-wrap");
  await act(async () => { t.resize(100, 30); });
  await capture("10-narrow");
  await key("t"); await capture("11-light");
  await key("END"); await capture("12-end");
  console.log(JSON.stringify({replayMs, frames: output, files: store.getSnapshot().loaded, errors: store.getSnapshot().errors}));
} finally { await act(async () => { t.renderer.destroy(); }); }
