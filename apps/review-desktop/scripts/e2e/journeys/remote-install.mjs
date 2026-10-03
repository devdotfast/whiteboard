/** Desktop installs itself on remote hosts it reaches over SSH: containers from remote/remote.mjs with nothing installed by hand, added in Settings as a user would. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { openHome, openSettings, sourcePackage } from "../harness.mjs";

const exec = promisify(execFile);

const remoteScript = path.join(import.meta.dirname, "../remote/remote.mjs");

// A live check sets WB_TEST_RUN so its trap can remove the run; otherwise the journey names its own.
const runId = process.env.WB_TEST_RUN ?? `e2e${Date.now().toString(36)}`;

const runDir = `/tmp/wbt.${runId}`;

// Hosts a user brought up (`aws-up`) in the WB_TEST_RUN run, never given Whiteboard: only steps 1 and 12 run, and the run is kept.
const prepared = process.env.REVIEW_E2E_REMOTE_HOSTS?.split(",").filter(Boolean);

// The containers, by role. On an Apple-silicon Mac `arm` is native and `fresh` runs under emulation, so both targets install.
const CONTAINERS = {
  fresh: ["--platform", "linux/amd64", "--node", "none"],
  node: ["--node", "24"],
  sealed: ["--sealed", "--node", "none"],
  old: ["--image", "debian:11", "--node", "none"],
  arm: ["--platform", "linux/arm64", "--node", "none"],
  fresh2: ["--platform", "linux/amd64", "--node", "none"],
  deny: ["--node", "none"],
};

const alias = (name) => `wb-test-${name}`;

const ROOT = "~/.dev/whiteboard-remote";

const WHITEBOARD = "~/.local/bin/whiteboard";

// Task 5's agent: its npm package carries a native binary, so it runs on a host without Node.
const CLAUDE_CODE = "@anthropic-ai/claude-code@2.1.286";

const title = "Installed remote order";

const MINUTE = 60_000;

export const name = "remote-install";

// Phase 2: the images download Ubuntu and Debian packages, and the remotes download Node and npm packages.
export const phase = 2;

export const options = {
  settings: { "review.experimental.remoteHosts.enabled": true },
  env: { DEV_FAST_REVIEW_SSH_CONFIG: `${runDir}/ssh_config` },
};

async function remote(args, timeout = 15 * MINUTE) {
  return (
    await exec(process.execPath, [remoteScript, ...args], {
      env: { ...process.env, WB_TEST_RUN: runId },
      maxBuffer: 16 * 1024 * 1024,
      timeout,
      killSignal: "SIGKILL",
    })
  ).stdout.trim();
}

/** Runs `command` on `host` through the run's ssh_config, with `input` on stdin; killed after `timeout`. */
function onRemote(host, command, { input = "", timeout = 2 * MINUTE } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      ["-F", `${runDir}/ssh_config`, "-o", "BatchMode=yes", host, command],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timer);

      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(
            `${command} on ${host}: ${signal ?? code}: ${stderr.slice(-2000)}`,
          ),
        );
    });
    child.stdin.end(input);
  });
}

const remoteApi = async (host, tool, input) =>
  JSON.parse(
    await onRemote(host, `${WHITEBOARD} api ${tool} -`, {
      input: JSON.stringify(input),
    }),
  );

export async function run(ctx) {
  // A packaged build ignores DEV_FAST_REVIEW_SSH_CONFIG, so its ssh would read the user's configuration.
  if (ctx.report.mode === "packaged")
    throw new Error("skip: remote-install runs in development mode only");

  if (!prepared)
    try {
      await exec("docker", ["info", "--format", "{{.ServerVersion}}"], {
        timeout: 30_000,
      });
    } catch (error) {
      throw new Error(
        `skip: remote-install needs Docker for its SSH servers (${error.message.split("\n")[0]})`,
      );
    }

  const manifestPath = path.join(sourcePackage, "package.json");
  const manifest = await readFile(manifestPath, "utf8");

  try {
    await (prepared ? preparedJourney(ctx) : journey(ctx, manifestPath));
  } finally {
    // Step 7 raises the version; a write when nothing changed would still rebuild the package on the next launch.
    if ((await readFile(manifestPath, "utf8")) !== manifest)
      await writeFile(manifestPath, manifest);

    await closeDesktop(ctx);

    if (!prepared)
      await remote(["down", "--all"], 5 * MINUTE).catch((error) =>
        console.error(`[remote-install] down --all: ${error.message}`),
      );
  }
}

