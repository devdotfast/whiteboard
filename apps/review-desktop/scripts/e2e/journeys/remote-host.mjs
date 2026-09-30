/** A review server on another machine, reached over SSH: a Docker container from remote/remote.mjs, added in Settings as a user would. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { createReview, openHome, openSettings } from "../harness.mjs";

const exec = promisify(execFile);

const remoteScript = path.join(import.meta.dirname, "../remote/remote.mjs");

// A live check sets WB_TEST_RUN so its trap can remove the run; otherwise the journey names its own.
const runId = process.env.WB_TEST_RUN ?? `e2e${Date.now().toString(36)}`;

const runDir = `/tmp/wbt.${runId}`;

const alias = "wb-test-a";

const title = "Remote order";

export const name = "remote-host";

// Phase 2: the container image downloads Ubuntu packages and Node.
export const phase = 2;

export const options = {
  settings: {
    "review.experimental.remoteHosts.enabled": true,
    "review.experimental.structuralDiff.enabled": true,
  },
  env: { DEV_FAST_REVIEW_SSH_CONFIG: `${runDir}/ssh_config` },
};

/** Runs on the remote: a repository with two commits, and a review of them with prose and a code peek. Prints its id. */
const createRemoteReview = String.raw`
set -e
uuid() { cat /proc/sys/kernel/random/uuid; }
field() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).$1"; }
rm -rf ~/wbrepo
git init -q -b main ~/wbrepo
cd ~/wbrepo
git config user.email e2e@example.invalid
git config user.name e2e
printf 'export function one() {\n  return 1;\n}\n' > f.ts
git add f.ts
git commit -qm one
printf 'export function one() {\n  return 2;\n}\n\nexport function two() {\n  return one() + 1;\n}\n' > f.ts
git commit -qam two
repo=$(whiteboard api session_register_repository "{\"path\":\"$HOME/wbrepo\"}" | field id)
id=$(whiteboard api session_create "{\"commandId\":\"$(uuid)\",\"title\":\"$1\",\"open\":false,\"target\":{\"kind\":\"commits\",\"repositoryId\":\"$repo\",\"base\":\"HEAD~1\",\"head\":\"HEAD\"}}" | field sessionId)
whiteboard api session_edit "{\"commandId\":\"$(uuid)\",\"sessionId\":\"$id\",\"edit\":{\"type\":\"insert\",\"content\":{\"type\":\"markdown\",\"markdown\":\"One now returns **two**.\"}}}" >/dev/null
whiteboard api session_edit "{\"commandId\":\"$(uuid)\",\"sessionId\":\"$id\",\"edit\":{\"type\":\"insert\",\"content\":{\"type\":\"code_peek\",\"source\":{\"file\":\"f.ts\",\"start\":{\"side\":\"head\",\"line\":5},\"end\":{\"side\":\"head\",\"line\":7}}}}}" >/dev/null
echo "$id"
`;

async function remote(...args) {
  return (
    await exec(process.execPath, [remoteScript, ...args], {
      env: { ...process.env, WB_TEST_RUN: runId },
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout.trim();
}

/** Runs `command` on the remote through the run's ssh_config, with `input` on stdin. */
function onRemote(command, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      ["-F", `${runDir}/ssh_config`, "-o", "BatchMode=yes", alias, command],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve(stdout.trim())
        : reject(new Error(`${command} on ${alias}: ${code}: ${stderr}`)),
    );
    child.stdin.end(input);
  });
}

const remoteApi = (tool, input) =>
  onRemote(`whiteboard api ${tool} -`, JSON.stringify(input));

/** The remote server's token, read the way Desktop reads it; kept only for comparison, never printed. */
async function remoteToken() {
  const out = (await onRemote("whiteboard remote attach --json")).split("\n");

  try {
    return JSON.parse(out[out.indexOf("WHITEBOARD-REMOTE-BEGIN") + 1]).token;
  } catch {
    // JSON.parse quotes the text it could not read, which may hold the token.
    throw new Error("whiteboard remote attach printed no attach line");
  }
}

/** Every request the workbench page sends, with its headers and outcome, from CDP's Network domain. */
async function recordRequests(page) {
  const cdp = await page.context().newCDPSession(page);
  const requests = new Map();
  const entry = (id) => requests.get(id) ?? requests.set(id, { id }).get(id);

  cdp.on("Network.requestWillBeSent", ({ requestId, request }) =>
    Object.assign(entry(requestId), {
      url: request.url,
      method: request.method,
      headers: { ...entry(requestId).headers, ...request.headers },
    }),
  );
  cdp.on("Network.requestWillBeSentExtraInfo", ({ requestId, headers }) =>
    Object.assign(entry(requestId), {
      headers: { ...entry(requestId).headers, ...headers },
    }),
  );
  cdp.on("Network.responseReceived", ({ requestId, response }) =>
    Object.assign(entry(requestId), { status: response.status }),
  );
  cdp.on("Network.loadingFailed", ({ requestId, errorText, canceled }) =>
    Object.assign(entry(requestId), { failed: errorText, canceled }),
  );
  await cdp.send("Network.enable");

  return requests;
}

