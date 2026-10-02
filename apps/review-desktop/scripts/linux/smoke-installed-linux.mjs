import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const app = process.env.APP;

if (!/^whiteboard(?:-preview)?$/.test(app ?? ""))
  throw new Error("Set APP to whiteboard or whiteboard-preview");

const state = await mkdtemp(path.join(os.tmpdir(), "whiteboard-install-"));

const protocol = process.env.SMOKE_DEEP_LINK_PROTOCOL;

const shareNotification =
  'document.body.innerText.includes("Invalid Whiteboard share link.")';

const profile = protocol ? `${state}/portable/user-data` : `${state}/profile`;

const extensions = protocol
  ? `${state}/portable/extensions`
  : `${state}/extensions`;

const environment = {
  ...process.env,
  DEV_REVIEW_HOME: `${state}/reviews`,
  DEV_REVIEW_IMPORT_FROM: "none",
  DO_NOT_TRACK: "1",
};

if (protocol) {
  environment.VSCODE_PORTABLE = `${state}/portable`;

  await mkdir(`${state}/portable`, { recursive: true });
}

if (process.env.SMOKE_RUST_VSIX) {
  console.log(`${app}: installing optional Rust extension.`);
  await promisify(execFile)(
    process.execPath,
    [
      path.join(path.dirname(process.execPath), "resources/app/out/cli.js"),
      "--install-extension",
      process.env.SMOKE_RUST_VSIX,
      `--user-data-dir=${profile}`,
      `--extensions-dir=${extensions}`,
      "--force",
    ],
    { env: { ...environment, ELECTRON_RUN_AS_NODE: "1" } },
  );
}

const portServer = createServer();

await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));

const port = portServer.address().port;

await new Promise((resolve) => portServer.close(resolve));

let output = "";

const child = spawn(
  process.env.REVIEW_LINUX_DESKTOP_COMMAND ?? `/usr/bin/${app}-desktop`,
  [
    `--user-data-dir=${profile}`,
    `--extensions-dir=${extensions}`,
    `--remote-debugging-port=${port}`,
    ...(protocol
      ? [
          "--log=trace",
          "--open-url",
          "--",
          `${protocol}://share/nixos-cold?origin=invalid`,
        ]
      : []),
  ],
  {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

child.stdout.on("data", (data) => {
  output += data;
});

child.stderr.on("data", (data) => {
  output += data;
});

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
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2000),
  });

  const pages = await response.json();

  const page = pages.find(
    (page) => page.type === "page" && page.url.startsWith("vscode-file://"),
  );

  if (!page?.webSocketDebuggerUrl)
    throw new Error("Desktop renderer is not ready");

  const socket = new WebSocket(page.webSocketDebuggerUrl);

  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Desktop inspection timed out")),
        10000,
      );

      const finish = (error, result) => {
        clearTimeout(timer);

        if (error) reject(error);
        else resolve(result);
      };

      socket.addEventListener("error", () =>
        finish(new Error("Desktop inspection failed")),
      );
      socket.addEventListener("open", () =>
        socket.send(JSON.stringify({ id: 1, method, params })),
      );
      socket.addEventListener("message", ({ data }) => {
        const result = JSON.parse(data);

        if (result.id === 1) finish(result.error, result.result);
      });
    });
  } finally {
    socket.close();
  }
}

async function evaluate(expression) {
  const result = await remote("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });

  return result.result?.value;
}

async function screenshot(file) {
  const result = await remote("Page.captureScreenshot");

  await writeFile(file, Buffer.from(result.data, "base64"));
}

async function renderedOnboarding() {
  const rendered = await evaluate(
    'Boolean(document.querySelector(".review-onboarding-headline")?.getBoundingClientRect().height)',
  );

  if (rendered && process.env.SMOKE_SCREENSHOT)
    await screenshot(process.env.SMOKE_SCREENSHOT);

  return rendered === true;
}

async function waitFor(expression) {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline && !exited) {
    if (await evaluate(expression).catch(() => false)) return;
    await delay(250);
  }

  throw new Error(`Desktop did not satisfy: ${expression}`);
}