/**
 * Quits the Desktop the way a user does, so it closes its masters, then ends
 * any of its ssh that outlived it. The harness's own close still runs afterwards.
 */
async function closeDesktop(ctx) {
  const session = await ctx.browser.newBrowserCDPSession().catch(() => null);

  // The browser drops the connection as it closes, so this answer may never come.
  await Promise.race([
    session?.send("Browser.close").catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);

  for (let i = 0; i < 40 && (await desktopSsh()).length; i++)
    await new Promise((resolve) => setTimeout(resolve, 250));

  for (const [pid] of await desktopSsh()) process.kill(pid, "SIGTERM");
}

/** The Desktop's ssh processes for this run, as `[pid, args]`: they name a control socket (`-S`), which the journey's own ssh never does. */
async function desktopSsh() {
  const { stdout } = await exec("ps", ["-axo", "pid=,args="], {
    timeout: 10_000,
  });

  return stdout
    .split("\n")
    .map((line) => line.trim().match(/^(\d+) (.*)$/))
    .filter(
      (match) =>
        match &&
        /(^|\/)ssh /.test(match[2]) &&
        match[2].includes(`-F ${runDir}/ssh_config -S `),
    )
    .map((match) => [Number(match[1]), match[2]]);
}

/** The pid of the Desktop's ssh master for `host`. */
const masterPid = async (host) =>
  (await desktopSsh()).find(
    ([, args]) => args.includes(" -M -N ") && args.endsWith(`-- ${host}`),
  )?.[0];

/**
 * What the journey watches: every state `/remote-hosts` reports, polled, and
 * in the page every install question shown and every text a Settings row
 * shows, so a step that passes between two looks is still seen.
 */
function watcher(ctx) {
  const history = new Map();
  let stopped = false;

  const poll = (async () => {
    while (!stopped) {
      try {
        for (const host of await ctx.apiOk("/remote-hosts")) {
          const seen = history.get(host.alias) ?? [];
          const last = seen.at(-1);

          if (
            last?.state !== host.state ||
            last?.detail !== host.detail ||
            last?.declined !== host.declined
          )
            seen.push({ ...host, at: Date.now() });

          history.set(host.alias, seen);
        }
      } catch {
        // A restarting Desktop does not answer for a while.
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  })();

  return {
    history: (host) => history.get(host) ?? [],
    stop: async () => {
      stopped = true;
      await poll;
    },
  };
}

/** Records, in the page, each install question as it opens and each text of each Settings row. Again after every relaunch. */
async function watchPage(page) {
  await page.evaluate(() => {
    const ui = (window.__remoteInstall = { prompts: [], rows: {} });
    let open = false;

    const look = () => {
      const title = [
        ...document.querySelectorAll(".quick-input-widget .quick-input-title"),
      ].find(
        (e) =>
          e.offsetParent !== null &&
          e.textContent.startsWith("Install Whiteboard on "),
      );

      if (title && !open)
        ui.prompts.push({ title: title.textContent, at: Date.now() });

      open = Boolean(title);

      for (const row of document.querySelectorAll("[data-remote-host]")) {
        const [label, detail] = row.firstElementChild?.children ?? [];
        const rows = (ui.rows[label?.textContent] ??= []);
        const text = detail?.textContent;

        if (text && rows.at(-1) !== text) rows.push(text);
      }
    };

    new MutationObserver(look).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "class", "aria-hidden"],
    });
  });
}

/** Every main.log of the Desktop's profile so far: where the hosts log their states. */
async function mainLog(ctx) {
  const logs = path.join(ctx.userData, "logs");

  const files = (await readdir(logs, { recursive: true })).filter((file) =>
    file.endsWith("main.log"),
  );

  return (
    await Promise.all(files.map((file) => readFile(path.join(logs, file), "utf8")))
  ).join("\n");
}

