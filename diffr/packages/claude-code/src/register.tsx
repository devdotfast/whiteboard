import type { EngineInterface, On, PluginOptions } from "claude-code";
import { paletteFromHelix, themeConfig, type Palette } from "@diffr/viewer/theme/palette";
import { loadBundledTheme, parseHelixTheme } from "@diffr/viewer/theme/themes";
import { DiffStore } from "@diffr/viewer/protocol/store";
import { parseDiffEvents } from "@diffr/viewer/protocol/events";
import { splitArgs } from "./args";
import { parsePost } from "./protocol";
import { Pane } from "./frame";

const PANE = "diffr";
/** Lines per view instance. Claude Code caps each instance's element tree, and one highlighted
 * line can take over a thousand characters. */
const BAND = 16;

/** Use diffr's configured theme, as the TUI does. */
async function loadTheme($: EngineInterface, binary: string): Promise<Palette> {
  const shown = await $.process.run([binary, "config", "show", "--json"]);
  if (shown.exitCode !== 0) throw new Error(shown.stderr || `${binary} config show exited with status ${shown.exitCode}`);
  const config = themeConfig(JSON.parse(shown.stdout));
  return config.path
    ? paletteFromHelix(parseHelixTheme(await $.fs.read(config.path), config.path))
    : loadBundledTheme(config.name);
}

async function pump(store: DiffStore, child: ReturnType<EngineInterface["process"]["spawn"]>) {
  let stderr = "";
  // Chunks are decoded text, split at arbitrary points.
  async function* stdout() {
    for await (const chunk of child) {
      if (chunk.stream === "stdout") yield chunk.text;
      else stderr = (stderr + chunk.text).slice(-16384);
    }
  }
  try {
    for await (const event of parseDiffEvents(stdout())) store.accept(event);
  } catch (error) {
    store.fail(stderr ? `${error}\n${stderr}` : error);
  }
}

// Must stay a function declaration: Claude Code finds `register` in the source.
export function register(on: On, options: PluginOptions): void {
  const binary = options.diffr;
  if (typeof binary !== "string") throw new Error(`The diffr option must be a string, not ${typeof binary}`);
  let pane: Pane | undefined;
  let child: ReturnType<EngineInterface["process"]["spawn"]> | undefined;
  /** The last handled seq per view instance (see `Post`). */
  const acks = new Map<string, number>();

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "diffr",
      description: "Review a diff with diffr",
      argumentHint: "[revisions or paths, as for diffr]",
    });
    return next(e);
  });

  on("command.run", { command: "diffr" }, async ($, e) => {
    const args = splitArgs(e.args);
    let theme: Palette;
    try {
      theme = await loadTheme($, binary);
    } catch (error) {
      return { text: `diffr could not start: ${error instanceof Error ? error.message : String(error)}` };
    }
    void child?.return({ code: null, signal: null });
    const store = new DiffStore();
    pane = new Pane(store, theme);
    pane.subscribe(() => $.ui.invalidate("ui.render"));
    child = $.process.spawn({ argv: [binary, "--format", "ndjson", "--syntax", ...args] });
    void pump(store, child);
    // A pane width the user set overrides this.
    await $.ui.open({ id: PANE, title: ["diffr", ...args].join(" "), focus: true,
      columns: Math.floor(e.presentation.columns * 0.6) });
    return { text: `Opened diffr ${e.args} in a pane.`.replace("  ", " ") };
  });

  on("ui.render", { component: "Pane", requestId: "diffr" }, async ($, e) => {
    if (e.surface !== "terminal" && e.surface !== "desktop") {
      const { Text } = $.ui.resolve(e);
      return <Text dimColor>The diffr pane draws in the terminal and the desktop app.</Text>;
    }
    const { Box, Text, Client } = $.ui.resolve(e);
    if (!pane) return <Text dimColor>Run /diffr to open a comparison.</Text>;
    const columns = e.props.bodyColumns, rows = e.props.scroll.bodyRows;
    const frame = pane.frame({ columns, rows });
    const bands = Array.from({ length: Math.ceil(frame.lines.length / BAND) }, (_, i) =>
      frame.lines.slice(i * BAND, (i + 1) * BAND));
    return (
      <Box flexDirection="column" width={columns}>
        {bands.map((lines, i) => (
          <Client key={`diff-${i}`} module="./view.js" props={{ ...frame, lines, acks: Object.fromEntries(acks) }}
            width={columns} height={lines.length} />
        ))}
      </Box>
    );
  });

  on("ui.message", async ($, e) => {
    if (e.requestId !== PANE || !pane) return {};
    const post = parsePost(e.data);
    if (post.hover !== undefined) pane.hover(post.hover);
    for (const [seq, input] of post.inputs) {
      if (seq <= (acks.get(post.instance) ?? 0)) continue;
      acks.set(post.instance, seq);
      if (pane.input(input)) {
        await $.ui.close({ id: PANE });
        return {};
      }
    }
    // Redraw every band, not just the one that posted.
    $.ui.invalidate("ui.render");
    return {};
  });

  // The frame fills the pane, so the engine never scrolls it; scroll the viewer instead.
  on("ui.scroll", { requestId: "diffr" }, async ($, e) => {
    if (!pane) return {};
    pane.scroll(e.by, e.pointer?.column);
    $.ui.invalidate("ui.render");
    return {};
  });
}