// The laptop-only routes of the local server: everything but reviews, health and pings.
const DESKTOP_ROUTE =
  /^\/(app|control|crash-reports|diffr-config|install|preferences|remote-hosts|telemetry|tutorial)(\/|$)|^\/reviews-api\/[^/]+\/telemetry\//;

export async function run(ctx) {
  const { page, until } = ctx;

  try {
    await exec("docker", ["info", "--format", "{{.ServerVersion}}"]);
  } catch (error) {
    throw new Error(
      `skip: remote-host needs Docker for its SSH server (${error.message.split("\n")[0]})`,
    );
  }

  try {
    await journey(ctx, page, until);
  } finally {
    await remote("down", "--all").catch((error) =>
      console.error(`[remote-host] down --all: ${error.message}`),
    );
  }
}

async function journey(ctx, page, until) {
  const requests = await recordRequests(page);
  const remoteTokens = new Set();
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const timings = {};

  const hostState = async () =>
    (await ctx.apiOk("/remote-hosts")).find((host) => host.alias === alias);

  const waitState = (state, label, timeout) =>
    until(
      async () => (await hostState())?.state === state,
      `${alias} ${label}`,
      timeout,
    );

  await remote("up", "a");
  await remote("install", "a");

  const reviewId = await onRemote(`bash -s -- '${title}'`, createRemoteReview);

  assert.match(reviewId, /^[0-9a-f-]{36}$/, "the remote review's id");
  remoteTokens.add(await remoteToken());
  ctx.check("a container with sshd and this checkout's package holds a review");

  // 1. Settings, as a user adds a host.
  let settings = await openSettings(ctx);
  let section = settings.getByRole("region", { name: "Remote hosts" });

  await until(
    async () =>
      (
        await section
          .locator("#remote-host-suggestions option")
          .evaluateAll((options) => options.map((o) => o.value))
      ).includes(alias),
    `${alias} among the suggestions from the test ssh_config`,
  );
  await section.getByLabel("SSH alias").fill(alias);

  const added = Date.now();

  await section.getByRole("button", { name: "Add", exact: true }).click();
  await until(
    async () => (await hostState())?.state === "online",
    `${alias} online`,
    60000,
  );
  timings.addToOnline = Date.now() - added;

  const hostRow = () =>
    section.locator("[data-remote-host]").filter({ hasText: alias });

  await until(
    async () => /\bonline\b/.test(await hostRow().innerText()),
    "the Settings row to read online",
  );
  ctx.check(
    `1. Settings added ${alias}; online ${timings.addToOnline} ms after Add`,
  );

  // 2. Home lists the remote review under the host's label.
  await openHome(ctx);

  const rows = page
    .locator("main.review-home")
    .getByRole("region", { name: "Sessions", exact: true })
    .locator("tbody tr");

  const row = (text) => rows.filter({ hasText: text });

  await row(title).waitFor({ timeout: 60000 });
  assert.match(await row(title).innerText(), /wb-test-a: wbrepo/);
  assert.equal(await row(title).getAttribute("data-unavailable"), null);
  ctx.check("2. Home lists the remote review as wb-test-a: wbrepo");

  // 3. Open it: the document, its code peek, the Diff view and the structural diff.
  const canvas = page.locator(".review-canvas-root [data-review-api]");
  const peek = canvas.locator('[data-review-inline-editor="f.ts"]');
  const opened = Date.now();

  await row(title).getByTitle(title, { exact: true }).click();
  await canvas
    .getByRole("heading", { name: title })
    .waitFor({ timeout: 60000 });
  await canvas.getByText("One now returns").waitFor();
  timings.openReview = Date.now() - opened;
  await until(
    async () => (await lines(peek)).includes("return one() + 1;"),
    "the code peek's lines from the remote",
  );
  timings.codePeek = Date.now() - opened;
  ctx.check(
    `3a. document ${timings.openReview} ms and code peek ${timings.codePeek} ms after the click in Home`,
  );

  const view = (label) =>
    page.locator(`[aria-label="Session views"] button[aria-label="${label}"]`);

  await view("Diff").click();
  await until(
    async () =>
      (await page.locator(".review-path-label").allInnerTexts()).some((t) =>
        t.includes("f.ts"),
      ) && (await lines(page)).includes("return 2;"),
    "the Diff view to show f.ts",
  );

  const structural = () =>
    [...requests.values()].find(
      (r) =>
        r.url?.includes(`/reviews-api/${reviewId}/structural-diff`) &&
        r.status === 200,
    );

  await until(structural, "a 200 structural-diff read through the gateway");
  ctx.check("3b. the Diff view shows f.ts, and its structural diff answered");
  await view("Whiteboard").click();

  // 4. An edit on the remote reaches the open tab without a reload.
  await remoteApi("session_edit", {
    commandId: crypto.randomUUID(),
    sessionId: reviewId,
    edit: {
      type: "insert",
      content: { type: "markdown", markdown: "Edited on the remote." },
    },
  });
  await canvas.getByText("Edited on the remote.").waitFor({ timeout: 30000 });
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  ctx.check("4. an edit on the remote updates the open tab without a reload");

  // 5. An agent on the remote opens a new review on this laptop.
  const second = "Opened from the remote";
  await onRemote(
    `cd ~/wbrepo && whiteboard api session_create -`,
    JSON.stringify({
      commandId: crypto.randomUUID(),
      title: second,
      open: true,
      target: {
        kind: "commits",
        repositoryId: JSON.parse(
          await remoteApi("session_register_repository", {
            path: "/home/dev/wbrepo",
          }),
        ).id,
        base: "HEAD~1",
        head: "HEAD",
      },
    }),
  );

  const tab = (text) =>
    page.locator(".tabs-container .tab").filter({ hasText: text });

  await tab(second).waitFor({ timeout: 30000 });
  await canvas.getByRole("heading", { name: second }).waitFor();
  ctx.check(`5. session_create with open: true on the remote opened a tab`);

  // 6. The ssh master dies: the review says so, then recovers in the same page.
  await tab(title).click();
  await canvas.getByRole("heading", { name: title }).waitFor();
  await page.evaluate(() => {
    const seen = (window.__remoteHostBanner = []);

    new MutationObserver(() => {
      for (const status of document.querySelectorAll(
        ".review-canvas-root [role=status]",
      ))
        if (
          status.textContent.startsWith("Connection lost") &&
          !seen.includes(status.textContent)
        )
          seen.push(status.textContent);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });

  const master = await masterPid();

  assert.ok(master, "no ssh master for the host");
  process.kill(master, "SIGKILL");
  await until(
    () => page.evaluate(() => window.__remoteHostBanner.length > 0),
    "the Connection lost banner",
    30000,
  );
  await until(
    async () =>
      (await hostState())?.state === "online" && (await masterPid()) !== master,
    `${alias} online on a new master`,
    60000,
  );
  await until(
    async () =>
      (await canvas
        .locator("[role=status]")
        .filter({ hasText: "Connection lost" })
        .count()) === 0,
    "the banner to clear",
  );
  await remoteApi("session_edit", {
    commandId: crypto.randomUUID(),
    sessionId: reviewId,
    edit: {
      type: "insert",
      content: { type: "markdown", markdown: "After the reconnect." },
    },
  });
  await canvas.getByText("After the reconnect.").waitFor({ timeout: 30000 });
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  ctx.check(
    `6. a killed ssh master showed "${await page.evaluate(() => window.__remoteHostBanner[0])}" and the review recovered in the same page`,
  );

  // 7. A hung server: offline within 15 s, and a laptop review still opens at once.
  const serverPid = JSON.parse(
    await onRemote("whiteboard server status --json"),
  ).serverPid;

  const stopped = Date.now();

  await onRemote(`kill -STOP ${serverPid}`);
  await waitState("offline", "offline after SIGSTOP", 20000);
  timings.offline = Date.now() - stopped;
  assert.ok(timings.offline <= 15000, `offline after ${timings.offline} ms`);

  const laptopOpened = Date.now();

  await createReview(ctx, {
    title: "Laptop order",
    blocks: [{ type: "markdown", markdown: "On this laptop." }],
  });
  timings.laptopOpen = Date.now() - laptopOpened;
  assert.ok(
    timings.laptopOpen < 5000,
    `a laptop review took ${timings.laptopOpen} ms`,
  );
  await onRemote(`kill -CONT ${serverPid}`);
  await waitState("online", "online after SIGCONT", 30000);
  ctx.check(
    `7. SIGSTOP: offline after ${timings.offline} ms; a laptop review opened in ${timings.laptopOpen} ms; SIGCONT: online`,
  );

  // 8. Another version on the remote: incompatible, the install command, and its reviews stay listed.
  await remote("install", "a", "--version", "0.0.2-e2e");
  await onRemote("whiteboard server stop");
  await waitState("incompatible", "incompatible", 60000);
  remoteTokens.add(await remoteToken());
  settings = await openSettings(ctx);
  section = settings.getByRole("region", { name: "Remote hosts" });
  await until(
    async () => /incompatible/.test(await hostRow().innerText()),
    "the Settings row to read incompatible",
  );
  assert.match(
    await hostRow().locator("code").innerText(),
    /^npm install -g @dev\.fast\/whiteboard@\d+\.\d+\.\d+/,
  );
  await openHome(ctx);

  for (const text of [title, second]) {
    await row(text).waitFor();
    assert.equal(await row(text).getAttribute("data-unavailable"), "");
    assert.match(await row(text).innerText(), /incompatible/);
  }

  ctx.check(
    "8. another version made the host incompatible, Settings shows the install command, and its reviews stay listed",
  );

  // What docs/remote-hosts.md says to do: install the matching version, then restart the server.
  await remote("install", "a");
  await onRemote("whiteboard server stop");
  await waitState("online", "online after the matching install", 60000);
  remoteTokens.add(await remoteToken());
  await until(
    async () => (await row(title).getAttribute("data-unavailable")) === null,
    "the remote review to be available again",
  );
  ctx.check(
    "8b. installing the matching version and stopping the server brought the host back online",
  );

  // 9. Removing the host takes its reviews out of Home.
  settings = await openSettings(ctx);
  section = settings.getByRole("region", { name: "Remote hosts" });
  await section.getByRole("button", { name: `Remove ${alias}` }).click();
  await until(async () => (await hostRow().count()) === 0, "the row to go");
  await openHome(ctx);
  await row("Laptop order").waitFor();
  await until(
    async () => (await row(title).count()) + (await row(second).count()) === 0,
    "the remote reviews to leave Home",
  );
  assert.ok(
    (await ctx.apiOk("/reviews-api")).every((review) => !review.host),
    "the list still has a remote entry",
  );
  await until(async () => !(await masterPid()), "the master to end");
  ctx.check("9. removing the host in Settings took its reviews out of Home");

  // 10. Throughout: every Desktop route answered, the UI spoke only to the local server, and no remote token reached it.
  const seen = [...requests.values()].filter((r) => r.url);
  const localServer = new URL(ctx.discovery.url).origin;

  const loopback = seen.filter((r) =>
    /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(r.url),
  );

  const desktopRoutes = loopback.filter((r) =>
    DESKTOP_ROUTE.test(new URL(r.url).pathname),
  );

  const failed = desktopRoutes.filter(
    (r) => (r.status ?? 0) >= 400 || (r.failed && !r.canceled),
  );

  assert.ok(desktopRoutes.length > 0, "no Desktop route was requested");
  assert.deepEqual(
    failed.map((r) => `${r.method} ${r.url} ${r.status ?? r.failed}`),
    [],
    "failed Desktop routes",
  );
  assert.deepEqual(
    loopback.flatMap((r) =>
      new URL(r.url).origin === localServer ? [] : [r.url],
    ),
    [],
    "requests past the local server",
  );

  const header = (r) =>
    Object.entries(r.headers ?? {}).find(
      ([key]) => key.toLowerCase() === "x-review-token",
    )?.[1];

  assert.ok(
    loopback.some(header),
    "no request carried a token, so the check proves nothing",
  );
  assert.equal(
    seen.filter((r) =>
      [r.url, ...Object.values(r.headers ?? {})].some((value) =>
        [...remoteTokens].some((token) => String(value).includes(token)),
      ),
    ).length,
    0,
    "requests that carried a remote token",
  );
  ctx.check(
    `10. ${loopback.length} requests to the local server, ${desktopRoutes.length} of them Desktop routes: none failed, none went elsewhere, none carried either remote token`,
  );
}

/** Monaco's rendered lines under `scope`, with its non-breaking spaces made plain. */
async function lines(scope) {
  return (await scope.locator(".view-line").allInnerTexts())
    .join("\n")
    .replaceAll("\u00a0", " ");
}

/** The pid of this Desktop's ssh master for the alias, found by its arguments. */
async function masterPid() {
  const { stdout } = await exec("ps", ["-axo", "pid=,args="]);

  for (const line of stdout.split("\n")) {
    const match = line.trim().match(/^(\d+) (.*)$/);

    if (
      match &&
      /(^|\/)ssh /.test(match[2]) &&
      match[2].includes(` -M -N `) &&
      match[2].includes(`-F ${runDir}/ssh_config`) &&
      match[2].endsWith(`-- ${alias}`)
    )
      return Number(match[1]);
  }

  return undefined;
}
