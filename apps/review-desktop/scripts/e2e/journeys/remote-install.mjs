/** Desktop installs itself on remote hosts it reaches over SSH: containers from remote/remote.mjs with nothing installed by hand, added in Settings as a user would. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { REMOTE_TARGETS } from "../../build-remote-tarball.mjs";
import { openHome, openSettings, sourcePackage } from "../harness.mjs";
import { serveReleases } from "../remote/releases.mjs";
import { listedAs } from "./remote-host.mjs";

const exec = promisify(execFile);

const remoteScript = path.join(import.meta.dirname, "../remote/remote.mjs");

const runId = process.env.WB_TEST_RUN ?? `e2e${Date.now().toString(36)}`;

const runDir = `/tmp/wbt.${runId}`;

const prepared =
  process.env.REVIEW_E2E_REMOTE_HOSTS?.split(",").filter(Boolean);

const CONTAINERS = {
  fresh: ["--platform", "linux/amd64", "--node", "none"],
  old: ["--image", "debian:11", "--node", "none"],
  arm: ["--platform", "linux/arm64", "--node", "none"],
  fresh2: ["--platform", "linux/amd64", "--node", "none", "--delay-ms", "100"],
  deny: ["--node", "none"],
  hand: ["--platform", "linux/amd64", "--node", "none"],
};

const alias = (name) => `wb-test-${name}`;

const ROOT = "~/.dev/whiteboard-remote";

const WHITEBOARD = "~/.local/bin/whiteboard";

const CLAUDE_CODE = "2.1.286";

const title = "Installed remote order";

const MINUTE = 60_000;

export const name = "remote-install";

export const phase = 2;

export const options = {
  settings: { "review.experimental.remoteHosts.enabled": true },
  env: { DEV_FAST_REVIEW_SSH_CONFIG: `${runDir}/ssh_config` },
};

let releases;

const hasDocker = () =>
  exec("docker", ["info", "--format", "{{.ServerVersion}}"], {
    timeout: 30_000,
  });

export async function prepare({ app }) {
  if (prepared || app || !(await hasDocker().then(() => true, () => false)))
    return undefined;

  releases = await serveReleases();

  try {
    for (const target of REMOTE_TARGETS) await releases.stage(target);
  } catch (error) {
    await releases.close();
    throw error;
  }

  return {
    env: { DEV_FAST_REVIEW_REMOTE_RELEASES: releases.url },
    dispose: () => releases.close(),
  };
}

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
      await hasDocker();
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
    if ((await readFile(manifestPath, "utf8")) !== manifest)
      await writeFile(manifestPath, manifest);

    await closeDesktop(ctx);

    if (!prepared)
      await remote(["down", "--all"], 5 * MINUTE).catch((error) =>
        console.error(`[remote-install] down --all: ${error.message}`),
      );
  }
}

async function closeDesktop(ctx) {
  const session = await ctx.browser.newBrowserCDPSession().catch(() => null);

  await Promise.race([
    session?.send("Browser.close").catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);

  for (let i = 0; i < 40 && (await desktopSsh()).length; i++)
    await new Promise((resolve) => setTimeout(resolve, 250));

  for (const [pid] of await desktopSsh()) process.kill(pid, "SIGTERM");
}

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

const masterPid = async (host) =>
  (await desktopSsh()).find(
    ([, args]) =>
      / -M -N | -N -T -D /.test(args) && args.endsWith(`-- ${host}`),
  )?.[0];

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
      } catch {}

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
          e.textContent.startsWith("Install remote server on "),
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

async function mainLog(ctx) {
  const logs = path.join(ctx.userData, "logs");

  const files = (await readdir(logs, { recursive: true })).filter((file) =>
    file.endsWith("main.log"),
  );

  return (
    await Promise.all(
      files.map((file) => readFile(path.join(logs, file), "utf8")),
    )
  ).join("\n");
}

const pageRecord = (ctx) => ctx.page.evaluate(() => window.__remoteInstall);

async function journey(ctx, manifestPath) {
  const { until } = ctx;
  const timings = {};

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

async function answerPrompt(ctx, host, label) {
  const widget = ctx.page.locator(".quick-input-widget");
  const heading = `Install remote server on ${host}? (~250 MB)`;

  await ctx.until(
    async () =>
      (await widget.isVisible()) &&
      (await widget.locator(".quick-input-title").first().textContent()) ===
        heading,
    `the install question for ${host}`,
    2 * MINUTE,
  );

  await widget
    .locator(".monaco-list-row", { hasText: new RegExp(`^${label}$`) })
    .first()
    .click({ timeout: 10_000 });

  return Date.now();
}

async function reached(ctx, watch, host, states, label, timeout) {
  return ctx.until(
    () => watch.history(host).find((entry) => states.includes(entry.state)),
    `${host} ${label}`,
    timeout,
  );
}

const installSteps = (watch, host) =>
  watch
    .history(host)
    .filter((entry) => entry.state === "installing")
    .map((entry) => entry.detail);

const STEP_ORDER = [
  "Preparing to install Whiteboard",
  "Waiting for another install to finish",
  "Installing the Whiteboard package",
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
    (prompt) => prompt.title === `Install remote server on ${host}? (~250 MB)`,
  );

const marker = async (host, version) =>
  JSON.parse(
    await onRemote(
      host,
      `cat ${ROOT}/versions/${version}/.whiteboard-install.json`,
    ),
  );

async function install(ctx, watch, host, { timeout = 10 * MINUTE } = {}) {
  await addHost(ctx, host);

  const at = await answerPrompt(ctx, host, "Install");

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

  return { steps, ms: online.at - at };
}

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

  const created = await remoteApi(host, "session_create", {
    title: reviewTitle,
    open: false,
    target: {
      kind: "commits",
      repositoryPath: `${home}/wbrepo`,
      base: "HEAD~1",
      head: "HEAD",
    },
  });

  assert.match(created.sessionId, /^[0-9a-f-]{36}$/, "the remote review's id");
}

async function homeRow(ctx, reviewTitle, timeout = MINUTE) {
  await openHome(ctx);

  const row = ctx.page
    .locator("main.review-home [data-home-row]")
    .filter({ hasText: reviewTitle });

  await row.waitFor({ timeout });

  return row;
}

async function targetOf(host, version) {
  const { node } = await marker(host, version);

  return {
    machine: await onRemote(host, "uname -m"),
    node: await onRemote(host, `'${node}' -p process.arch`),
  };
}

async function steps(ctx, until, watch, timings, manifestPath) {
  const version = JSON.parse(await readFile(manifestPath, "utf8")).version;

  const fresh = alias("fresh");
  const first = await install(ctx, watch, fresh);

  timings.fresh = first.ms;

  const settingsSteps = (await pageRecord(ctx)).rows[fresh].filter((text) =>
    STEP_ORDER.some((step) => text.startsWith(step)),
  );

  assert.ok(
    settingsSteps.length >= 2,
    `Settings showed ${settingsSteps.length} install step(s): ${settingsSteps}`,
  );
  assertStepOrder(settingsSteps, "Settings");
  await onRemote(
    fresh,
    `test -x ${ROOT}/versions/${version}/node_modules/@dev.fast/diffr-linux-x64/diffr`,
  );
  await createRemoteReview(fresh, title);

  const listed = await homeRow(ctx, title);

  assert.equal(await listedAs(ctx, title), `${fresh}: wbrepo`);
  assert.equal(await listed.getAttribute("data-unavailable"), null);

  const freshTarget = await targetOf(fresh, version);

  assert.deepEqual(freshTarget, { machine: "x86_64", node: "x64" });
  ctx.check(
    `1. ${fresh} (linux/amd64): the question, ${first.steps.length} steps from the API (${first.steps.join(" → ")}), ${settingsSteps.length} in Settings, online ${first.ms} ms after Install; diffr is executable inside the tarball; a review written with ${WHITEBOARD} is in Home as ${fresh}: wbrepo`,
  );

  const old = alias("old");
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
      /glibc 2\.31; Whiteboard needs 2\.34/.test(
        await hostRow(oldSection, old).innerText(),
      ),
    "the Settings row to read unsupported",
    30_000,
  );
  assert.equal(await onRemote(old, newer), "", "old was written to");
  assert.deepEqual(await promptsFor(ctx, old), []);
  ctx.check(
    `3. ${old} (debian:11): unsupported, "${refused.detail}"; no question; nothing in its home newer than just before it was added`,
  );

  const arm = alias("arm");
  const fifth = await install(ctx, watch, arm);
  const armTarget = await targetOf(arm, version);

  timings.arm = fifth.ms;
  assert.deepEqual(armTarget, { machine: "aarch64", node: "arm64" });
  ctx.check(
    `4. ${arm} (linux/arm64): online ${fifth.ms} ms after Install; the tarball's bin/node runs as ${armTarget.node}`,
  );

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
    await onRemote(
      fresh2,
      `ls ${ROOT}/versions; ls -d ${ROOT}/install.lock* 2>/dev/null || true`,
    ),
    version,
  );
  assert.equal((await promptsFor(ctx, fresh2)).length, 1);
  ctx.check(
    `5. ${fresh2}: ssh master killed during "${packaging.detail}"; main.log: "${dropped.split("[Remote hosts] ")[1]}"; online ${recovered.at - killed} ms after the kill, asked once, no .part and no lock left`,
  );

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
    `curl -fsSL https://install.dev.fast/releases/${version}/remote/install.sh | sh -s -- --version ${version}`,
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

  const beforeRetry = await connects();

  await denySection.getByRole("button", { name: `Retry ${deny}` }).click();
  await until(
    async () => (await connects()) > beforeRetry,
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
  await new Promise((resolve) => setTimeout(resolve, 5000));
  assert.equal((await promptsFor(ctx, deny)).length, 1);
  assert.equal(await onRemote(deny, nothing), "");
  ctx.check(
    `6. ${deny}: declined → not-installed with "${declined.installCommand}" and Install in Settings; nothing written; Retry reconnected without asking again`,
  );

  for (const host of [old, arm, fresh2, deny]) await removeHost(ctx, host);

  for (const host of ["old", "fresh2", "deny"])
    await remote(["down", host], 5 * MINUTE);

  await onRemote(arm, `${WHITEBOARD} server stop --json`);
  await onRemote(
    arm,
    `setsid nohup ${WHITEBOARD} server start --json > /tmp/user-server.log 2>&1 < /dev/null &`,
  );

  const userServer = JSON.parse(
    await until(
      () =>
        onRemote(arm, `${WHITEBOARD} server status --json`).catch(() => null),
      "the user's server on arm",
      MINUTE,
    ),
  );

  assert.equal(userServer.version, version);

  const discovery = JSON.parse(
    await onRemote(arm, "cat ~/.dev/review-server/server.json"),
  );

  assert.equal(discovery.startedBy, "user");

  await onRemote(
    fresh,
    `mkdir -p ~/.local/bin ~/.claude && curl -fsSL https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-${CLAUDE_CODE}.tgz | tar -xzO package/claude > ~/.local/bin/claude && chmod +x ~/.local/bin/claude && ~/.local/bin/claude --version`,
    { timeout: 10 * MINUTE },
  );

  const freshServer = async () =>
    JSON.parse(await onRemote(fresh, `${WHITEBOARD} server status --json`));

  const oldFreshServer = await freshServer();

  const next = version.replace(/\d+$/, (patch) => String(Number(patch) + 1));
  const manifest = await readFile(manifestPath, "utf8");

  await writeFile(
    manifestPath,
    manifest.replace(`"version": "${version}"`, `"version": "${next}"`),
  );

  for (const target of REMOTE_TARGETS) await releases.stage(target);
  const sshBefore = (await desktopSsh()).map(([pid]) => pid);
  const restarted = Date.now();

  await ctx.restartDesktop();
  await watchPage(ctx.page);
  await until(
    async () => !(await desktopSsh()).some(([pid]) => sshBefore.includes(pid)),
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

  const readded = Date.now();

  await addHost(ctx, arm);

  const blocked = await until(
    () =>
      watch
        .history(arm)
        .find(
          (entry) =>
            entry.at > readded &&
            ["incompatible", "online", "not-installed"].includes(entry.state),
        ),
    `${arm} settled`,
    10 * MINUTE,
  );

  assert.equal(blocked.state, "incompatible", blocked.detail);
  assert.match(blocked.detail, /started by a user is running on/);
  assert.deepEqual(await promptsFor(ctx, arm), []);
  await onRemote(arm, `kill -0 ${userServer.serverPid}`);
  assert.equal(
    (
      await onRemote(
        arm,
        `cat /proc/${userServer.serverPid}/cmdline | tr '\\0' ' '`,
      )
    ).includes(`/versions/${version}/`),
    true,
  );
  ctx.check(
    `8. ${arm}: "${blocked.detail}"; the user's server (pid ${userServer.serverPid}, ${version}) still runs`,
  );

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
    `9. ${fresh}: Settings offered Claude Code (${CLAUDE_CODE}, ~/.claude present); Connect wrote whiteboard@devfast into ~/.claude/plugins/installed_plugins.json`,
  );

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
    `10. ${fresh} removed with "Also remove Whiteboard": no ${ROOT}, no ${WHITEBOARD}; ~/.dev/review-api.db still holds "${title}"`,
  );

  const hand = alias("hand");
  const base = releases.url.replace(/\/$/, "");

  const handCommand = declined.installCommand
    .replaceAll(version, next)
    .replace("https://install.dev.fast/releases", base)
    .replace("| sh ", `| WHITEBOARD_RELEASES=${base} sh `);

  await onRemote(hand, handCommand, { timeout: 5 * MINUTE });
  assert.equal(await onRemote(hand, "bash -lc 'whiteboard --version'"), next);

  const handAdded = Date.now();

  await addHost(ctx, hand);

  const handSettled = await until(
    async () =>
      (await promptsFor(ctx, hand)).length
        ? { state: "asked to install" }
        : watch
            .history(hand)
            .find(
              (entry) =>
                entry.at > handAdded &&
                [
                  "online",
                  "installing",
                  "not-installed",
                  "incompatible",
                  "unsupported",
                ].includes(entry.state),
            ),
    `${hand} settled`,
    5 * MINUTE,
  );

  assert.equal(handSettled.state, "online", handSettled.detail);
  assert.equal(
    await onRemote(hand, `ls ${ROOT}/versions`),
    next,
  );
  assert.match(
    await onRemote(hand, `cat ${WHITEBOARD}`),
    new RegExp(`/versions/${next.replaceAll(".", "\\.")}/whiteboard`),
  );

  const handServer = JSON.parse(
    await onRemote(hand, "bash -lc 'whiteboard server status --json'"),
  );

  assert.equal(handServer.version, next);
  assert.match(
    await onRemote(
      hand,
      `cat /proc/${handServer.serverPid}/cmdline | tr '\\0' ' '`,
    ),
    new RegExp(`/versions/${next.replaceAll(".", "\\.")}/`),
  );
  assert.deepEqual(await promptsFor(ctx, hand), []);
  ctx.check(
    `11. ${hand}: Settings' install.sh line installed ${next}; online without a question, as Desktop's own install, and its server runs from versions/${next}`,
  );

  ctx.check(
    `12. Install → online: fresh ${timings.fresh} ms, arm ${timings.arm} ms`,
  );
  console.error(`[remote-install] timings ${JSON.stringify(timings)}`);
}

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
      await homeRow(ctx, reviewTitle);
      assert.equal(await listedAs(ctx, reviewTitle), `${host}: wbrepo`);
      ctx.check(
        `${host} (${await onRemote(host, "uname -m")}): ${installed.steps.join(" → ")}; online ${installed.ms} ms after Install; its review is in Home`,
      );
    }

    console.error(`[remote-install] timings ${JSON.stringify(timings)}`);
  } finally {
    await watch.stop();
  }
}
