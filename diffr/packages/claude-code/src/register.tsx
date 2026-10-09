import type { EngineInterface, On, PluginOptions, PromptDecoration } from "claude-code";
import { paletteFromHelix, themeConfig, type Palette } from "@diffr/viewer/theme/palette";
import { loadBundledTheme, parseHelixTheme } from "@diffr/viewer/theme/themes";
import { DiffStore } from "@diffr/viewer/protocol/store";
import { parseDiffEvents } from "@diffr/viewer/protocol/events";
import { splitArgs } from "@diffr/consumer/args";
import { parsePost } from "./protocol";
import { Pane } from "@diffr/consumer/frame";

const PANE = "diffr";
const TOOL = "mcp__diffr__open";
/** The first diffr with `config init` and `upgrade`. */
const MINIMUM = [0, 1, 18];
const INSTALL = "curl -fsSL https://install.dev.fast/diffr | sh";
/** Lines per view instance. Claude Code caps each instance's element tree, and one highlighted
 * line can take over a thousand characters. */
const BAND = 16;

async function loadTheme($: EngineInterface, binary: string): Promise<Palette> {
  const shown = await $.process.run([binary, "config", "show", "--json"]);
  if (shown.exitCode !== 0) throw new Error(shown.stderr || `${binary} config show exited with status ${shown.exitCode}`);
  const config = themeConfig(JSON.parse(shown.stdout));
  return config.path
    ? paletteFromHelix(parseHelixTheme(await $.fs.read(config.path), config.path))
    : loadBundledTheme(config.name);
}

/** Rejects, naming the command that fixes it, when diffr is missing or older than MINIMUM. */
async function checkVersion($: EngineInterface, binary: string): Promise<void> {
  let shown;
  try {
    shown = await $.process.run([binary, "--version"]);
  } catch (error) {
    throw new Error(`${binary} could not run (${error instanceof Error ? error.message : String(error)}); install diffr with: ${INSTALL}`);
  }
  if (shown.exitCode !== 0) throw new Error(shown.stderr || `${binary} --version exited with status ${shown.exitCode}`);
  const match = /^diffr (\d+)\.(\d+)\.(\d+)/.exec(shown.stdout);
  if (!match) throw new Error(`${binary} --version printed ${JSON.stringify(shown.stdout)}, not a diffr version, which looks like "diffr ${MINIMUM.join(".")}"`);
  const version = match.slice(1).map(Number);
  const older = version.findIndex((part, i) => part !== MINIMUM[i]);
  if (older >= 0 && version[older] < MINIMUM[older])
    throw new Error(`This plugin needs diffr ${MINIMUM.join(".")} or newer, not ${version.join(".")}; update it with: diffr upgrade`);
}

type Checked = { promise?: Promise<void> };

/** Checks once per session; a failed check runs again on the next use, as after `diffr upgrade`. */
function check($: EngineInterface, binary: string, checked: Checked): Promise<void> {
  return checked.promise ??= checkVersion($, binary).catch((error) => {
    checked.promise = undefined;
    throw error;
  });
}

function toolArgs(input: Record<string, unknown>): string[] {
  const args = input.args ?? [];
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string"))
    throw new Error("args must be a list of strings: revisions or paths, as diffr takes them");
  return args;
}

function summary(args: string[], store: DiffStore): string {
  const snapshot = store.getSnapshot();
  const shown = `diffr${args.length ? ` ${args.join(" ")}` : ""}`;
  if (!snapshot.comparison) throw new Error(`${shown} failed: ${snapshot.errors.join("; ") || "it named no comparison"}`);
  const files = snapshot.inventory.length;
  return `Opened ${shown} in a pane for the person: ${files} changed ${files === 1 ? "file" : "files"}.`;
}

/** Waits only for the first record, so bad revisions error without blocking the model. */
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

/** Stops the previous pane. */
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

function chipRuns(text: string, names: string[], theme: Palette): PromptDecoration[] {
  return names.flatMap((name) => occurrencesOf(text, name).map((start) =>
    ({ start, end: start + name.length, color: theme.bg, backgroundColor: theme.accent, bold: true })));
}

function occurrencesOf(text: string, name: string): number[] {
  const starts: number[] = [];
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + name.length)) starts.push(at);
  return starts;
}

// Must stay a function declaration: Claude Code finds `register` in the source.
export function register(on: On, options: PluginOptions): void {
  const binary = options.diffr;
  if (typeof binary !== "string") throw new Error(`The diffr option must be a string, not ${typeof binary}`);
  let pane: Pane | undefined;
  let child: Child | undefined;
  let focused = false;
  /** Ranges in the draft, by chip name. */
  const chips = new Map<string, string>();
  const acks = new Map<string, number>();
  const version: Checked = {};

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "diffr",
      description: "Review a diff with diffr",
      argumentHint: "[revisions or paths, as for diffr]",
    });
    await $.tool.register({
      name: "open",
      description: "Open diffr's review pane for the user, showing a high-quality diff viewer based on 'diffr'. " +
        "Use it to show them changes you made or want them to review, rather than describing the diff. " +
        "The user can send you snippets of code that they're looking at via 'highlight + pressing enter'. " +
        "Args are the same as you would pass to the 'git diff' CLI command, as a list (e.g. [\"HEAD~1\"], [\"main..HEAD\", \"--\", \"src\"]). " +
        "For more information on using and customizing diffr, run `diffr --help` in the shell.",
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
      await check($, binary, version);
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
      await check($, binary, version);
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
      if (outcome.chat) {
        const names = outcome.chat.map((chip) => chip.name);
        const text = `${names.join(" ")} `;
        const filled = await $.prompt.fill({ text, mode: "insert", decorations: chipRuns(text, names, pane.theme) });
        if (filled.isFilled) for (const chip of outcome.chat) chips.set(chip.name, chip.context);
        pane.chatted(names, filled.isFilled ? undefined : filled.refusal === "dialog" ? "a dialog holds the keys"
          : filled.refusal === "no_composer" ? "this session has no prompt box" : "a hook kept it out");
      }
    }
    $.ui.invalidate("ui.render");
    return {};
  });

  // An edit repaints the draft without the chips' colours, so paint them again on every one.
  on("prompt.edit", async ($, e, next) => {
    const box = await next(e);
    if (!chips.size || !pane) return box;
    return { ...box, decorations: [...(box.decorations ?? []), ...chipRuns(box.text, [...chips.keys()], pane.theme)] };
  });

  // The model reads the code of each chip the prompt still names; a chip deleted from the draft is dropped.
  on("prompt.submit", async ($, e, next) => {
    if (!chips.size) return next(e);
    const named = [...chips].filter(([name]) => e.text.includes(name));
    chips.clear();
    if (!named.length) return next(e);
    return next({ ...e, context: [...(e.context ?? []), ...named.map(([name, code]) =>
      `The person selected these lines in diffr's review pane; their prompt calls them ${name}.\n${code}`)] });
  });

  // The frame fills the pane, so the engine never scrolls it; scroll the viewer instead.
  on("ui.scroll", { requestId: "diffr" }, async ($, e) => {
    if (!pane) return {};
    pane.scroll(e.by, e.pointer?.column);
    $.ui.invalidate("ui.render");
    return {};
  });
}