const pageRecord = (ctx) => ctx.page.evaluate(() => window.__remoteInstall);

async function journey(ctx, manifestPath) {
  const { until } = ctx;
  const timings = {};

  // Nothing is installed on any container: no Node on most, no Whiteboard on any.
  for (const [host, flags] of Object.entries(CONTAINERS))
    await remote(["up", host, ...flags]);
  ctx.check(
    `0. containers up, Whiteboard on none: ${Object.entries(CONTAINERS)
      .map(([host, flags]) => `${host} (${flags.join(" ")})`)
      .join(", ")}`,
  );

  const watch = watcher(ctx);

  try {
    await watchPage(ctx.page);
    await steps(ctx, until, watch, timings, manifestPath);
  } finally {
    await watch.stop();
  }
}

/** The Settings section, opened as a user does. */
async function hostsSection(ctx) {
  const settings = await openSettings(ctx);

  return settings.getByRole("region", { name: "Remote hosts" });
}

const hostRow = (section, host) =>
  section.locator("[data-remote-host]").filter({ hasText: host });

async function addHost(ctx, host) {
  const section = await hostsSection(ctx);

  await section.getByLabel("SSH alias").fill(host);
  await section.getByRole("button", { name: "Add", exact: true }).click();
  await hostRow(section, host).waitFor({ timeout: 30_000 });

  return section;
}

export async function removeHost(ctx, host, { uninstall = false } = {}) {
  const section = await hostsSection(ctx);

  await section.getByRole("button", { name: `Remove ${host}` }).click();

  const confirm = section.getByRole("group", { name: `Remove ${host}` });

  if (uninstall)
    await confirm
      .getByRole("checkbox", { name: `Also remove Whiteboard from ${host}` })
      .check();

  await confirm.getByRole("button", { name: "Remove host" }).click();
  await ctx.until(
    async () => (await hostRow(section, host).count()) === 0,
    `the ${host} row to go`,
    2 * MINUTE,
  );

  return section;
}

/** Waits for the install question for `host`, answers `label`, and returns its text and when it was answered. */
async function answerPrompt(ctx, host, label) {
  const widget = ctx.page.locator(".quick-input-widget");
  const heading = `Install Whiteboard on ${host}?`;

  await ctx.until(
    async () =>
      (await widget.isVisible()) &&
      (await widget.locator(".quick-input-title").first().textContent()) ===
        heading,
    `the install question for ${host}`,
    2 * MINUTE,
  );

  // The description is rendered twice.
  const text = await widget
    .locator(".quick-input-description")
    .first()
    .textContent();

  await widget
    .locator(".monaco-list-row", { hasText: new RegExp(`^${label}$`) })
    .first()
    .click({ timeout: 10_000 });

  return { text, at: Date.now() };
}

/** The first time `host` reached one of `states`, as recorded by the watcher. */
async function reached(ctx, watch, host, states, label, timeout) {
  return ctx.until(
    () => watch.history(host).find((entry) => states.includes(entry.state)),
    `${host} ${label}`,
    timeout,
  );
}

/** The install steps the API showed for `host`, in order, by their labels. */
const installSteps = (watch, host) =>
  watch
    .history(host)
    .filter((entry) => entry.state === "installing")
    .map((entry) => entry.detail);

const STEP_ORDER = [
  "Preparing to install Whiteboard",
  "Waiting for another install to finish",
  "Installing Node 24",
  "Installing the Whiteboard package",
  "Checking the install",
  "Installed; starting the server",
];

function assertStepOrder(details, label) {
  const order = details.map((detail) =>
    STEP_ORDER.findIndex((step) => detail.startsWith(step)),
  );

  assert.ok(!order.includes(-1), `${label}: unknown step in ${details}`);
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    `${label}: steps out of order: ${details}`,
  );
}

const promptsFor = async (ctx, host) =>
  (await pageRecord(ctx)).prompts.filter(
    (prompt) => prompt.title === `Install Whiteboard on ${host}?`,
  );

