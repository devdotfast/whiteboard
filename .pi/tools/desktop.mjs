#!/usr/bin/env node
// Drives one isolated dev Desktop for the pi ui-feature workflow. The app has
// no HMR, so every change goes through `restart`, which starts it the only
// supported way: `pnpm dev` (build + run). Logs, screenshots and ownership
// state live in .pi-subagents/desktop/ (gitignored); Electron state uses a short
// temporary directory to fit macOS IPC socket path limits.
//
//   node .pi/tools/desktop.mjs restart [--timeout 600]
//   node .pi/tools/desktop.mjs stop
//   node .pi/tools/desktop.mjs status
//   node .pi/tools/desktop.mjs theme light|dark|<theme id>
//   node .pi/tools/desktop.mjs shot --name <name> [--size 700x900]
//        [--out-dir .pi-subagents/<run>/inspect] [--motion reduce] [--selector <css>] [--frame <iframe css>] [--steps '<json>']
//
// `shot` is stateless: it connects over CDP, applies the size and motion
// emulation, runs the steps, captures, then detaches (which drops the
// emulation). Steps: {"press":"Tab"}, {"hover":"css"}, {"click":"css"},
// {"focus":"css"}, {"wait":ms}, {"shot":"suffix"} for a mid-sequence capture.
// A step may include frame (iframe CSS or nested selector array) and selector.
// With --frame, set a host-control step frame:[] to return to the main page.
// Checkbox steps use {selector:"css",checked:true|false}.
// Each capture records text clipping/overlap candidates and iframe focus in JSON.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";

const repo = path.resolve(import.meta.dirname, "../..");
const appDir = path.join(repo, "apps/review-desktop");
const root = path.join(repo, ".pi-subagents/desktop");
const statePath = path.join(root, "state.json");
// macOS Unix socket paths must fit in 103 bytes. Deep managed checkout paths
// exceed that once Electron appends its IPC socket name. Keep only Electron's
// state in a short per-user, per-checkout directory; review data stays in root.
const checkoutKey = createHash("sha256")
  .update(repo)
  .digest("hex")
  .slice(0, 12);
const stateRoot = path.join(
  process.platform === "win32" ? tmpdir() : "/tmp",
  `wb-pi-${process.getuid?.() ?? "user"}-${checkoutKey}`,
);
// Shared across checkouts. A persistent reservation covers build time as well
// as the Desktop lifetime; an operation lock serializes ownership changes.
const instanceLock = path.join(
  tmpdir(),
  `whiteboard-pi-desktop-${process.getuid?.() ?? "user"}`,
);
const operationLock = `${instanceLock}-operation`;
const exec = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const themes = { light: "Review Light", dark: "Review Dark" };

