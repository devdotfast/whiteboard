import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const app = process.env.APP;

if (!/^whiteboard(?:-preview)?$/.test(app ?? ""))
  throw new Error("Set APP to whiteboard or whiteboard-preview");

const state = await mkdtemp(path.join(os.tmpdir(), "whiteboard-install-"));

const profile = `${state}/profile`;

const portServer = createServer();

await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));

const port = portServer.address().port;

await new Promise((resolve) => portServer.close(resolve));

let output = "";

const child = spawn(
  process.env.REVIEW_LINUX_DESKTOP_COMMAND ?? `/usr/bin/${app}-desktop`,
  [
    `--user-data-dir=${profile}`,
    `--extensions-dir=${state}/extensions`,
    `--remote-debugging-port=${port}`,
  ],
  {
    env: {
      ...process.env,
      DEV_REVIEW_HOME: `${state}/reviews`,
      DEV_REVIEW_IMPORT_FROM: "none",
      DO_NOT_TRACK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

child.stdout.on("data", (data) => (output += data));

child.stderr.on("data", (data) => (output += data));

let exited = false;

const exit = new Promise((resolve) => {
  child.once("error", (error) => {
    output += String(error);
    exited = true;
    resolve();
  });
  child.once("exit", () => {
    exited = true;
    resolve();
  });
});

async function remote(method, params = {}) {
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2000),
  }).then((response) => response.json());

  const page = pages.find(
    (page) => page.type === "page" && page.url.startsWith("vscode-file://"),
  );

  if (!page?.webSocketDebuggerUrl)
    throw new Error("Desktop renderer is not ready");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let timer;

  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Desktop inspection timed out")),
        10000,
      );
      socket.addEventListener("error", () =>
        reject(new Error("Desktop inspection failed")),
      );
      socket.addEventListener("open", () =>
        socket.send(JSON.stringify({ id: 1, method, params })),
      );
      socket.addEventListener("message", ({ data }) => {
        const result = JSON.parse(data);

        if (result.id !== 1) return;

        if (result.error) reject(result.error);
        else resolve(result.result);
      });
    });
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}

const evaluate = async (expression) =>
  (await remote("Runtime.evaluate", { expression, returnByValue: true })).result
    ?.value;

async function screenshot(file) {
  if (!file) return;
  const { data } = await remote("Page.captureScreenshot");
  await writeFile(file, Buffer.from(data, "base64"));
}

async function mainLog() {
  const logs = `${profile}/logs`;
  let text = "";

  for (const entry of await readdir(logs).catch(() => []))
    text += await readFile(`${logs}/${entry}/main.log`, "utf8").catch(() => "");

  return text;
}

const alive = async () =>
  /\[Review Desktop\] server ready at https?:\/\//.test(await mainLog()) &&
  (await evaluate(
    'Boolean(document.querySelector(".review-onboarding-headline")?.getBoundingClientRect().height)',
  ).catch(() => false)) === true;

try {
  const deadline = Date.now() + 180_000;
  let ready = false;

  while (!ready && Date.now() < deadline && !exited) {
    ready = await alive();

    if (!ready) await delay(500);
  }

  assert.ok(
    ready,
    "Installed app did not render onboarding and start its bundled server",
  );
  await screenshot(process.env.SMOKE_SCREENSHOT);
  console.log(`${app}: onboarding rendered and bundled server ready.`);
} catch (error) {
  console.error(await evaluate("document.body.innerText").catch(() => ""));
  console.error(await mainLog());
  console.error(output.replaceAll(/"token":"[^"]*"/g, '"token":"[redacted]"'));
  throw error;
} finally {
  if (!exited) child.kill("SIGTERM");
  await Promise.race([exit, delay(5000)]);

  if (!exited) {
    child.kill("SIGKILL");
    await exit;
  }

  await rm(state, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
