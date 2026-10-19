#!/usr/bin/env node
// Drives one isolated dev Desktop for the pi ui-feature workflow. The app has
// no HMR, so every change goes through `restart`. State, logs and screenshots
// live in .pi-subagents/desktop/ (gitignored).
//
//   node .pi/tools/desktop.mjs restart [--no-build] [--timeout 240]
//   node .pi/tools/desktop.mjs stop
//   node .pi/tools/desktop.mjs status
//   node .pi/tools/desktop.mjs theme light|dark|<theme id>
//   node .pi/tools/desktop.mjs shot --name <name> [--size 700x900]
//        [--motion reduce] [--selector <css>] [--steps '<json>']
//
// `shot` is stateless: it connects over CDP, applies the size and motion
// emulation, runs the steps, captures, then detaches (which drops the
// emulation). Steps: {"press":"Tab"}, {"hover":"css"}, {"click":"css"},
// {"focus":"css"}, {"wait":ms}, {"shot":"suffix"} for a mid-sequence capture.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { parseArgs } from "node:util";

const repo = path.resolve(import.meta.dirname, "../..");
const appDir = path.join(repo, "apps/review-desktop");
const root = path.join(repo, ".pi-subagents/desktop");
const statePath = path.join(root, "state.json");
const settingsPath = path.join(root, "state-root/user-data/User/settings.json");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const themes = { light: "Review Light", dark: "Review Dark" };

const [command, ...rest] = process.argv.slice(2);
const { values: opts } = parseArgs({
  args: rest,
  options: {
    "no-build": { type: "boolean", default: false },
    timeout: { type: "string", default: "240" },
    name: { type: "string" },
    size: { type: "string" },
    motion: { type: "string" },
    selector: { type: "string" },
    steps: { type: "string" },
  },
  allowPositionals: true,
  strict: true,
});

const readState = () =>
  readFile(statePath, "utf8").then(JSON.parse, () => null);
const print = (value) => console.log(JSON.stringify(value, null, 2));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function stop() {
  const state = await readState();
  if (!state?.pid || !alive(state.pid)) return false;
  // run.sh execs Electron in its own process group; take the whole group down.
  process.kill(-state.pid, "SIGTERM");
  for (let i = 0; i < 40 && alive(state.pid); i++) await sleep(250);
  if (alive(state.pid)) process.kill(-state.pid, "SIGKILL");
  return true;
}

async function workbenchReady(port) {
  try {
    const targets = await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    return targets.some((t) => t.type === "page" && t.url.includes("workbench"));
  } catch {
    return false;
  }
}

async function restart() {
  await mkdir(root, { recursive: true });
  const stopped = await stop();
  const buildLog = path.join(root, "build.log");
  const launchLog = path.join(root, "launch.log");
  const started = Date.now();

  if (!opts["no-build"]) {
    const build = spawnSync("pnpm", ["desktop:build"], {
      cwd: repo,
      env: { ...process.env, REVIEW_DESKTOP_DEV_FAST: "1" },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    await writeFile(buildLog, `${build.stdout ?? ""}${build.stderr ?? ""}`);
    if (build.status !== 0) {
      print({ status: "build-failed", exitCode: build.status, buildLog });
      process.exitCode = 1;
      return;
    }
  }

  const port = await freePort();
  // A file descriptor, not a pipe: the Desktop outlives this process and keeps
  // logging to launch.log.
  const log = openSync(launchLog, "w");
  const child = spawn("bash", [path.join(appDir, "scripts/run.sh")], {
    cwd: appDir,
    detached: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      DEV_FAST_REVIEW_DESKTOP_BACKGROUND: "1",
      DEV_FAST_REVIEW_REMOTE_DEBUGGING_PORT: String(port),
      DEV_FAST_REVIEW_DESKTOP_STATE_ROOT: path.join(root, "state-root"),
      DEV_REVIEW_HOME: path.join(root, "review-home"),
      DEV_FAST_REVIEW_TELEMETRY_DISABLED: "1",
      DEV_REVIEW_EXTENSIONS: process.env.DEV_REVIEW_EXTENSIONS ?? "none",
    },
  });
  closeSync(log);
  let exit = null;
  child.on("exit", (code, signal) => (exit = { code, signal }));
  await writeFile(statePath, JSON.stringify({ pid: child.pid, port }));

  const deadline = started + Number(opts.timeout) * 1000;
  let status = "timeout";
  while (Date.now() < deadline) {
    if (exit) {
      status = "exited";
      break;
    }
    if (await workbenchReady(port)) {
      status = "ready";
      break;
    }
    await sleep(500);
  }
  child.unref();

  print({
    status,
    exit,
    stoppedPrevious: stopped,
    pid: child.pid,
    port,
    elapsedMs: Date.now() - started,
    launchLog,
    buildLog: opts["no-build"] ? null : buildLog,
    vscodeLogs: path.join(root, "state-root/user-data/logs"),
  });
  if (status !== "ready") process.exitCode = 1;
}

async function setTheme(name) {
  if (!name) throw new Error("theme needs light, dark or a theme id");
  const settings = await readFile(settingsPath, "utf8").then(JSON.parse, () => ({}));
  settings["workbench.colorTheme"] = themes[name] ?? name;
  await mkdir(path.dirname(settingsPath), { recursive: true });
  // The workbench watches user settings and applies the theme live.
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
  await sleep(1500);
  print({ theme: settings["workbench.colorTheme"] });
}

async function shot() {
  const state = await readState();
  if (!state?.port || !(await workbenchReady(state.port)))
    throw new Error("Desktop is not running; run `restart` first");
  if (!opts.name) throw new Error("shot needs --name");

  const require = createRequire(path.join(appDir, "package.json"));
  const { chromium } = require("playwright-core");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.port}`);
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes("workbench"));
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  if (opts.size) {
    const [width, height] = opts.size.split("x").map(Number);
    await page.setViewportSize({ width, height });
  }
  if (opts.motion) await page.emulateMedia({ reducedMotion: opts.motion });

  const dir = path.join(root, "shots");
  await mkdir(dir, { recursive: true });
  const files = [];
  const capture = async (suffix) => {
    const file = path.join(dir, `${opts.name}${suffix ? `-${suffix}` : ""}.png`);
    const target = opts.selector ? page.locator(opts.selector).first() : page;
    await target.screenshot({ path: file, animations: "allow" });
    files.push(file);
  };

  for (const step of JSON.parse(opts.steps ?? "[]")) {
    if (step.press) await page.keyboard.press(step.press);
    else if (step.hover) await page.locator(step.hover).first().hover();
    else if (step.click) await page.locator(step.click).first().click();
    else if (step.focus) await page.locator(step.focus).first().focus();
    else if (step.wait) await sleep(step.wait);
    else if (step.shot) await capture(step.shot);
    else throw new Error(`unknown step ${JSON.stringify(step)}`);
  }
  await sleep(300);
  await capture();

  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      label: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 80),
      rect: [rect.x, rect.y, rect.width, rect.height].map(Math.round),
    };
  });
  await browser.close();
  print({ files, focused, consoleErrors });
}

const commands = {
  restart,
  stop: async () => print({ stopped: await stop() }),
  status: async () => {
    const state = await readState();
    print({
      ...state,
      running: Boolean(state?.pid && alive(state.pid)),
      ready: Boolean(state?.port && (await workbenchReady(state.port))),
    });
  },
  theme: () => setTheme(rest[0]),
  shot,
};

if (!commands[command]) {
  console.error(`usage: desktop.mjs ${Object.keys(commands).join("|")}`);
  process.exit(2);
}
await commands[command]();