const [command, ...rest] = process.argv.slice(2);
const { values: opts } = parseArgs({
  args: rest,
  options: {
    timeout: { type: "string", default: "600" },
    name: { type: "string" },
    "out-dir": { type: "string" },
    size: { type: "string" },
    motion: { type: "string" },
    selector: { type: "string" },
    frame: { type: "string" },
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

async function processes() {
  // Fail closed when process inspection is unavailable. Never infer that no
  // competing app exists from an unreadable process list.
  const { stdout } = await exec("ps", ["-axo", "pid=,pgid=,lstart=,args="]);
  return stdout.split("\n").flatMap((line) => {
    const match = line
      .trim()
      .match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/);
    return match
      ? [
          {
            pid: Number(match[1]),
            pgid: Number(match[2]),
            started: match[3],
            args: match[4],
          },
        ]
      : [];
  });
}

function desktopProcesses(list) {
  return list.filter(({ args }) => {
    // The packaged executable also runs the stdio MCP client; that is not a
    // Desktop instance. Helpers belong to their parent app, not extra apps.
    if (
      /\/cli\.(?:m?js|ts)\s+mcp(?:\s|$)|--type=|chrome_crashpad_handler/.test(
        args,
      )
    )
      return false;
    return (
      /^(?:\S*\/)?(?:Whiteboard(?: Preview)?|review)(?:\.exe)?(?:\s|$)/.test(
        args,
      ) ||
      /^.*\/(?:Whiteboard(?: Preview)?\.app\/Contents\/MacOS\/Whiteboard(?: Preview)?|code-oss\/\.build\/electron\/(?:review|electron))(?:\s|$)/.test(
        args,
      ) ||
      /^(?:\S*\/)?node\s+.*\/review\/(?:dist|src)\/server\/desktop-host\.(?:js|ts)(?:\s|$)/.test(
        args,
      )
    );
  });
}

async function readOwner() {
  return readFile(path.join(instanceLock, "owner.json"), "utf8").then(
    JSON.parse,
    () => null,
  );
}

function ownsProcess(state, list) {
  return Boolean(
    state?.pid &&
    state.started &&
    list.some(
      (p) =>
        p.pid === state.pid &&
        p.pgid === state.pid &&
        p.started === state.started,
    ),
  );
}

async function exclusive(action) {
  // Never steal an ambiguous lock: a second caller can arrive between mkdir
  // and the owner write. On interruption the error identifies recovery steps.
  try {
    await mkdir(operationLock, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        `Another Desktop operation owns ${operationLock}. If interrupted, verify no helper is running before removing that directory.`,
      );
    throw error;
  }
  try {
    await writeFile(
      path.join(operationLock, "owner.json"),
      JSON.stringify({ pid: process.pid, repo }),
    );
    return await action();
  } finally {
    await rm(operationLock, { recursive: true, force: true });
  }
}

async function stopOwned() {
  const state = await readState();
  const owner = await readOwner();
  const list = await processes();
  if (!state?.pid || !ownsProcess(state, list)) {
    // Stale legacy state is not authority to signal a possibly reused PID.
    if (state?.pid && alive(state.pid))
      throw new Error(
        "Desktop PID is live but its identity cannot be verified; leaving it untouched.",
      );
    return false;
  }
  if (
    owner?.repo !== repo ||
    owner?.pid !== state.pid ||
    owner?.started !== state.started
  )
    throw new Error(
      "Desktop is not owned by this checkout's global reservation; leaving it untouched.",
    );
  process.kill(-state.pid, "SIGTERM");
  for (let i = 0; i < 40; i++) {
    const group = (await processes()).filter((p) => p.pgid === state.pid);
    if (!group.length) break;
    await sleep(250);
  }
  const remaining = (await processes()).filter((p) => p.pgid === state.pid);
  if (remaining.length) {
    // The original group leader must still match before escalating signals.
    if (!ownsProcess(state, remaining))
      throw new Error(
        "Desktop children remain after its launcher exited; inspect them before restarting.",
      );
    process.kill(-state.pid, "SIGKILL");
    for (
      let i = 0;
      i < 40 && (await processes()).some((p) => p.pgid === state.pid);
      i++
    )
      await sleep(250);
    if ((await processes()).some((p) => p.pgid === state.pid))
      throw new Error(
        "Desktop process group is still running; refusing to restart.",
      );
  }
  await rm(instanceLock, { recursive: true, force: true });
  await rm(statePath, { force: true });
  return true;
}

async function reserve() {
  const list = await processes();
  const competing = desktopProcesses(list);
  if (competing.length)
    throw new Error(
      `Whiteboard is already running; close it before launching a managed Desktop: ${JSON.stringify(competing)}`,
    );
  const owner = await readOwner();
  if (owner) {
    if (ownsProcess(owner, list) || alive(owner.launcherPid))
      throw new Error(
        `Desktop reservation belongs to ${owner.repo}; refusing to launch another instance.`,
      );
    await rm(instanceLock, { recursive: true, force: true });
  }
  await mkdir(instanceLock, { mode: 0o700 });
  await writeFile(
    path.join(instanceLock, "owner.json"),
    JSON.stringify({ repo, launcherPid: process.pid }),
  );
}

async function workbenchReady(port) {
  try {
    const targets = await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    return targets.some(
      (t) => t.type === "page" && t.url.includes("workbench"),
    );
  } catch {
    return false;
  }
}

async function restartOwned() {
  await mkdir(root, { recursive: true });
  const stopped = await stopOwned();
  await reserve();
  const launchLog = path.join(root, "launch.log");
  const started = Date.now();

  const port = await freePort();
  // A file descriptor, not a pipe: the Desktop outlives this process and keeps
  // logging to launch.log.
  const log = openSync(launchLog, "w");
  const child = spawn("pnpm", ["dev"], {
    cwd: repo,
    detached: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      DEV_FAST_REVIEW_DESKTOP_BACKGROUND: "1",
      DEV_FAST_REVIEW_REMOTE_DEBUGGING_PORT: String(port),
      DEV_FAST_REVIEW_DESKTOP_STATE_ROOT: stateRoot,
      DEV_REVIEW_HOME: path.join(root, "review-home"),
      DEV_FAST_REVIEW_TELEMETRY_DISABLED: "1",
      DEV_REVIEW_EXTENSIONS: process.env.DEV_REVIEW_EXTENSIONS ?? "none",
    },
  });
  closeSync(log);
  let exit = null;
  child.on("exit", (code, signal) => (exit = { code, signal }));
  child.on("error", (error) => (exit = { error: error.message }));
  // Persist an OS start-time fingerprint as well as the PID, preventing a
  // stale state file from authorizing termination of a reused process ID.
  const identity = (await processes()).find((p) => p.pid === child.pid);
  if (!identity)
    throw new Error(
      "Desktop launcher exited before its identity could be recorded; inspect launch.log.",
    );
  const state = {
    pid: child.pid,
    port,
    started: identity.started,
    repo,
    stateRoot,
  };
  await writeFile(statePath, JSON.stringify(state));
  await writeFile(path.join(instanceLock, "owner.json"), JSON.stringify(state));

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
    stateRoot,
    vscodeLogs: path.join(stateRoot, "user-data/logs"),
  });
  if (status !== "ready") process.exitCode = 1;
}

