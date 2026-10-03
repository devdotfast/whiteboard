/** Ask on a review whose checkout is on another machine: a container with a fake OpenCode, reached over SSH and added in Settings as a user would. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { openHome, openSettings } from "../harness.mjs";
import {
  alias,
  closeDesktop,
  createRemoteReview,
  masterPid,
  onRemote,
  prepared,
  recordRequests,
  remote,
  remoteToken,
  runDir,
} from "./remote-host.mjs";
import { removeHost } from "./remote-install.mjs";

const exec = promisify(execFile);

const title = "Remote ask";

const question = "what does f.ts do";

export const name = "remote-ask";

// Phase 2: the container image downloads Ubuntu packages and Node.
export const phase = 2;

export const options = {
  settings: { "review.experimental.remoteHosts.enabled": true },
  env: { DEV_FAST_REVIEW_SSH_CONFIG: `${runDir}/ssh_config` },
};

export async function run(ctx) {
  // A packaged build ignores DEV_FAST_REVIEW_SSH_CONFIG, so its ssh would read the user's configuration.
  if (ctx.report.mode === "packaged")
    throw new Error("skip: remote-ask runs in development mode only");

  if (prepared === undefined)
    try {
      await exec("docker", ["info", "--format", "{{.ServerVersion}}"]);
    } catch (error) {
      throw new Error(
        `skip: remote-ask needs Docker for its SSH server (${error.message.split("\n")[0]})`,
      );
    }

  try {
    await journey(ctx);
  } finally {
    if (prepared === undefined)
      await remote("down", "--all").catch((error) =>
        console.error(`[remote-ask] down --all: ${error.message}`),
      );
    else await closeDesktop(ctx);
  }
}

/** Freezes the host: the container, or on a prepared host its review server, which the returned function resumes. */
async function freeze() {
  if (prepared === undefined) {
    await remote("pause", "a");

    return undefined;
  }

  const { serverPid } = JSON.parse(
    await onRemote("whiteboard server status --json"),
  );

  await onRemote(`kill -STOP ${serverPid}`);

  return () => onRemote(`kill -CONT ${serverPid}`);
}