async function deepLinks(coldObserved) {
  if (!coldObserved) {
    await waitFor(shareNotification);

    if (process.env.SMOKE_SCREENSHOT)
      await screenshot(
        process.env.SMOKE_SCREENSHOT.replace(/\.png$/, "-cold-link.png"),
      );
  }

  await evaluate(
    'document.querySelectorAll(".notifications-toasts .codicon-notifications-clear").forEach(button => button.click())',
  );
  await waitFor(`!(${shareNotification})`);
  console.log(`${app}: cold link observed; dispatching warm link.`);
  await new Promise((resolve, reject) => {
    const opener = spawn(
      "xdg-open",
      [`${protocol}://share/nixos-warm?origin=invalid`],
      { env: environment, stdio: "ignore", timeout: 30000 },
    );

    opener.once("error", reject);
    opener.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Protocol opener exited: ${code}, ${signal}`));
    });
  });
  await waitFor(shareNotification);

  if (process.env.SMOKE_SCREENSHOT) {
    await screenshot(
      process.env.SMOKE_SCREENSHOT.replace(/\.png$/, "-deep-links.png"),
    );
  }

  const renderers = [];

  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue;

    const command = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(
      () => "",
    );

    if (!command.includes("--type=renderer") || !command.includes(app))
      continue;
    assert.ok(
      !command.includes("--no-sandbox"),
      "Renderer sandbox was disabled",
    );
    const status = await readFile(`/proc/${pid}/status`, "utf8");

    assert.match(
      status,
      /^Seccomp:\s+2$/m,
      "Renderer seccomp filter is not active",
    );
    renderers.push(pid);
  }

  assert.ok(renderers.length > 0, "No sandboxed Electron renderer found");
  console.log(
    `${app}: cold/warm protocol dispatch and renderer seccomp passed.`,
  );
}

async function rustExtension() {
  console.log(`${app}: activating optional Rust extension.`);
  const directory = `${state}/rust`;

  await mkdir(`${directory}/src`, { recursive: true });
  await writeFile(
    `${directory}/Cargo.toml`,
    '[package]\nname = "nixos-smoke"\nversion = "0.0.0"\nedition = "2021"\n',
  );
  await writeFile(
    `${directory}/src/main.rs`,
    'fn main() { println!("NixOS"); }\n',
  );

  const git = (...args) =>
    promisify(execFile)("git", args, { cwd: directory, env: environment });

  await git("init", "-b", "main");
  await git("add", ".");
  await git(
    "-c",
    "user.name=NixOS CI",
    "-c",
    "user.email=ci@dev.fast",
    "commit",
    "-m",
    "Rust fixture",
  );

  const { stdout } = await git("rev-parse", "HEAD");

  const key = app.endsWith("-preview") ? "preview" : "stable";

  const connection = JSON.parse(
    await readFile(
      `${state}/reviews/review-desktop/instances/${key}.json`,
      "utf8",
    ),
  );

  const post = async (route, body) => {
    const response = await fetch(`${connection.url}/reviews-api${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-review-token": connection.token,
      },
      body: JSON.stringify(body),
    });

    assert.ok(
      response.ok,
      `Rust fixture request ${route}: ${response.status} ${await response.clone().text()}`,
    );

    return response.json();
  };

  const repository = await post("/repositories", { path: directory });

  const pins = await post("/pins", {
    repositoryId: repository.id,
    base: stdout.trim(),
    head: stdout.trim(),
  });

  const created = await post("/commands", {
    commandId: randomUUID(),
    operation: { type: "create", title: "NixOS Rust", pins, open: true },
  });

  const { leaseId } = await post(`/${created.reviewId}/activity/begin`, {
    scope: "document",
  });

  await post("/commands", {
    commandId: randomUUID(),
    leaseId,
    operation: {
      type: "edit",
      reviewId: created.reviewId,
      edit: {
        type: "insert",
        content: {
          type: "code_peek",
          source: {
            file: "src/main.rs",
            start: { side: "head", line: 1 },
            end: { side: "head", line: 1 },
          },
        },
      },
    },
  });
  await post(`/${created.reviewId}/activity/end`, { leaseId });
  await post(`/${created.reviewId}/open`, {});
  await waitFor(
    'Boolean(document.querySelector(".code-peek .monaco-editor .view-lines"))',
  );

  const position = await evaluate(
    '(() => { const rect = document.querySelector(".code-peek .monaco-editor .view-lines").getBoundingClientRect(); return { x: rect.left + 40, y: rect.top + 10 }; })()',
  );

  await remote("Input.dispatchMouseEvent", { type: "mouseMoved", ...position });

  const deadline = Date.now() + 60000;

  while (Date.now() < deadline && !exited) {
    for (const pid of await readdir("/proc")) {
      if (!/^\d+$/.test(pid)) continue;

      const command = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(
        () => "",
      );

      if (
        command.includes("rust-analyzer") &&
        command.includes(state) &&
        !command.includes("--version")
      ) {
        if (process.env.SMOKE_SCREENSHOT)
          await screenshot(
            process.env.SMOKE_SCREENSHOT.replace(/\.png$/, "-rust.png"),
          );

        console.log(
          `${app}: optional Rust extension activated its downloaded server (pid ${pid}).`,
        );

        return;
      }
    }

    await delay(500);
  }

  throw new Error(
    "Optional Rust extension did not start its downloaded language server",
  );
}