async function setTheme(name) {
  if (!name)
    throw new Error("theme needs light, dark or a registered theme id");
  const themeName = themes[name] ?? name;
  const state = await readState();
  if (!state?.port || !(await workbenchReady(state.port)))
    throw new Error("Desktop is not running; cannot verify a theme change");
  const activeStateRoot = state.stateRoot ?? stateRoot;
  const activeSettingsPath = path.join(
    activeStateRoot,
    "user-data/User/settings.json",
  );
  let expectedClasses;
  // Resolve the same CSS theme selector used by WorkbenchThemeService. Exact
  // class verification distinguishes the requested theme from another theme
  // of the same light/dark kind and works for repeated changes.
  for (const extensions of [
    path.join(appDir, "code-oss/extensions"),
    path.join(activeStateRoot, "extensions"),
  ]) {
    const entries = await readdir(extensions, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = await readFile(
        path.join(extensions, entry.name, "package.json"),
        "utf8",
      ).then(JSON.parse, () => null);
      const theme = manifest?.contributes?.themes?.find(
        (candidate) =>
          (candidate.id ?? candidate.label) === themeName ||
          candidate.label === themeName,
      );
      if (!theme) continue;
      let selector =
        `${manifest.publisher}.${manifest.name}-${theme.path.replace(/^\.\//, "")}`.replace(
          /[^_a-zA-Z0-9-]/g,
          "-",
        );
      if (/^[0-9-]/.test(selector)) selector = `_${selector}`;
      expectedClasses = [theme.uiTheme ?? "vs-dark", selector];
      break;
    }
    if (expectedClasses) break;
  }
  if (!expectedClasses)
    throw new Error(
      `Cannot resolve registered theme ${JSON.stringify(themeName)} for rendered verification; settings were not changed`,
    );
  const require = createRequire(path.join(appDir, "package.json"));
  const { chromium } = require("playwright-core");
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${state.port}`,
  );
  try {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes("workbench"));
    if (!page) throw new Error("Desktop workbench page is unavailable");
    const settings = await readFile(activeSettingsPath, "utf8").then(
      JSON.parse,
      () => ({}),
    );
    // Match the product's applyReviewThemeChoice: system theme detection can
    // otherwise immediately override an explicit workbench.colorTheme value.
    settings["window.autoDetectColorScheme"] = false;
    settings["workbench.colorTheme"] = themeName;
    await mkdir(path.dirname(activeSettingsPath), { recursive: true });
    await writeFile(activeSettingsPath, JSON.stringify(settings, null, 2));
    const started = Date.now();
    let actual;
    do {
      actual = await page.evaluate(() => ({
        classes: [
          ...(document.querySelector(".monaco-workbench") ?? document.body)
            .classList,
        ],
      }));
      if (expectedClasses.every((value) => actual.classes.includes(value))) {
        print({
          theme: themeName,
          verified: true,
          expectedClasses,
          actual,
          settingsPath: activeSettingsPath,
          elapsedMs: Date.now() - started,
        });
        return;
      }
      await sleep(200);
    } while (Date.now() - started < 15000);
    throw new Error(
      `Theme did not apply within 15 seconds: ${JSON.stringify({ theme: themeName, expectedClasses, actual, settingsPath: activeSettingsPath })}`,
    );
  } finally {
    await browser.close();
  }
}

// Diagnostics are evidence for the visual inspector, not a pass verdict.
// Text Range rectangles catch actual glyph clipping that element boxes miss.
async function inspectSurface(target, hostBackdrop = null) {
  return target.evaluate((scope, hostBackdrop) => {
    const round = (r) =>
      [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10);
    // Convert computed CSS colors through a detached sRGB canvas. This also
    // resolves modern color syntax without assuming every theme uses rgb().
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = colorCanvas.height = 1;
    const colorContext = colorCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const colors = new Map();
    const rgba = (value) => {
      if (colors.has(value)) return colors.get(value);
      if (!colorContext || !CSS.supports("color", value)) return null;
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = value;
      colorContext.fillRect(0, 0, 1, 1);
      const p = colorContext.getImageData(0, 0, 1, 1).data;
      const color = [p[0] / 255, p[1] / 255, p[2] / 255, p[3] / 255];
      colors.set(value, color);
      return color;
    };
    const over = (front, back) => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return alpha
        ? [0, 1, 2]
            .map(
              (i) =>
                (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) /
                alpha,
            )
            .concat(alpha)
        : [0, 0, 0, 0];
    };
    const luminance = (color) =>
      color
        .slice(0, 3)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const displayColor = (color) =>
      color
        .slice(0, 3)
        .map((c) => Math.round(c * 255))
        .concat(Math.round(color[3] * 1000) / 1000);
    const contrastFor = (el, rects) => {
      const style = getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize);
      const bold =
        Number(style.fontWeight) >= 700 || style.fontWeight === "bold";
      const largeText = fontSize >= 24 || (bold && fontSize >= 18.6667);
      const requiredRatio = largeText ? 3 : 4.5;
      const points = rects.map((r) => [
        Math.round((r.left + r.right) / 2),
        Math.round((r.top + r.bottom) / 2),
      ]);
      const unknown = (reason) => ({
        status: "unknown",
        reason,
        requiredRatio,
        largeText,
        samplePoints: points,
      });
      const isSvg = el instanceof SVGElement;
      const paint = isSvg
        ? style.fill
        : style.webkitTextFillColor || style.color;
      let foreground = rgba(paint);
      if (!foreground) return unknown(`Unsupported foreground paint: ${paint}`);
      foreground = [...foreground];
      if (isSvg) {
        foreground[3] *= Number(style.fillOpacity);
        if (style.stroke !== "none" && Number(style.strokeOpacity) > 0)
          return unknown("SVG text stroke needs pixel inspection");
      }
      let background = [0, 0, 0, 0];
      const opacitySources = [];
      for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
        const a = getComputedStyle(ancestor);
        if (a.backgroundImage !== "none")
          return unknown("Background image or gradient needs pixel inspection");
        if (
          a.filter !== "none" ||
          (a.backdropFilter && a.backdropFilter !== "none") ||
          a.mixBlendMode !== "normal" ||
          a.backgroundClip === "text"
        )
          return unknown(
            "Filter, blend mode, or text background clip needs pixel inspection",
          );
        for (const pseudo of ["::before", "::after"]) {
          const p = getComputedStyle(ancestor, pseudo);
          if (
            p.content !== "none" &&
            p.content !== "normal" &&
            (p.backgroundImage !== "none" ||
              (rgba(p.backgroundColor)?.[3] ?? 0) > 0)
          )
            return unknown("Painted pseudo-element needs pixel inspection");
        }
        const layer = rgba(a.backgroundColor);
        if (!layer)
          return unknown(`Unsupported background color: ${a.backgroundColor}`);
        foreground = over(foreground, layer);
        background = over(background, layer);
        // Group opacity applies after compositing descendants with the group's
        // own background, before compositing over its parent's background.
        foreground[3] *= Number(a.opacity);
        background[3] *= Number(a.opacity);
        if (Number(a.opacity) < 0.999)
          opacitySources.push({
            tag: ancestor.tagName.toLowerCase(),
            id: ancestor.id,
            class: ancestor.getAttribute("class"),
            opacity: Number(a.opacity),
            lifecycleState: ancestor.getAttribute("data-wb-state"),
          });
      }
      const external = hostBackdrop ? rgba(hostBackdrop) : null;
      if (external && external[3] === 1) {
        foreground = over(foreground, external);
        background = over(background, external);
      }
      if (background[3] < 0.999 || foreground[3] < 0.999)
        return unknown(
          "Transparent document backdrop (possibly an iframe) needs pixel inspection",
        );
      for (const [x, y] of points) {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight)
          return unknown("Text sample is outside the frame viewport");
        const hits = document.elementsFromPoint(x, y);
        for (const hit of hits) {
          if (hit === el || hit.contains(el) || el.contains(hit)) continue;
          const h = getComputedStyle(hit);
          if (
            hit instanceof SVGElement ||
            /^(CANVAS|IMG|VIDEO|IFRAME)$/.test(hit.tagName) ||
            h.backgroundImage !== "none" ||
            (rgba(h.backgroundColor)?.[3] ?? 0) > 0
          )
            return unknown(
              "Overlapping or underlying non-ancestor paint needs pixel inspection",
            );
        }
      }
      const f = luminance(foreground);
      const b = luminance(background);
      const ratio = (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
      return {
        status: ratio >= requiredRatio ? "pass" : "fail",
        foreground: displayColor(foreground),
        foregroundPaint: paint,
        hostBackdrop,
        opacitySources,
        background: displayColor(background),
        ratio: Math.round(ratio * 1000) / 1000,
        requiredRatio,
        largeText,
        samplePoints: points,
        method:
          "Computed solid paints at text Range centers; ancestor alpha and group opacity composited in sRGB. Complex paint remains unknown.",
      };
    };
    const text = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && text.length < 2000) {
      if (!node.textContent.trim() || !node.parentElement) continue;
      const el = node.parentElement;
      if (el.closest("script,style,noscript")) continue;
      let hidden = false;
      for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (
          style.display === "none" ||
          style.visibility !== "visible" ||
          Number(style.opacity) === 0
        )
          hidden = true;
      }
      if (hidden) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(
        (r) => r.width && r.height,
      );
      if (!rects.length) continue;
      const clipped = [];
      for (const r of rects) {
        for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          const a = ancestor.getBoundingClientRect();
          const left = a.left + ancestor.clientLeft;
          const top = a.top + ancestor.clientTop;
          const clipWidth =
            ancestor instanceof SVGElement ? a.width : ancestor.clientWidth;
          const clipHeight =
            ancestor instanceof SVGElement ? a.height : ancestor.clientHeight;
          const clipsX = /hidden|clip|auto|scroll/.test(style.overflowX);
          const clipsY = /hidden|clip|auto|scroll/.test(style.overflowY);
          if (
            (clipsX && (r.left < left - 1 || r.right > left + clipWidth + 1)) ||
            (clipsY && (r.top < top - 1 || r.bottom > top + clipHeight + 1))
          ) {
            clipped.push({
              ancestor: ancestor.tagName.toLowerCase(),
              class: ancestor.className?.toString().slice(0, 180),
              rect: round(a),
            });
            break;
          }
        }
        if (
          r.left < -1 ||
          r.top < -1 ||
          r.right > innerWidth + 1 ||
          r.bottom > innerHeight + 1
        )
          clipped.push({
            ancestor: "frame viewport",
            rect: [0, 0, innerWidth, innerHeight],
          });
      }
      const style = getComputedStyle(el);
      text.push({
        text: node.textContent.trim().slice(0, 240),
        tag: el.tagName.toLowerCase(),
        rects: rects.map(round),
        clipped,
        fontSize: style.fontSize,
        transform: style.transform,
        translate: style.translate,
        color: style.color,
        background: style.backgroundColor,
        contrast: contrastFor(el, rects),
      });
    }
    const overlaps = [];
    for (let i = 0; i < text.length; i++) {
      for (let j = i + 1; j < text.length; j++) {
        if (overlaps.length >= 100) break;
        if (
          text[i].rects.some(([x, y, w, h]) =>
            text[j].rects.some(
              ([bx, by, bw, bh]) =>
                Math.min(x + w, bx + bw) - Math.max(x, bx) > 2 &&
                Math.min(y + h, by + bh) - Math.max(y, by) > 2,
            ),
          )
        )
          overlaps.push({
            a: i,
            b: j,
            textA: text[i].text,
            textB: text[j].text,
          });
      }
    }
    const boxClippingCandidates = [];
    for (const element of scope.querySelectorAll("*")) {
      if (
        !(
          element instanceof HTMLElement || element instanceof SVGRectElement
        ) ||
        element.closest("defs,script,style,svg.wb-arrows") ||
        !element.checkVisibility({
          visibilityProperty: true,
          opacityProperty: true,
        })
      )
        continue;
      const rect = element.getBoundingClientRect();
      if (
        rect.width <= 2 ||
        rect.height <= 2 ||
        rect.bottom <= 0 ||
        rect.top >= innerHeight
      )
        continue;
      const style = getComputedStyle(element);
      const painted =
        element instanceof SVGRectElement
          ? rgba(style.fill)?.[3] > 0 ||
            (style.stroke !== "none" && parseFloat(style.strokeWidth) > 0)
          : rgba(style.backgroundColor)?.[3] > 0 ||
            style.backgroundImage !== "none" ||
            ["Top", "Right", "Bottom", "Left"].some(
              (side) =>
                parseFloat(style["border" + side + "Width"]) > 0 &&
                style["border" + side + "Style"] !== "none" &&
                rgba(style["border" + side + "Color"])?.[3] > 0,
            );
      if (!painted) continue;
      const clips = [];
      for (
        let ancestor = element.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (!/hidden|clip|auto|scroll/.test(ancestorStyle.overflowX)) continue;
        const bounds = ancestor.getBoundingClientRect();
        const scale =
          ancestor instanceof HTMLElement && ancestor.offsetWidth
            ? bounds.width / ancestor.offsetWidth
            : 1;
        const left = bounds.left + ancestor.clientLeft * scale;
        const width =
          ancestor instanceof SVGElement
            ? bounds.width
            : ancestor.clientWidth * scale;
        if (rect.left < left - 1 || rect.right > left + width + 1) {
          clips.push({
            ancestor: ancestor.tagName.toLowerCase(),
            class: ancestor.className?.toString().slice(0, 180),
            rect: round(bounds),
            axis: "x",
            overflow: ancestorStyle.overflowX,
          });
          break;
        }
      }
      if (rect.left < -1 || rect.right > innerWidth + 1)
        clips.push({
          ancestor: "frame viewport",
          rect: [0, 0, innerWidth, innerHeight],
          axis: "x",
        });
      if (!clips.length) continue;
      boxClippingCandidates.push({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        class: element.className?.toString().slice(0, 180),
        text: element.textContent?.trim().slice(0, 100),
        bounds: round(rect),
        clips,
      });
      if (boxClippingCandidates.length > 100) break;
    }
    const boxClippingTruncated = boxClippingCandidates.length > 100;
    if (boxClippingTruncated) boxClippingCandidates.length = 100;
    const pathGeometry = [];
    for (const path of scope.querySelectorAll("svg path")) {
      if (path.closest("defs")) continue;
      const style = getComputedStyle(path);
      if (
        style.visibility !== "visible" ||
        Number(style.opacity) === 0 ||
        !path.getClientRects().length
      )
        continue;
      try {
        const length = path.getTotalLength();
        const matrix = path.getScreenCTM();
        const point = (distance) => {
          const p = path.getPointAtLength(distance);
          const mapped = matrix
            ? new DOMPoint(p.x, p.y).matrixTransform(matrix)
            : p;
          return { x: mapped.x, y: mapped.y };
        };
        pathGeometry.push({
          id: path.id,
          parentId: path.parentElement?.id ?? "",
          markerStart: style.markerStart,
          markerEnd: style.markerEnd,
          stroke: style.stroke,
          strokeWidth: style.strokeWidth,
          strokeDasharray: style.strokeDasharray,
          length,
          start: point(0),
          end: point(length),
          bounds: round(path.getBoundingClientRect()),
        });
      } catch {
        /* Non-renderable paths remain available in the screenshot. */
      }
      if (pathGeometry.length > 200) break;
    }
    const pathGeometryTruncated = pathGeometry.length > 200;
    if (pathGeometryTruncated) pathGeometry.length = 200;
    const motionElements = [...new Set([
      ...scope.querySelectorAll(".wb-token"),
      ...document.getAnimations().filter((a) => a.playState === "running")
        .map((a) => a.effect?.target).filter((el) => el instanceof Element && scope.contains(el)),
    ])].map((element, index) => ({ element, index })).filter(({ element }) =>
      element.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
    ).slice(0, 100).map(({ element, index }) => {
      const style = getComputedStyle(element);
      return {
        index,
        tag: element.tagName.toLowerCase(),
        id: element.id,
        class: element.getAttribute("class") ?? "",
        text: element.textContent?.trim().slice(0, 160) ?? "",
        rect: round(element.getBoundingClientRect()),
        opacity: Number(style.opacity),
        transform: style.transform,
        animations: element.getAnimations().filter((a) => a.playState === "running").map((a) => ({
          currentTime: typeof a.currentTime === "number" ? a.currentTime : null,
          duration: a.effect?.getComputedTiming().duration ?? null,
        })),
      };
    });
    const el = document.activeElement;
    return {
      url: location.href,
      viewport: [innerWidth, innerHeight],
      bounds: round(scope.getBoundingClientRect()),
      scrollSize: [scope.scrollWidth, scope.scrollHeight],
      focused:
        el && el !== document.body
          ? {
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute("role"),
              label:
                el.getAttribute("aria-label") ??
                el.textContent?.trim().slice(0, 80),
              rect: round(el.getBoundingClientRect()),
            }
          : null,
      text,
      clippingCandidates: text
        .map((t, index) => ({ index, text: t.text, clips: t.clipped }))
        .filter((t) => t.clips.length),
      boxClippingCandidates,
      boxClippingTruncated,
      overlapCandidates: overlaps,
      contrastFailures: text
        .map((t, index) => ({ index, text: t.text, contrast: t.contrast }))
        .filter((t) => t.contrast.status === "fail"),
      contrastUnknown: text
        .map((t, index) => ({ index, text: t.text, contrast: t.contrast }))
        .filter((t) => t.contrast.status === "unknown"),
      pathGeometry,
      pathGeometryTruncated,
      motionElements,
      truncated:
        text.length >= 2000 ||
        overlaps.length >= 100 ||
        pathGeometryTruncated ||
        boxClippingTruncated,
    };
  }, hostBackdrop);
}

async function shot() {
  const state = await readState();
  if (!state?.port || !(await workbenchReady(state.port)))
    throw new Error("Desktop is not running; run `restart` first");
  if (!opts.name || !/^[a-zA-Z0-9_-]+$/.test(opts.name))
    throw new Error("shot needs a filename-safe --name");

  const require = createRequire(path.join(appDir, "package.json"));
  const { chromium } = require("playwright-core");
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${state.port}`,
  );
  try {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes("workbench"));
    if (!page) throw new Error("Desktop workbench page is unavailable");
    const consoleErrors = [];
    // Playwright page events include events from child frames (including
    // sandboxed animation documents), not just the workbench document.
    page.on("console", (m) => {
      if (m.type() === "error")
        consoleErrors.push({
          kind: "console",
          text: m.text(),
          location: m.location(),
        });
    });
    page.on("pageerror", (e) =>
      consoleErrors.push({
        kind: "pageerror",
        text: String(e),
        stack: e.stack,
      }),
    );
    if (opts.size) {
      const [width, height] = opts.size.split("x").map(Number);
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0
      )
        throw new Error("--size must be WIDTHxHEIGHT");
      await page.setViewportSize({ width, height });
    }
    // Set both cases explicitly so a prior reduced-motion capture cannot leak
    // its media override into a later normal capture on the same Desktop.
    await page.emulateMedia({ reducedMotion: opts.motion ?? "no-preference" });
    // --frame is a CSS iframe selector, or a JSON array for nested frames.
    // Each step may override it with {frame:"iframe...",click:"button..."}.
    const surface = (frame = opts.frame) => {
      const selectors = !frame
        ? []
        : Array.isArray(frame)
          ? frame
          : /^\[\s*"/.test(frame)
            ? JSON.parse(frame)
            : [frame];
      return selectors.reduce(
        (scope, selector) => scope.frameLocator(selector).first(),
        page,
      );
    };
    const dir = path.resolve(repo, opts["out-dir"] ?? path.join(root, "shots"));
    const artifactRoot = path.join(repo, ".pi-subagents");
    if (!dir.startsWith(artifactRoot + path.sep))
      throw new Error("--out-dir must be inside .pi-subagents");
    await mkdir(dir, { recursive: true });
    const files = [];
    const captures = [];
    const capture = async (suffix, step = {}) => {
      if (suffix && !/^[a-zA-Z0-9_-]+$/.test(suffix))
        throw new Error("shot suffix must be filename-safe");
      const file = path.join(
        dir,
        `${opts.name}${suffix ? `-${suffix}` : ""}.png`,
      );
      const scope = surface(step.frame);
      const selector = step.selector ?? opts.selector;
      const target = scope.locator(selector ?? "body").first();
      const clippedViewport = () =>
        target.evaluate((element) => {
          let width = innerWidth;
          let height = innerHeight;
          for (
            let parent = element.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            const style = getComputedStyle(parent);
            if (/auto|scroll|hidden|clip/.test(style.overflowX))
              width = Math.min(width, parent.clientWidth);
            if (/auto|scroll|hidden|clip/.test(style.overflowY))
              height = Math.min(height, parent.clientHeight);
          }
          return { width, height };
        });
      const boundsBeforeScroll = await target.boundingBox();
      const targetClipViewportBeforeScroll = await clippedViewport();
      const viewportBeforeScroll = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      const oversizedBeforeScroll =
        boundsBeforeScroll &&
        (boundsBeforeScroll.width >
          Math.min(
            viewportBeforeScroll.width,
            targetClipViewportBeforeScroll.width,
          ) +
            1 ||
          boundsBeforeScroll.height >
            Math.min(
              viewportBeforeScroll.height,
              targetClipViewportBeforeScroll.height,
            ) +
              1);
      // Keep the caller's top/bottom scrolling evidence intact for tall stages.
      const scrollPolicy = oversizedBeforeScroll
        ? "preserve-position-oversized"
        : "scroll-fit-target-into-view";
      if (!oversizedBeforeScroll) await target.scrollIntoViewIfNeeded();
      const diagnostic = await inspectSurface(target);
      const focusedFrames = [];
      const frames = [];
      for (const frame of page.frames()) {
        const frameInfo = {
          url: frame.url(),
          name: frame.name(),
          errorPage: /^(?:chrome-error|edge-error):/.test(frame.url()),
        };
        frames.push(frameInfo);
        try {
          if (frame.parentFrame()) {
            const element = await frame.frameElement();
            frameInfo.src = await element.getAttribute("src");
            frameInfo.title = await element.getAttribute("title");
            frameInfo.hostBounds = await element.boundingBox();
            frameInfo.hostSurface = await inspectSurface(element);
            frameInfo.hostBackdrop = await element.evaluate((el) => {
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 1;
              const context = canvas.getContext("2d", {
                willReadFrequently: true,
              });
              if (!context) return null;
              let solid = null;
              for (let node = el; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (
                  Number(style.opacity) !== 1 ||
                  style.filter !== "none" ||
                  (style.backdropFilter && style.backdropFilter !== "none") ||
                  style.mixBlendMode !== "normal"
                )
                  return null;
                if (solid) continue;
                if (style.backgroundImage !== "none") return null;
                context.clearRect(0, 0, 1, 1);
                context.fillStyle = style.backgroundColor;
                context.fillRect(0, 0, 1, 1);
                const alpha = context.getImageData(0, 0, 1, 1).data[3];
                if (alpha === 255) solid = style.backgroundColor;
                else if (alpha > 0) return null;
              }
              return solid;
            });
            frameInfo.surface = await inspectSurface(
              frame.locator("body"),
              frameInfo.hostBackdrop,
            );
            await element.dispose();
          }
          frameInfo.document = await frame.evaluate(() => ({
            state: document.readyState,
            textLength: document.body?.innerText?.length ?? 0,
            title: document.title,
            reducedMotionMedia: matchMedia("(prefers-reduced-motion: reduce)")
              .matches,
            stageReducedMotion: globalThis.whiteboard?.reducedMotion ?? null,
            stageFrameKey: globalThis.whiteboard?.frame?.key ?? null,
            stageFrameIndex: globalThis.whiteboard?.frame?.index ?? null,
          }));
          const focused = await frame.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const r = el.getBoundingClientRect();
            return {
              tag: el.tagName.toLowerCase(),
              label:
                el.getAttribute("aria-label") ??
                el.textContent?.trim().slice(0, 80),
              rect: [r.x, r.y, r.width, r.height],
            };
          });
          if (focused) focusedFrames.push({ url: frame.url(), focused });
        } catch (error) {
          frameInfo.inspectionError = String(error);
        }
      }
      const targetBounds = await target.boundingBox();
      const viewportBeforeCapture = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      const targetClipViewport = await clippedViewport();
      const oversized =
        targetBounds &&
        (targetBounds.width >
          Math.min(viewportBeforeCapture.width, targetClipViewport.width) + 1 ||
          targetBounds.height >
            Math.min(viewportBeforeCapture.height, targetClipViewport.height) +
              1);
      const selectedTarget = Boolean(selector || step.frame || opts.frame);
      const captureMethod =
        selectedTarget && !oversized ? "element" : "viewport";
      const captureReason = oversized
        ? targetClipViewport.height < viewportBeforeCapture.height ||
          targetClipViewport.width < viewportBeforeCapture.width
          ? "target-exceeds-clipped-viewport"
          : "target-exceeds-viewport"
        : selectedTarget
          ? "selected-target-fits-viewport"
          : "full-workbench-viewport";
      // Electron can stitch/rescale oversized element screenshots incorrectly,
      // creating blank areas and misplaced workbench chrome. Preserve the real
      // viewport; the inspector captures scrolling evidence for the remainder.
      if (captureMethod === "element")
        await target.screenshot({ path: file, animations: "allow" });
      else
        await page.screenshot({
          path: file,
          animations: "allow",
          fullPage: false,
        });
      const viewportAfterCapture = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      const viewportUnchanged =
        viewportBeforeCapture.width === viewportAfterCapture.width &&
        viewportBeforeCapture.height === viewportAfterCapture.height;
      if (!viewportUnchanged)
        throw new Error(
          `Screenshot changed the viewport: ${JSON.stringify({ viewportBeforeCapture, viewportAfterCapture })}`,
        );
      files.push(file);
      captures.push({
        capturedAt: new Date().toISOString(),
        captureId: opts.name + (suffix ? "-" + suffix : ""),
        pngSha256: createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
        boundsBeforeScroll,
        targetClipViewportBeforeScroll,
        targetClipViewport,
        viewportBeforeScroll,
        scrollPolicy,
        targetBounds,
        captureMethod,
        captureReason,
        viewportBeforeCapture,
        viewportAfterCapture,
        viewportUnchanged,
        file,
        frame: step.frame ?? opts.frame ?? null,
        selector: selector ?? "body",
        diagnostic,
        focusedFrames,
        frames,
      });
    };
    for (const step of JSON.parse(opts.steps ?? "[]")) {
      const scope = surface(step.frame);
      if (step.press) {
        if (step.selector)
          await scope.locator(step.selector).first().press(step.press);
        else await page.keyboard.press(step.press);
      } else if (step.hover) await scope.locator(step.hover).first().hover();
      else if (step.click) await scope.locator(step.click).first().click();
      else if (step.settle) {
        await scope.locator("body").evaluate(async (body) => {
          const document = body.ownerDocument;
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const finite = document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState === "running" &&
                Number.isFinite(
                  Number(animation.effect?.getComputedTiming().endTime),
                ),
            );
          await Promise.allSettled(
            finite.map((animation) => animation.finished),
          );
        });
      } else if (typeof step.checked === "boolean")
        await scope.locator(step.selector).first().setChecked(step.checked);
      else if (step.focus) await scope.locator(step.focus).first().focus();
      else if (step.wait !== undefined) await sleep(step.wait);
      else if (step.shot) await capture(step.shot, step);
      else throw new Error(`unknown step ${JSON.stringify(step)}`);
    }
    await sleep(300);
    await capture();
    const evidence = path.join(dir, `${opts.name}.json`);
    const viewport = await page.evaluate(() => [innerWidth, innerHeight]);
    const media = await page.evaluate(() => ({
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      themeClasses:
        document.querySelector(".monaco-workbench")?.className ??
        document.body.className,
    }));
    const result = {
      viewport,
      media,
      capturedAt: new Date().toISOString(),
      request: {
        name: opts.name,
        size: opts.size ?? null,
        motion: opts.motion ?? "no-preference",
        steps: JSON.parse(opts.steps ?? "[]"),
      },
      files,
      evidence,
      captures,
      consoleErrors,
      note: "Clipping and overlap candidates require visual adjudication; this is not an automatic pass. Console capture covers this shot session only.",
    };
    await writeFile(evidence, JSON.stringify(result, null, 2));
    print(result);
  } finally {
    // Disconnects CDP; it does not stop the running Desktop.
    await browser.close();
  }
}

const commands = {
  restart: () => exclusive(restartOwned),
  stop: () => exclusive(async () => print({ stopped: await stopOwned() })),
  status: async () => {
    const state = await readState();
    const list = await processes();
    print({
      ...state,
      reservation: await readOwner(),
      desktopProcesses: desktopProcesses(list),
      identityVerified: ownsProcess(state, list),
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