/** The remote's marker for `version`: which Node and CLI the install verified. */
const marker = async (host, version) =>
  JSON.parse(
    await onRemote(
      host,
      `cat ${ROOT}/versions/${version}/.whiteboard-install.json`,
    ),
  );

/** Adds `host`, accepts the question, and waits for `online`; returns the question's text, the steps and consent→online. */
async function install(ctx, watch, host, { timeout = 10 * MINUTE } = {}) {
  await addHost(ctx, host);

  const { text, at } = await answerPrompt(ctx, host, "Install");

  const online = await reached(
    ctx,
    watch,
    host,
    ["online", "not-installed", "unsupported", "incompatible", "auth-failed"],
    "online after the install",
    timeout,
  );

  assert.equal(
    online.state,
    "online",
    `${host}: ${online.state}: ${online.detail}`,
  );

  const steps = installSteps(watch, host);

  assertStepOrder(steps, host);

  return { text, steps, ms: online.at - at };
}

/** A repository with two commits on `host`, and a review of them written with the remote's own `whiteboard`. */
async function createRemoteReview(host, reviewTitle) {
  const home = await onRemote(host, 'printf %s "$HOME"');

  await onRemote(
    host,
    [
      "set -e",
      "rm -rf ~/wbrepo",
      "git init -q -b main ~/wbrepo",
      "cd ~/wbrepo",
      "git config user.email e2e@example.invalid",
      "git config user.name e2e",
      "printf 'export const one = 1;\\n' > f.ts",
      "git add f.ts",
      "git commit -qm one",
      "printf 'export const one = 2;\\n' > f.ts",
      "git commit -qam two",
    ].join("\n"),
  );

  const repository = await remoteApi(host, "session_register_repository", {
    path: `${home}/wbrepo`,
  });

  const created = await remoteApi(host, "session_create", {
    commandId: crypto.randomUUID(),
    title: reviewTitle,
    open: false,
    target: {
      kind: "commits",
      repositoryId: repository.id,
      base: "HEAD~1",
      head: "HEAD",
    },
  });

  assert.match(created.sessionId, /^[0-9a-f-]{36}$/, "the remote review's id");
}

/** Home's row for `reviewTitle`, waited for. */
async function homeRow(ctx, reviewTitle, timeout = MINUTE) {
  await openHome(ctx);

  const row = ctx.page
    .locator("main.review-home")
    .getByRole("region", { name: "Sessions", exact: true })
    .locator("tbody tr")
    .filter({ hasText: reviewTitle });

  await row.waitFor({ timeout });

  return row;
}

/** Each machine's architecture, and the one the installed Node was built for. */
async function targetOf(host, version) {
  const { node } = await marker(host, version);

  return {
    machine: await onRemote(host, "uname -m"),
    node: await onRemote(host, `'${node}' -p process.arch`),
  };
}