async function journey(ctx) {
  const { until } = ctx;
  const timings = {};

  const hostState = async () =>
    (await ctx.apiOk("/remote-hosts")).find((host) => host.alias === alias)
      ?.state;

  const waitState = (state, label, timeout = 60000) =>
    until(
      async () => (await hostState()) === state,
      `${alias} ${label}`,
      timeout,
    );

  const canvas = () =>
    ctx.page.locator(".review-canvas-root [data-review-api]");

  // Docked in the side panel or floating, by the layout.
  const panel = () =>
    ctx.page.locator(
      '[role=complementary][aria-label="Ask"], [role=dialog][aria-label="Ask"]',
    );

  const composer = () => panel().getByRole("combobox", { name: "Question" });

  const homeRow = () =>
    ctx.page
      .locator("main.review-home")
      .getByRole("region", { name: "Sessions", exact: true })
      .locator("tbody tr")
      .filter({ hasText: title });

  async function openReview() {
    await openHome(ctx);
    await homeRow().waitFor({ timeout: 60000 });
    await homeRow().getByTitle(title, { exact: true }).click();
    await canvas().getByRole("heading", { name: title }).waitFor({
      timeout: 60000,
    });
  }

  /** Selects the document's sentence and opens Ask on it with ⌘L. */
  async function askAboutSentence() {
    // The workbench's usage-data notice sits over the composer's Ask button.
    for (const clear of await ctx.page
      .locator(".notifications-toasts .codicon-notifications-clear")
      .all())
      await clear.click().catch(() => {});

    const sentence = canvas().getByText("One now returns");

    await sentence.waitFor();
    await sentence.evaluate((element) => {
      const range = document.createRange();

      range.selectNodeContents(element);
      document.getSelection().removeAllRanges();
      document.getSelection().addRange(range);
    });
    await ctx.page
      .getByRole("button", { name: "Ask OpenCode", exact: true })
      .waitFor({ timeout: 30000 });
    await ctx.page.keyboard.press("Meta+l");
    await composer().waitFor({ timeout: 30000 });
  }

  /** Types `text` and sends it with the Ask button; resolves with the ms until the panel shows its echo. */
  async function send(text) {
    await composer().fill(text);

    const sent = Date.now();

    await panel().getByRole("button", { name: "Ask", exact: true }).click();
    await panel().getByText(`You asked: ${text}`).waitFor({ timeout: 20000 });

    return Date.now() - sent;
  }

  const savedConversations = () =>
    canvas().getByRole("button", { name: "Saved conversations" });

  async function historyLists(label) {
    await until(
      async () => {
        await savedConversations().first().click();

        return (
          (await panel()
            .getByRole("list")
            .filter({ hasText: question })
            .count()) > 0
        );
      },
      label,
      30000,
    );
  }

  // 1. A container with sshd, this checkout's package and the fake OpenCode, or a prepared host, holding a review.
  if (prepared === undefined) {
    await remote("up", "a", "--fake-agent");
    await remote("install", "a");
  }

  const [reviewId] = (
    await onRemote(`bash -s -- '${title}'`, createRemoteReview)
  ).split("\n");

  assert.match(reviewId, /^[0-9a-f-]{36}$/, "the remote review's id");

  const remoteTokens = new Set([await remoteToken()]);

  ctx.check(`1. ${alias}, with a fake OpenCode, holds a review`);

  // 2. Settings, as a user adds a host.
  const section = (await openSettings(ctx)).getByRole("region", {
    name: "Remote hosts",
  });

  await section.getByLabel("SSH alias").fill(alias);

  const added = Date.now();

  await section.getByRole("button", { name: "Add", exact: true }).click();
  await waitState("online", "online");
  timings.addToOnline = Date.now() - added;
  ctx.check(
    `2. Settings added ${alias}; online ${timings.addToOnline} ms after Add`,
  );

  // 3. The remote review, a sentence selected, ⌘L.
  const requests = await recordRequests(ctx.page, /\/ask\/[^/]+\/watch(\?|$)/);
  const recorders = [{ requests, origin: new URL(ctx.discovery.url).origin }];

  await openReview();
  await askAboutSentence();
  ctx.check("3. ⌘L on a selected sentence of the remote review opened Ask");

  // 4. The agents are the remote's: with OpenCode gone, the panel names the host; back, it answers again.
  await onRemote("mv ~/.opencode ~/.opencode.off");
  await until(
    async () => {
      await ctx.page.evaluate(() => window.dispatchEvent(new Event("focus")));

      return (
        (await panel().getByText(`Not installed on ${alias}`).count()) >= 3
      );
    },
    `the panel to read Not installed on ${alias}`,
    30000,
  );

  for (const agent of ["Claude Code", "Codex", "OpenCode"])
    assert.match(
      await panel()
        .getByRole("listitem")
        .filter({ hasText: agent })
        .innerText(),
      new RegExp(`Not installed on ${alias}`),
    );

  await onRemote("mv ~/.opencode.off ~/.opencode");
  await until(
    async () => {
      await ctx.page.evaluate(() => window.dispatchEvent(new Event("focus")));

      return (await composer().count()) > 0;
    },
    "the composer to come back with OpenCode",
    30000,
  );
  const picker = panel().getByRole("button", { name: "OpenCode", exact: true });

  await picker.click();
  assert.deepEqual(
    await panel()
      .getByRole("menu", { name: "Answer with" })
      .getByRole("menuitemradio")
      .allInnerTexts(),
    ["OpenCode"],
  );
  await picker.click();
  ctx.check(
    `4. without the remote's OpenCode, Claude Code, Codex and OpenCode read Not installed on ${alias}; with it back, Answer with offers OpenCode alone`,
  );

  // 5. The question goes to the remote's agent; its answer streams back through the gateway.
  timings.firstAnswer = await send(question);
  ctx.check(
    `5. OpenCode on ${alias} answered "You asked: …" ${timings.firstAnswer} ms after Ask`,
  );

  // 6. A review on another machine has no Source window: the answer's f.ts is text that says so, and a click asks nothing.
  const reference = panel().getByTitle(
    "Source windows are not available for a review on another machine.",
  );

  await reference.waitFor();
  assert.equal(await reference.innerText(), "f.ts");
  assert.equal(
    await reference.evaluate(
      (element) =>
        element.closest("a, button, [role=link], [role=button]") !== null,
    ),
    false,
    "the f.ts reference is a link or a button",
  );
  assert.equal(await panel().getByRole("link", { name: "f.ts" }).count(), 0);

  // Step 11 audits the whole run for the requests a click could send.
  await reference.click();
  ctx.check(
    "6. the answer's f.ts is text titled Source windows are not available…, not a link or button",
  );

  // 7. Ask spoke only to the local server, and no remote token reached the page.
  const asks = audit(recorders, remoteTokens);

  assert.ok(
    asks.some((r) => r.received?.toString().includes("You asked:")),
    "no watch stream carried the answer",
  );
  ctx.check(
    `7. ${asks.length} Ask requests, all to the local server, none with the remote token; the answer came on its watch stream`,
  );

  // 8. The ssh master dies and comes back: the thread is still saved.
  const master = await masterPid();

  assert.ok(master, "no ssh master for the host");
  process.kill(master, "SIGKILL");
  await until(
    async () =>
      (await hostState()) === "online" && (await masterPid()) !== master,
    `${alias} online on a new master`,
    60000,
  );
  await panel().getByRole("button", { name: "Close Ask" }).click();
  await historyLists("the thread in Ask history after the reattach");
  ctx.check("8. after a new ssh master, Ask history lists the thread");

  // 9. A Desktop restart: the thread is still listed.
  await ctx.quitAndRelaunchDesktop();
  recorders.push({
    requests: await recordRequests(ctx.page, /^$/),
    origin: new URL(ctx.discovery.url).origin,
  });
  await waitState("online", "online after the relaunch");
  remoteTokens.add(await remoteToken());
  await openReview();
  await historyLists("the thread in Ask history after the relaunch");
  await panel().getByRole("button", { name: "Close Ask" }).click();
  ctx.check("9. after a Desktop restart, Ask history lists the thread");

  // 10. The host goes away with a conversation open: the panel says so, and the host reads offline.
  await askAboutSentence();
  await send("and then");
  const thaw = await freeze();

  const paused = Date.now();

  await until(
    async () =>
      (await panel()
        .getByRole("alert")
        .filter({ hasText: "lost its connection" })
        .count()) > 0,
    "the panel's lost-connection alert",
    20000,
  );
  timings.streamEnded = Date.now() - paused;
  await waitState("offline", "offline after the pause", 20000);
  timings.offline = Date.now() - paused;
  assert.ok(
    timings.streamEnded <= 15000,
    `alert after ${timings.streamEnded} ms`,
  );
  assert.ok(timings.offline <= 15000, `offline after ${timings.offline} ms`);
  await thaw?.();
  ctx.check(
    `10. ${prepared === undefined ? "docker pause" : "server SIGSTOP"}: the panel said it lost OpenCode after ${timings.streamEnded} ms; ${alias} offline after ${timings.offline} ms`,
  );

  // 11. Removing the host takes the review out of Home.
  await removeHost(ctx, alias);
  await openHome(ctx);
  await until(
    async () => (await homeRow().count()) === 0,
    "the remote review to leave Home",
  );
  const allAsks = audit(recorders, remoteTokens);

  assert.deepEqual(
    recorders.flatMap(({ requests: recorded }) =>
      [...recorded.values()].flatMap((r) =>
        /\/(navigator|files)(\?|$)/.test(r.url ?? "") ? [r.url] : [],
      ),
    ),
    [],
    "navigator or files requests",
  );
  ctx.check(
    `11. removing the host took the review out of Home; across both launches ${allAsks.length} Ask requests, all to the local server, none with a remote token, and no navigator or files request`,
  );
}

/**
 * Asserts each launch's Ask requests went to that launch's local server and
 * no recorded request carried a remote token; returns the Ask requests.
 */
function audit(recorders, remoteTokens) {
  const asks = [];

  for (const { requests, origin } of recorders)
    for (const r of requests.values()) {
      if (!r.url) continue;
      assert.ok(
        ![r.url, ...Object.values(r.headers ?? {})].some((value) =>
          [...remoteTokens].some((token) => String(value).includes(token)),
        ),
        "a request carried a remote token",
      );

      if (!/\/ask(\/|\?|$)/.test(new URL(r.url).pathname)) continue;
      assert.equal(
        new URL(r.url).origin,
        origin,
        "an Ask request past the local server",
      );
      asks.push(r);
    }

  assert.ok(asks.length > 0, "no Ask request was recorded");

  return asks;
}