async function serverReady() {
  const logs = `${profile}/logs`;

  for (const entry of await readdir(logs)) {
    const main = await readFile(`${logs}/${entry}/main.log`, "utf8").catch(
      () => "",
    );

    if (/\[Review Desktop\] server ready at https?:\/\//.test(main))
      return true;
  }

  return false;
}

try {
  const deadline = Date.now() + 180_000;
  let ready = false;
  let coldLinkObserved = false;

  while (Date.now() < deadline && !exited) {
    if (protocol && !coldLinkObserved) {
      coldLinkObserved = await evaluate(shareNotification).catch(() => false);

      if (coldLinkObserved && process.env.SMOKE_SCREENSHOT)
        await screenshot(
          process.env.SMOKE_SCREENSHOT.replace(/\.png$/, "-cold-link.png"),
        );
    }

    if (
      (await serverReady().catch(() => false)) &&
      (await renderedOnboarding().catch(() => false))
    ) {
      ready = true;
      break;
    }

    await delay(500);
  }

  assert.ok(
    ready,
    "Installed app did not render onboarding and start its bundled server",
  );

  console.log(`${app}: onboarding and bundled server ready.`);

  if (protocol) await deepLinks(coldLinkObserved);

  if (process.env.SMOKE_RUST_VSIX) await rustExtension();

  if (process.env.APPARMOR_PROFILE) {
    const profile = await readFile(`/proc/${child.pid}/attr/current`, "utf8");
    assert.ok(
      profile.startsWith(`${process.env.APPARMOR_PROFILE} `),
      `Unexpected AppArmor profile: ${profile}`,
    );
  }

  console.log(
    `${app}: onboarding rendered and bundled server ready, with sandboxing enabled.`,
  );
} catch (error) {
  console.error(await evaluate("document.body.innerText").catch(() => ""));

  for (const entry of await readdir(`${profile}/logs`).catch(() => [])) {
    const log = await readFile(
      `${profile}/logs/${entry}/main.log`,
      "utf8",
    ).catch(() => "");

    console.error(
      log
        .split("\n")
        .filter((line) => /[Uu][Rr][Ll]|protocol/i.test(line))
        .join("\n"),
    );
  }

  if (process.env.SMOKE_SCREENSHOT)
    await screenshot(
      process.env.SMOKE_SCREENSHOT.replace(/\.png$/, "-failure.png"),
    ).catch(() => {});
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
