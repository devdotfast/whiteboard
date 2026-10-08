import type { EngineInterface, On, PluginOptions } from "claude-code";
import { paletteFromHelix, themeConfig, type Palette } from "@diffr/viewer/theme/palette";
import { loadBundledTheme, parseHelixTheme } from "@diffr/viewer/theme/themes";
import { DiffStore } from "@diffr/viewer/protocol/store";
import { parseDiffEvents } from "@diffr/viewer/protocol/events";
import { splitArgs } from "./args";
import { parsePost } from "./protocol";
import { Pane } from "./frame";

const PANE = "diffr";
/** The tool the model calls to open the pane: `mcp__<plugin>__<name>`. */
const TOOL = "mcp__diffr__open";
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

/** The tool's arguments: diffr's own, as a list, so nothing needs shell quoting. */
function toolArgs(input: Record<string, unknown>): string[] {
  const args = input.args ?? [];
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string"))
    throw new Error("args must be a list of strings: revisions or paths, as diffr takes them");
  return args;
}

/** What the model reads back: the comparison and how many files changed, or why diffr named none. */
function summary(args: string[], store: DiffStore): string {
  const snapshot = store.getSnapshot();
  const shown = `diffr${args.length ? ` ${args.join(" ")}` : ""}`;
  if (!snapshot.comparison) throw new Error(`${shown} failed: ${snapshot.errors.join("; ") || "it named no comparison"}`);
  const files = snapshot.inventory.length;
  return `Opened ${shown} in a pane for the person: ${files} changed ${files === 1 ? "file" : "files"}.`;
}

/**
 * Settles once diffr has named the comparison, its first record and nearly immediate, or once its
 * stream has ended without one. The open tool waits this long and no longer: a bad revision still
 * comes back as an error, and the person reads on while the model carries on.
 */
function named(store: DiffStore, streamed: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const stop = store.subscribe(() => {
      if (store.getSnapshot().comparison) done();
    });
    const done = () => {
      stop();
      resolve();
    };
    if (store.getSnapshot().comparison) done();
    void streamed.then(done);
  });
}

type Child = ReturnType<EngineInterface["process"]["spawn"]>;

/**
 * Runs diffr on `args` for a new pane, stopping the one before: the pane, its child, its store, and
 * a promise that settles when diffr's stream ends. Rejects when diffr's config can't be read.
 */
async function startDiffr($: EngineInterface, binary: string, previous: Child | undefined, args: string[]) {
  const theme = await loadTheme($, binary);
  void previous?.return({ code: null, signal: null });
  const store = new DiffStore();
  const pane = new Pane(store, theme);
  pane.subscribe(() => $.ui.invalidate("ui.render"));
  const child = $.process.spawn({ argv: [binary, "--format", "ndjson", "--syntax", ...args] });
  return { pane, child, store, streamed: pump(store, child) };
}

async function pump(store: DiffStore, child: Child) {
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
  let child: Child | undefined;
  /** Whether the pane had the keyboard when it was last drawn. */
  let focused = false;
  /** The last handled seq per view instance (see `Post`). */
  const acks = new Map<string, number>();

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "diffr",
      description: "Review a diff with diffr",
      argumentHint: "[revisions or paths, as for diffr]",
    });
    await $.tool.register({
      name: "open",
      description: "Open diffr's review pane for the person, showing a comparison they can read, fold, search and mark viewed. " +
        "Use it to show them changes you made or want them to review, rather than describing the diff. " +
        "args are diffr's own: revisions or paths, e.g. [\"HEAD~1\"], [\"main..HEAD\", \"--\", \"src\"], or [] for uncommitted changes. " +
        "Replaces any diffr pane already open, and leaves the person's focus where it is. Returns as soon as diffr has named the comparison, with how many files changed; the person reads on while you carry on.",
      inputSchema: {
        type: "object",
        properties: { args: { type: "array", items: { type: "string" }, description: "diffr's arguments, one per item" } },
      },
      isDeferred: false,
    });
    return next(e);
  });

  on("command.run", { command: "diffr" }, async ($, e) => {
    const args = splitArgs(e.args);
    let started: Awaited<ReturnType<typeof startDiffr>>;
    try {
      started = await startDiffr($, binary, child, args);
    } catch (error) {
      return { text: `diffr could not start: ${error instanceof Error ? error.message : String(error)}` };
    }
    ({ pane, child } = started);
    // A pane width the user set overrides this.
    await $.ui.open({ id: PANE, title: ["diffr", ...args].join(" "), focus: true, columns: Math.floor(e.presentation.columns * 0.6) });
    return { text: `Opened diffr ${e.args} in a pane.`.replace("  ", " ") };
  });

  on("tool.call", { tool: TOOL }, async ($, e) => {
    // A diffr that can't start, or names no comparison, is the call's answer: the model reads it as an error.
    const refuse = (error: unknown) => ({ deny: error instanceof Error ? error.message : String(error) });
    let args: string[], started: Awaited<ReturnType<typeof startDiffr>>;
    try {
      args = toolArgs(e);
      started = await startDiffr($, binary, child, args);
    } catch (error) {
      return refuse(error);
    }
    ({ pane, child } = started);
    // The person may be typing, so the pane opens without taking the keyboard.
    await $.ui.open({ id: PANE, title: ["diffr", ...args].join(" ") });
    await named(started.store, started.streamed);
    try {
      return { result: summary(args, started.store) };
    } catch (error) {
      return refuse(error);
    }
  });

  on("ui.render", { component: "Pane", requestId: "diffr" }, async ($, e) => {
    if (e.surface !== "terminal" && e.surface !== "desktop") {
      const { Text } = $.ui.resolve(e);
      return <Text dimColor>The diffr pane draws in the terminal and the desktop app.</Text>;
    }
    const { Box, Text, Client } = $.ui.resolve(e);
    if (!pane) return <Text dimColor>Run /diffr to open a comparison.</Text>;
    // Escape takes the keyboard from the pane without reaching it; a click elsewhere does too.
    if (focused && !e.props.isFocused) pane.blur();
    focused = e.props.isFocused;
    const columns = e.props.bodyColumns, rows = e.props.scroll.bodyRows;
    const frame = pane.frame({ columns, rows });
    const bands = Array.from({ length: Math.ceil(frame.lines.length / BAND) }, (_, i) =>
      frame.lines.slice(i * BAND, (i + 1) * BAND));
    return (
      <Box flexDirection="column" width={columns}>
        {bands.map((lines, i) => (
          <Client key={`diff-${i}`} module="./view.js" props={{ ...frame, lines, offset: i * BAND, acks: Object.fromEntries(acks) }}
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
      const outcome = pane.input(input);
      if (outcome.close) {
        await $.ui.close({ id: PANE });
        return {};
      }
      if (outcome.copy) {
        const copied = await $.ui.copy({ text: outcome.copy.text, surface: e.surface });
        pane.copied(outcome.copy.what, copied.isCopied ? undefined : copied.reason);
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
