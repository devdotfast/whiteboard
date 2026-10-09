import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { DiffStore } from "@diffr/viewer/protocol/store";
import { parseDiffEvents } from "@diffr/viewer/protocol/events";
import { paletteFromHelix, themeConfig, type Palette } from "@diffr/viewer/theme/palette";
import { loadBundledTheme, parseHelixTheme } from "@diffr/viewer/theme/themes";
import { Pane } from "./frame";

const run = promisify(execFile);
export interface ComparisonOptions {
  cwd: string;
  args?: string[];
  binary?: string;
  /** Saved NDJSON, for offline reviews and deterministic interaction testing. */
  input?: string;
  theme?: Palette;
}

export interface Comparison {
  pane: Pane;
  store: DiffStore;
  done: Promise<void>;
  dispose(): void;
}

async function themeFor(binary: string, cwd: string): Promise<Palette> {
  const { stdout } = await run(binary, ["config", "show", "--json"], { cwd, timeout: 15_000, maxBuffer: 1024 * 1024 });
  const config = themeConfig(JSON.parse(stdout));
  return config.path ? paletteFromHelix(parseHelixTheme(await readFile(resolve(cwd, config.path), "utf8"), config.path))
    : loadBundledTheme(config.name);
}

/** Resolves once the pane can mount; the diff continues streaming into its store. */
export async function openComparison(options: ComparisonOptions): Promise<Comparison> {
  const binary = options.binary ?? process.env.DIFFR_BIN ?? "diffr";
  const theme = options.theme ?? (options.input ? loadBundledTheme("default-dark") : await themeFor(binary, options.cwd));
  const store = new DiffStore();
  const pane = new Pane(store, theme);
  const args = options.args ?? [];
  const child = options.input ? undefined : spawn(binary, ["--format", "ndjson", "--syntax", ...args], {
    cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"],
  });
  const stream = options.input ? createReadStream(resolve(options.cwd, options.input), { encoding: "utf8" }) : child!.stdout!.setEncoding("utf8");
  let disposed = false;
  let parseFailed = false;
  let stderr = "";
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  child?.stderr?.setEncoding("utf8").on("data", chunk => { stderr = (stderr + chunk).slice(-16384); });
  const exit = child ? new Promise<void>(resolve => {
    child.on("error", error => { if (!disposed) store.fail(error); resolve(); });
    child.on("close", (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      const separator = args.indexOf("--");
      const diffExit = code === 1 && args.slice(0, separator < 0 ? args.length : separator).includes("--exit-code");
      if (!disposed && code !== 0 && !diffExit && (!parseFailed || stderr)) store.fail(stderr || `diffr exited with ${signal ?? code}`);
      resolve();
    });
  }) : Promise.resolve();
  const stopProducer = () => {
    stream.destroy();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
      killTimer.unref();
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopProducer();
  };
  const done = (async () => {
    try {
      for await (const event of parseDiffEvents(stream as AsyncIterable<string>)) {
        if (disposed) break;
        store.accept(event);
      }
    } catch (error) {
      if (!disposed) { parseFailed = true; store.fail(error); stopProducer(); }
    }
    await exit;
  })();
  return { pane, store, done, dispose };
}
