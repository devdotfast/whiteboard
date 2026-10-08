/** Run the terminal frontend against a diffr subprocess or saved NDJSON recording. */
import { createReadStream, openSync, closeSync } from "node:fs";
import { ReadStream } from "node:tty";
import { installShutdownHandlers } from "./shutdown";
import { spawn } from "node:child_process";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { readDiffStream } from "./diffr/stream";
import { DiffStore } from "./diffr/store";
import { cliClient, flattenSchema, type Setting } from "./diffr/config";
import { loadBundledTheme, loadThemeFile, themeConfig, themesFromConfig, type ThemeSet } from "./diffr/theme";
import { App } from "./ui/App";
import { Settings } from "./ui/Settings";
const args = process.argv.slice(2),
  store = new DiffStore();
/**
 * An error thrown outside the render loop's own handling would otherwise leave the terminal in
 * the alternate screen with raw input on, which reads as a frozen window. Put the terminal back
 * and print what happened.
 */
function restoreOnCrash(renderer: { destroy: () => void }) {
  const fatal = (error: unknown) => {
    renderer.destroy();
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(2);
  };
  process.on("uncaughtException", fatal);
  process.on("unhandledRejection", fatal);
}
// `diffr config` opens the settings screen: bun run main.tsx --settings --diffr /path/to/diffr [query]
if (args[0] === "--settings") {
  if (args[1] !== "--diffr" || !args[2]) {
    console.error("Usage: bun run start --settings --diffr /path/to/diffr [initial query]");
    process.exit(2);
  }
  // Reading the config can fail: a key the binary no longer knows, a malformed file. Read it
  // before the alternate screen exists, so the error reaches the terminal the user is looking at.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("Settings requires a terminal; use diffr config show/set for non-interactive use.");
    process.exit(2);
  }
  const client = cliClient(args[2]);
  let settings: Setting[];
  try {
    settings = flattenSchema(client.schema(), client.show());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const settingsRenderer = await createCliRenderer({
    useMouse: false,
    exitOnCtrlC: false,
    exitSignals: [],
    screenMode: "alternate-screen",
  });
  const quitSettings = () => {
    settingsRenderer.destroy();
    process.exit(0);
  };
  installShutdownHandlers(process.stdin, quitSettings);
  restoreOnCrash(settingsRenderer);
  createRoot(settingsRenderer).render(
    <Settings client={client} initial={settings} onQuit={quitSettings} initialQuery={args.slice(3).join(" ")} />,
  );
  await new Promise(() => {});
}
let child: ReturnType<typeof spawn> | undefined;
let chunks: AsyncIterable<Uint8Array>;
let input: NodeJS.ReadStream = process.stdin;
let ttyFd: number | undefined;
let expectsDifferenceExit = false;
let comparisonExitCode = 0;
let themes: ThemeSet;
if (args[0] === "--input" && args[1]) {
  // A recording has no diffr to ask; `--theme <name|path>` picks one, else the dark default.
  const themeArg = args.indexOf("--theme");
  const chosen = themeArg >= 0 ? args[themeArg + 1] : "default-dark";
  if (!chosen) throw new Error("--theme needs a bundled name or a Helix theme path");
  themes = {
    initial: chosen.endsWith(".toml") ? loadThemeFile(chosen) : loadBundledTheme(chosen),
    dark: loadBundledTheme("default-dark"),
    light: loadBundledTheme("default-light"),
  };
  chunks = args[1] === "-" ? process.stdin : createReadStream(args[1]);
  if (args[1] === "-") {
    ttyFd = openSync(process.platform === "win32" ? "CONIN$" : "/dev/tty", "r");
    input = new ReadStream(ttyFd);
  }
} else if (args[0] === "--diffr" && args[1]) {
  const comparison = args.slice(args[2] === "--" ? 3 : 2);
  // The theme comes from diffr's own config, so every frontend reads the same choice.
  themes = themesFromConfig(themeConfig(cliClient(args[1]).show()));
  const separator = comparison.indexOf("--");
  expectsDifferenceExit = comparison
    .slice(0, separator < 0 ? comparison.length : separator)
    .includes("--exit-code");
  // The frontend has no tokenizer, so it asks Rust for syntax spans.
  child = spawn(args[1], ["--format", "ndjson", "--syntax", ...comparison], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  chunks = child.stdout!;
} else {
  console.error(
    "Usage: bun run start --diffr /path/to/diffr -- [comparison arguments]\n       bun run start --input recording.ndjson (or -) [--theme name|file.toml]\n       bun run start --settings --diffr /path/to/diffr [query]",
  );
  process.exit(2);
}
const renderer = await createCliRenderer({
  stdin: input,
  useMouse: true,
  enableMouseMovement: true,
  exitOnCtrlC: false,
  exitSignals: [],
  screenMode: "alternate-screen",
});
let quitting = false;
function quit() {
  if (quitting) return;
  quitting = true;
  child?.kill();
  renderer.destroy();
  if (ttyFd !== undefined) {
    input.destroy();
    try {
      closeSync(ttyFd);
    } catch {}
  }
  process.exit(store.getSnapshot().errors.length ? 2 : comparisonExitCode);
}
installShutdownHandlers(input, quit);
restoreOnCrash(renderer);
const root = createRoot(renderer);
root.render(<App store={store} onQuit={quit} themes={themes!} />);
let stderr = "";
child?.stderr?.on("data", (data) => {
  stderr = (stderr + data.toString()).slice(-16384);
});
child?.on("error", (error) => store.fail(error));
child?.on("close", (code) => {
  if (code === 1 && expectsDifferenceExit) {
    comparisonExitCode = 1;
    return;
  }
  if (!quitting && code !== 0 && code !== null)
    store.fail(stderr || `diffr exited with status ${code}`);
});
try {
  for await (const event of readDiffStream(chunks!)) {
    if (quitting) break;
    store.accept(event);
  }
} catch (error) {
  if (!quitting) {
    store.fail(stderr || error);
    child?.kill();
  }
}