async function steps(ctx, until, watch, timings, manifestPath) {
  const version = JSON.parse(await readFile(manifestPath, "utf8")).version;

  // 1. fresh: the question, its steps in Settings, online, and a review made there with the installed CLI listed in Home.
  const fresh = alias("fresh");
  const first = await install(ctx, watch, fresh);

  timings.fresh = first.ms;
  assert.match(first.text, /about 200 MB for Node 24/);
  assert.doesNotMatch(first.text, /\/home\//, "the question names a path");

  const settingsSteps = (await pageRecord(ctx)).rows[fresh].filter((text) =>
    text.startsWith("installing · "),
  );

  assert.ok(
    settingsSteps.length >= 2,
    `Settings showed ${settingsSteps.length} install step(s): ${settingsSteps}`,
  );
  assertStepOrder(
    settingsSteps.map((text) => text.slice("installing · ".length)),
    "Settings",
  );
  assert.ok(
    first.steps.some((step) => step.startsWith("Installing Node 24")) &&
      first.steps.some((step) =>
        step.startsWith("Installing the Whiteboard package"),
      ),
    `fresh's steps: ${first.steps}`,
  );
  await createRemoteReview(fresh, title);

  const listed = await homeRow(ctx, title);

  assert.ok((await listed.innerText()).includes(`${fresh}: wbrepo`));
  assert.equal(await listed.getAttribute("data-unavailable"), null);

  const freshTarget = await targetOf(fresh, version);

  assert.deepEqual(freshTarget, { machine: "x86_64", node: "x64" });
  ctx.check(
    `1. ${fresh} (linux/amd64): the question, ${first.steps.length} steps from the API (${first.steps.join(" → ")}), ${settingsSteps.length} in Settings, online ${first.ms} ms after Install; a review written with ${WHITEBOARD} is in Home as ${fresh}: wbrepo`,
  );

  // 2. node: the host's own Node 24 runs Whiteboard; none is installed under whiteboard-remote/node.
  const node = alias("node");
  const second = await install(ctx, watch, node);

  assert.doesNotMatch(second.text, /Node 24/);
  assert.equal(
    await onRemote(node, `test -e ${ROOT}/node && echo yes || echo no`),
    "no",
  );
  assert.equal((await marker(node, version)).node, "/usr/local/bin/node");
  assert.ok(
    !second.steps.some((step) => step.startsWith("Installing Node")),
    `node's steps: ${second.steps}`,
  );
  ctx.check(
    `2. ${node}: online ${second.ms} ms after Install, with /usr/local/bin/node; no ${ROOT}/node`,
  );

  // 3. sealed: no route out, so Node and the package are uploaded, and npm reaches the registry through Desktop's relay.
  const sealed = alias("sealed");
  const third = await install(ctx, watch, sealed);

  timings.sealed = third.ms;

  for (const step of ["Installing Node 24", "Installing the Whiteboard package"])
    assert.ok(
      third.steps.includes(`${step} (uploaded from this computer).`),
      `sealed's steps: ${third.steps}`,
    );
  await assert.rejects(
    onRemote(sealed, "curl -sS -m 5 -o /dev/null https://registry.npmjs.org/"),
    "the sealed host reaches the registry",
  );
  // diffr comes from GitHub, so a host without a route out has none: structural diff is off there.
  assert.equal(
    await onRemote(sealed, "ls ~/.dev/review-tools/diffr-fetch 2>/dev/null || true"),
    "",
  );
  ctx.check(
    `3. ${sealed}: Node and the package uploaded from this computer, npm through the relay; online ${third.ms} ms after Install; the host still has no route out, and no diffr`,
  );

  // 4. old: glibc 2.31 is refused before anything is written, and no question is asked.
  const old = alias("old");
  // The container's start writes ~/.ssh after /etc/hostname, so the reference is a file touched just before the host is added.
  const newer = `find ~ -newer /tmp/wb-test-added | sort; test -e ${ROOT} && echo installed || true`;

  await onRemote(old, "touch /tmp/wb-test-added");
  const oldSection = await addHost(ctx, old);

  const refused = await reached(
    ctx,
    watch,
    old,
    ["unsupported", "online", "not-installed", "installing"],
    "unsupported",
    2 * MINUTE,
  );

  assert.equal(refused.state, "unsupported", refused.detail);
  assert.match(
    refused.detail,
    /glibc 2\.31; Whiteboard needs 2\.34 or newer/,
    refused.detail,
  );
  await until(
    async () =>
      /unsupported · .*glibc 2\.31/.test(
        await hostRow(oldSection, old).innerText(),
      ),
    "the Settings row to read unsupported",
    30_000,
  );
  assert.equal(await onRemote(old, newer), "", "old was written to");
  assert.deepEqual(await promptsFor(ctx, old), []);
  ctx.check(
    `4. ${old} (debian:11): unsupported, "${refused.detail}"; no question; nothing in its home newer than just before it was added`,
  );

  // 5. arm: the other target.
  const arm = alias("arm");
  const fifth = await install(ctx, watch, arm);
  const armTarget = await targetOf(arm, version);

  assert.deepEqual(armTarget, { machine: "aarch64", node: "arm64" });
  ctx.check(
    `5. ${arm} (linux/arm64): online ${fifth.ms} ms after Install, with Node for ${armTarget.node}`,
  );

  // 6. fresh2: the SSH connection dies during the package step; the reconnect finishes the install and leaves no .part.
  const fresh2 = alias("fresh2");

  await addHost(ctx, fresh2);
  await answerPrompt(ctx, fresh2, "Install");

  const packaging = await reached(
    ctx,
    watch,
    fresh2,
    ["installing", "online"],
    "the package step",
    10 * MINUTE,
  ).then(() =>
    until(
      () =>
        watch
          .history(fresh2)
          .find((entry) =>
            entry.detail?.startsWith("Installing the Whiteboard package"),
          ),
      `${fresh2} installing the package`,
      10 * MINUTE,
    ),
  );

  const master = await masterPid(fresh2);

  assert.ok(master, `no ssh master for ${fresh2}`);
  process.kill(master, "SIGKILL");

  const killed = Date.now();

  const recovered = await until(
    () =>
      watch
        .history(fresh2)
        .find((entry) => entry.at > killed && entry.state === "online"),
    `${fresh2} online after the dropped connection`,
    10 * MINUTE,
  );

  const dropped = (await mainLog(ctx))
    .split("\n")
    .find((line) => line.includes(`[Remote hosts] ${fresh2}: unreachable: `));

  assert.ok(dropped, `no unreachable line for ${fresh2} in main.log`);
  assert.notEqual(await masterPid(fresh2), master);
  assert.equal(
    await onRemote(fresh2, `find ${ROOT} -name '*.part' | head -n 5`),
    "",
  );
  assert.equal(
    await onRemote(fresh2, `ls ${ROOT}/versions; ls -d ${ROOT}/install.lock* 2>/dev/null || true`),
    version,
  );
  assert.equal((await promptsFor(ctx, fresh2)).length, 1);
  ctx.check(
    `6. ${fresh2}: ssh master killed during "${packaging.detail}"; main.log: "${dropped.split("[Remote hosts] ")[1]}"; online ${recovered.at - killed} ms after the kill, asked once, no .part and no lock left`,
  );

  // 9. deny: declined, not installed, the manual command; a reconnect does not ask again.
  const deny = alias("deny");
  const denySection = await addHost(ctx, deny);

  await answerPrompt(ctx, deny, "Don't install");

  const declined = await reached(
    ctx,
    watch,
    deny,
    ["not-installed", "online", "installing"],
    "not-installed",
    2 * MINUTE,
  );

  assert.equal(declined.state, "not-installed", declined.detail);
  assert.equal(declined.declined, true);
  assert.equal(
    declined.installCommand,
    `npm install -g @dev.fast/whiteboard@${version}`,
  );
  await denySection
    .getByRole("button", { name: `Install ${deny}` })
    .waitFor({ timeout: 30_000 });
  assert.equal(
    await hostRow(denySection, deny).locator("code").innerText(),
    declined.installCommand,
  );

  const nothing = `ls -d ${ROOT} ${WHITEBOARD} 2>/dev/null || true`;

  assert.equal(await onRemote(deny, nothing), "");

  const connects = async () =>
    (await mainLog(ctx)).split(`${deny}: connecting, ssh pid`).length - 1;

  const before9 = await connects();

  await denySection.getByRole("button", { name: `Retry ${deny}` }).click();
  await until(
    async () => (await connects()) > before9,
    `${deny} to connect again`,
    MINUTE,
  );
  await until(
    async () =>
      (await ctx.apiOk("/remote-hosts")).find((host) => host.alias === deny)
        ?.state === "not-installed",
    `${deny} not-installed again`,
    MINUTE,
  );
  // A question would open within a second or two of the probe.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  assert.equal((await promptsFor(ctx, deny)).length, 1);
  assert.equal(await onRemote(deny, nothing), "");
  ctx.check(
    `9. ${deny}: declined → not-installed with "${declined.installCommand}" and Install in Settings; nothing written; Retry reconnected without asking again`,
  );

  // Before the next version: the hosts that are done leave, `node` gets a server its user started, `fresh` an agent.
  for (const host of [sealed, old, arm, fresh2, deny, node])
    await removeHost(ctx, host);

  for (const host of ["sealed", "old", "arm", "fresh2", "deny"])
    await remote(["down", host], 5 * MINUTE);

  await onRemote(node, `${WHITEBOARD} server stop --json`);
  await onRemote(
    node,
    `setsid nohup ${WHITEBOARD} server start --json > /tmp/user-server.log 2>&1 < /dev/null &`,
  );

  const userServer = JSON.parse(
    await until(
      () =>
        onRemote(node, `${WHITEBOARD} server status --json`).catch(() => null),
      "the user's server on node",
      MINUTE,
    ),
  );

  assert.equal(userServer.version, version);

  const discovery = JSON.parse(
    await onRemote(node, "cat ~/.dev/review-server/server.json"),
  );

  assert.equal(discovery.startedBy, "user");

  const privateNode = `$(ls -d ${ROOT}/node/v*/bin | tail -n 1)`;

  await onRemote(
    fresh,
    `PATH="${privateNode}:$PATH" npm install -g --prefix ~/.local --no-audit --no-fund ${CLAUDE_CODE} >/dev/null && mkdir -p ~/.claude && ~/.local/bin/claude --version`,
    { timeout: 10 * MINUTE },
  );

  const freshServer = async () =>
    JSON.parse(await onRemote(fresh, `${WHITEBOARD} server status --json`));

  const oldFreshServer = await freshServer();

  // 7. The next version: Desktop's server reports what packages/review/package.json says, and its pack carries it.
  const next = version.replace(/\d+$/, (patch) => String(Number(patch) + 1));
  const manifest = await readFile(manifestPath, "utf8");

  await writeFile(
    manifestPath,
    manifest.replace(`"version": "${version}"`, `"version": "${next}"`),
  );
  const sshBefore = (await desktopSsh()).map(([pid]) => pid);
  const restarted = Date.now();

  await ctx.restartDesktop();
  await watchPage(ctx.page);
  await until(
    async () =>
      !(await desktopSsh()).some(([pid]) => sshBefore.includes(pid)),
    "the previous Desktop's ssh to end",
    30_000,
  );

  assert.equal((await ctx.apiOk("/health")).version, next);

  const upgraded = await until(
    () =>
      watch
        .history(fresh)
        .find(
          (entry) =>
            entry.at > restarted &&
            ["online", "incompatible", "not-installed"].includes(entry.state),
        ),
    `${fresh} on ${next}`,
    10 * MINUTE,
  );

  assert.equal(upgraded.state, "online", upgraded.detail);
  assert.deepEqual(await promptsFor(ctx, fresh), []);
  assert.equal(
    await onRemote(fresh, `ls ${ROOT}/versions | sort -V | tr '\\n' ' '`),
    `${version} ${next}`,
  );

  const newFreshServer = await freshServer();

  assert.equal(newFreshServer.version, next);
  assert.notEqual(newFreshServer.serverPid, oldFreshServer.serverPid);
  assert.match(
    await onRemote(fresh, `cat /proc/${newFreshServer.serverPid}/cmdline | tr '\\0' ' '`),
    new RegExp(`/versions/${next.replaceAll(".", "\\.")}/`),
  );
  await homeRow(ctx, title);
  ctx.check(
    `7. Desktop ${next} (packages/review/package.json bumped, Desktop restarted, none of its ${sshBefore.length} ssh processes left): ${fresh} installed ${next} beside ${version} without asking, its server restarted on ${next} (pid ${oldFreshServer.serverPid} → ${newFreshServer.serverPid}), and the step 1 review is still listed`,
  );

  // 8. A server the user started on node, at the old version: the newer Desktop leaves it and says so.
  const readded = Date.now();

  await addHost(ctx, node);

  const blocked = await until(
    () =>
      watch
        .history(node)
        .find(
          (entry) =>
            entry.at > readded &&
            ["incompatible", "online", "not-installed"].includes(entry.state),
        ),
    `${node} settled`,
    10 * MINUTE,
  );

  assert.equal(blocked.state, "incompatible", blocked.detail);
  assert.match(blocked.detail, /started by a user is running on/);
  assert.deepEqual(await promptsFor(ctx, node), []);
  await onRemote(node, `kill -0 ${userServer.serverPid}`);
  assert.equal(
    (
      await onRemote(node, `cat /proc/${userServer.serverPid}/cmdline | tr '\\0' ' '`)
    ).includes(`/versions/${version}/`),
    true,
  );
  ctx.check(
    `8. ${node}: "${blocked.detail}"; the user's server (pid ${userServer.serverPid}, ${version}) still runs`,
  );

  // 10. fresh has Claude Code's configuration: Settings offers it, Connect connects it on the remote.
  const section = await hostsSection(ctx);
  const freshRow = hostRow(section, fresh);

  await until(
    async () =>
      /Agents on wb-test-fresh: Claude Code/.test(await freshRow.innerText()),
    "the agent offer for fresh",
    2 * MINUTE,
  );
  await freshRow
    .getByRole("button", { name: `Connect agents on ${fresh}` })
    .click();
  await until(
    async () =>
      /Claude Code (is connected|was not connected)/.test(
        await freshRow.innerText(),
      ),
    "Connect's result",
    5 * MINUTE,
  );
  assert.match(
    await freshRow.getByRole("status").innerText(),
    /^Claude Code is connected on wb-test-fresh\.$/,
  );
  assert.ok(
    JSON.parse(
      await onRemote(fresh, "cat ~/.claude/plugins/installed_plugins.json"),
    ).plugins["whiteboard@devfast"],
    "no whiteboard@devfast in installed_plugins.json",
  );
  ctx.check(
    `10. ${fresh}: Settings offered Claude Code (${CLAUDE_CODE}, ~/.claude present); Connect wrote whiteboard@devfast into ~/.claude/plugins/installed_plugins.json`,
  );

  // 11. Remove fresh with its Whiteboard: the install and the launcher go, the review store stays.
  await removeHost(ctx, fresh, { uninstall: true });
  assert.equal(
    await section.getByRole("alert").count(),
    0,
    await section
      .getByRole("alert")
      .innerText()
      .catch(() => ""),
  );
  assert.equal(await onRemote(fresh, nothing), "");
  assert.match(
    await onRemote(
      fresh,
      `cat ~/.dev/review-api.db ~/.dev/review-api.db-wal 2>/dev/null | grep -ac '${title}' || true`,
    ),
    /^[1-9]/,
  );
  ctx.check(
    `11. ${fresh} removed with "Also remove Whiteboard": no ${ROOT}, no ${WHITEBOARD}; ~/.dev/review-api.db still holds "${title}"`,
  );

  // 12.
  ctx.check(
    `12. Install → online: fresh ${timings.fresh} ms, sealed ${timings.sealed} ms`,
  );
  console.error(`[remote-install] timings ${JSON.stringify(timings)}`);
}

/** AWS or other prepared hosts: each installs after the question and lists a review made there. */
async function preparedJourney(ctx) {
  const watch = watcher(ctx);

  try {
    await watchPage(ctx.page);

    const timings = {};

    for (const name of prepared) {
      const host = alias(name);

      assert.equal(
        await onRemote(host, `ls -d ${ROOT} ${WHITEBOARD} 2>/dev/null || true`),
        "",
        `${host} has seen Whiteboard`,
      );

      const installed = await install(ctx, watch, host, {
        timeout: 20 * MINUTE,
      });

      timings[name] = installed.ms;

      const reviewTitle = `${title} on ${name}`;

      await createRemoteReview(host, reviewTitle);
      assert.ok(
        (await (await homeRow(ctx, reviewTitle)).innerText()).includes(
          `${host}: wbrepo`,
        ),
      );
      ctx.check(
        `${host} (${await onRemote(host, "uname -m")}): ${installed.steps.join(" → ")}; online ${installed.ms} ms after Install; its review is in Home`,
      );
    }

    console.error(`[remote-install] timings ${JSON.stringify(timings)}`);
  } finally {
    await watch.stop();
  }
}
