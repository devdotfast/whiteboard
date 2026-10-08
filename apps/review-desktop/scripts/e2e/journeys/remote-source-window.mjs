/** A remote review's Source window, as a user meets it: opened from the review and from Ask, offline and back, restored at start, closed when its host goes. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { openSettings } from "../harness.mjs";
import {
  askAboutReviewSentence,
  askPanel,
  openRemoteReview,
} from "./remote-ask.mjs";
import {
  alias,
  assertUriAnswers,
  closeDesktop,
  onRemote,
  prepared,
  recordNavigator,
  remote,
  runDir,
  sourcePages,
} from "./remote-host.mjs";
import { removeHost } from "./remote-install.mjs";
import { lines, pointerHover } from "./remote-lsp.mjs";
import {
  fileText,
  focusFile,
  inSource,
  pointAt,
  quickRows,
  typeInto,
  windowState,
} from "../remote/source-window-helpers.mjs";

const exec = promisify(execFile);

const title = "Remote source";

const second = "Second checkout";

export const name = "remote-source-window";

// Phase 2: the container image downloads Ubuntu packages and Node.
export const phase = 2;

export const options = {
  settings: { "review.experimental.remoteHosts.enabled": true },
  env: { DEV_FAST_REVIEW_SSH_CONFIG: `${runDir}/ssh_config` },
};

/** Runs on the remote: two repositories, each with a review of its second commit (f.ts changed, added.ts added). Prints the reviews' ids. */
const fixture = String.raw`
set -e
field() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).$1"; }
make() {
  rm -rf ~/$1
  git init -q -b main ~/$1
  cd ~/$1
  git config user.email e2e@example.invalid
  git config user.name e2e
  mkdir docs
  printf '%s\n' "$3" > docs/needle.md
  printf 'export function one() {\n  return 1;\n}\n' > f.ts
  git add .
  git commit -qm one
  printf 'export function one() {\n  return 2;\n}\n\nexport function two() {\n  const unused = 3;\n  return one() + 1;\n}\n' > f.ts
  printf 'export const added = "wbsource-added";\n' > added.ts
  git add .
  git commit -qm two
  id=$(whiteboard api session_create "{\"title\":\"$2\",\"open\":false,\"target\":{\"kind\":\"commits\",\"repositoryPath\":\"$HOME/$1\",\"base\":\"HEAD~1\",\"head\":\"HEAD\"}}" | field sessionId)
  whiteboard api session_edit "{\"sessionId\":\"$id\",\"edit\":{\"type\":\"insert\",\"content\":{\"type\":\"markdown\",\"markdown\":\"One now returns **two**.\"}}}" >/dev/null
  echo "$id"
}
make wbsource "$1" wbsource-needle
make wbsource2 "$2" wbsource-other
`;

export async function run(ctx) {
  // A packaged build ignores DEV_FAST_REVIEW_SSH_CONFIG, so its ssh would read the user's configuration.
  if (ctx.report.mode === "packaged")
    throw new Error("skip: remote-source-window runs in development mode only");

  if (prepared === undefined)
    try {
      await exec("docker", ["info", "--format", "{{.ServerVersion}}"]);
    } catch (error) {
      throw new Error(
        `skip: remote-source-window needs Docker for its SSH server (${error.message.split("\n")[0]})`,
      );
    }

  try {
    await journey(ctx);
  } finally {
    if (prepared === undefined)
      await remote("down", "--all").catch((error) =>
        console.error(`[remote-source-window] down --all: ${error.message}`),
      );
    else await closeDesktop(ctx);
  }
}

function check(ctx, text) {
  console.error(`[remote-source-window] ${new Date().toISOString()} ${text}`);
  ctx.check(text);
}

/**
 * Freezes the host: the container, or on a prepared host its user's Node
 * and Whiteboard processes (the review server, the VS Code server and its
 * extension hosts, the attach the Desktop's ssh runs).
 * Returns the function that thaws it.
 */
async function freeze() {
  if (prepared === undefined) {
    await remote("pause", "a");

    return () => remote("resume", "a");
  }

  const pids = await onRemote(String.raw`
    s=$(whiteboard server status --json | node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).serverPid")
    p=$(pgrep -u "$(id -u)" -f 'node|whiteboard' | grep -vx "$$" | tr '\n' ' ')
    kill -STOP $s $p 2>/dev/null
    echo $s $p
  `);

  return () => onRemote(`kill -CONT ${pids}`);
}

/** The host's remote extension hosts, as `[pid, rss KiB]`. */
async function extensionHosts() {
  return (
    await onRemote(
      "ps -eo pid=,rss=,args= | grep -- '--type=extensionHost' | grep -v grep || true",
    )
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/).slice(0, 2).map(Number));
}

const mib = (kib) => Math.round(kib / 1024);

/** The Source window's host entry in its status bar. */
const hostEntry = (page) =>
  page
    .locator('[id="review.sourceWindow.host"]')
    .innerText({ timeout: 1000 })
    .then((text) => text.trim())
    .catch(() => "");

async function journey(ctx) {
  const { until } = ctx;
  const timings = {};
  const navigator = [];

  const hostState = async () =>
    (await ctx.apiOk("/remote-hosts")).find((host) => host.alias === alias);

  const openReview = (text) => openRemoteReview(ctx, text);

  /** The review's Diff view, then Open file on f.ts; resolves with the Source window that shows it. */
  async function openFile(text) {
    await openReview(text);
    await ctx.page
      .locator('[aria-label="Session views"] button[aria-label="Diff"]')
      .filter({ visible: true })
      .click();
    await until(
      async () =>
        (
          await ctx.page
            .locator(".review-path-label")
            .filter({ visible: true })
            .allInnerTexts()
        ).some((t) => t.includes("f.ts")),
      "the Diff view to show f.ts",
    );

    // The button in the header whose path label reads f.ts.
    const index = await until(
      () =>
        ctx.page
          .evaluate(() =>
            [...document.querySelectorAll(".review-multidiff-open")].findIndex(
              (button) => {
                for (let e = button; e; e = e.parentElement) {
                  const label = e.querySelector(".review-path-label");

                  if (label) return label.innerText.trim() === "f.ts";
                }

                return false;
              },
            ),
          )
          .then((i) => (i >= 0 ? i : null)),
      "f.ts's Open file button",
    );

    const before = new Set(sourcePages(ctx));

    await ctx.page.locator(".review-multidiff-open").nth(index).click();

    const source = await until(
      () => sourcePages(ctx).find((page) => !before.has(page)),
      `a new Source window for ${text}`,
      60000,
    );

    await until(
      async () => (await lines(source)).includes("return one() + 1;"),
      "f.ts's text from the host in the Source window",
      120000,
    );

    return source;
  }

  // 1. A host holding two reviews, added in Settings.
  if (prepared === undefined) {
    await remote("up", "a", "--fake-agent");
    await remote("install", "a");
  }

  await onRemote("whiteboard remote extensions ensure --json");

  const [reviewId, secondId] = (
    await onRemote(`bash -s -- '${title}' '${second}'`, fixture)
  ).split("\n");

  assert.match(reviewId, /^[0-9a-f-]{36}$/, "the remote review's id");
  assert.match(secondId, /^[0-9a-f-]{36}$/, "the second review's id");
  await recordNavigator(ctx.page, navigator);

  const section = (await openSettings(ctx)).getByRole("region", {
    name: "Remote hosts",
  });

  await section.getByLabel("SSH alias").fill(alias);

  const added = Date.now();

  await section.getByRole("button", { name: "Add", exact: true }).click();
  await until(
    async () => {
      const host = await hostState();

      return host?.state === "online" && host.languageFeatures === true;
    },
    `${alias} online with language features`,
    180000,
  );
  timings.online = Date.now() - added;
  check(
    ctx,
    `1. ${alias}${prepared ? " (prepared)" : ""} holds two reviews; Settings added it, online with language features ${timings.online} ms after Add`,
  );

  // 2. Open file opens a Source window bound to the host, titled for the review.
  const opened = Date.now();
  const source = await openFile(title);

  timings.openFile = Date.now() - opened;

  let state = await inSource(source, windowState);
  const { authority } = state;
  const serverId = authority.replace(/^whiteboard\+/, "");

  assert.match(authority, /^whiteboard\+[0-9a-f-]+$/, JSON.stringify(state));
  const { serverId: hostServerId } = await hostState();

  assert.ok(hostServerId, "the host reports no server id");
  assert.equal(serverId, hostServerId.toLowerCase());
  assert.equal(state.title, `${title} — Source — Whiteboard`);
  assert.equal(await source.title(), state.title);
  assert.match(
    state.folder,
    new RegExp(`^vscode-remote://${authority.replace("+", "%2B")}/`),
  );
  assert.equal(sourcePages(ctx).length, 1);
  check(
    ctx,
    `2. Open file opened one Source window on ${authority} in ${timings.openFile} ms, titled "${state.title}"`,
  );

  // 3. The explorer lists the checkout.
  await source.keyboard.press("ControlOrMeta+Shift+KeyE");

  const explorer = await until(async () => {
    const rows = await source
      .locator(".explorer-folders-view .monaco-list-row")
      .allInnerTexts()
      .catch(() => []);

    return ["docs", "added.ts", "f.ts"].every((name) =>
      rows.some((row) => row.trim() === name),
    )
      ? rows
      : null;
  }, "the explorer to list docs, added.ts and f.ts");

  check(
    ctx,
    `3. the explorer lists the checkout: ${explorer.map((r) => r.trim()).join(", ")}`,
  );

  // 4. Read-only: typing changes nothing and the notice shows.
  await inSource(source, focusFile, state.active.resource);

  const typed = await typeInto(source, ctx);

  state = await inSource(source, windowState);
  assert.ok(state.active.readonly, "f.ts is not read-only");
  assert.ok(typed.message, "no read-only notice");
  check(
    ctx,
    `4. f.ts is read-only: typing changed nothing and showed "${typed.message}"`,
  );

  // 5. Quick open answers from the host: f.ts, and needle.md, which no editor has open.
  const quick = source.locator(".quick-input-widget input");

  for (const query of ["f.ts", "needle"]) {
    await source.keyboard.press("ControlOrMeta+KeyP");
    await quick.waitFor({ state: "visible" });
    await quick.fill(query);
    await until(
      async () =>
        (await quickRows(source)).some((t) =>
          t.includes(query === "needle" ? "needle.md" : "f.ts"),
        ),
      `quick open to find ${query}`,
      60000,
    );
    await source.keyboard.press("Escape");
    await quick.waitFor({ state: "hidden" });
  }

  check(ctx, "5. quick open found f.ts, and needle.md, which was not open");

  // 6. Text search.
  await source.keyboard.press("ControlOrMeta+Shift+KeyF");
  await until(
    () =>
      source.evaluate(
        () => !!document.activeElement?.closest(".search-view .search-widget"),
      ),
    "focus in the search view's input",
  );
  await source.keyboard.press("ControlOrMeta+KeyA");
  await source.keyboard.type("wbsource-needle");

  const results = await until(async () => {
    const text = await source
      .locator(".search-view")
      .innerText()
      .catch(() => "");

    return text.includes("needle.md") && text;
  }, "needle.md in the search results");

  check(
    ctx,
    `6. text search found wbsource-needle: "${results.replace(/\s+/g, " ").slice(0, 60)}…"`,
  );

  // 7. A TypeScript hover from the host's language server.
  await inSource(source, focusFile, state.active.resource);

  const hover = await pointerHover(
    source,
    await inSource(source, pointAt, 7, "one"),
    /function one\(\): number/,
    90000,
  );

  assert.ok(hover.ms !== null, `no hover: ${JSON.stringify(hover.seen)}`);
  check(
    ctx,
    `7. the hover on one read "function one(): number" after ${hover.ms} ms`,
  );

  // 8. A code action from the host's TypeScript runs from the window.
  const action = await until(
    () => inSource(source, codeAction, state.active.resource),
    "TypeScript's Remove unused declaration code action",
    60000,
  );

  assert.equal(action.result, true, JSON.stringify(action));
  assert.ok(action.diagnosticBefore, "no unused-declaration diagnostic");
  assert.equal(action.diagnosticAfter, false, JSON.stringify(action));
  check(
    ctx,
    `8. TypeScript's "${action.title}" (${action.command}) answered ${action.result} from the host and cleared its diagnostic`,
  );

  // 9. An added file's diff opens in the same window, its empty side the laptop's.
  await inSource(ctx.page, openDiff, reviewId, "added.ts");

  const diff = await until(
    () => inSource(source, activeDiff),
    "added.ts's diff in the Source window",
    60000,
  );

  assert.equal(diff.original.scheme, "vscode-userdata", JSON.stringify(diff));
  assert.equal(diff.original.text, "");
  assert.match(
    diff.modified.uri,
    new RegExp(
      `^vscode-remote://${authority.replace("+", "%2B")}/.*/added\\.ts$`,
    ),
  );
  assert.match(diff.modified.text, /wbsource-added/);
  assert.deepEqual(sourcePages(ctx), [source]);
  check(
    ctx,
    `9. added.ts's diff opened in the same window: its original side is ${diff.original.uri} (empty), its modified side the host's`,
  );

  // 10. An Ask file link opens the same window at its line.
  await inSource(source, focusFile, state.active.resource);
  await inSource(source, cursorLine, 1);
  await ctx.page
    .locator('[aria-label="Session views"] button[aria-label="Whiteboard"]')
    .filter({ visible: true })
    .click();

  const link = await askLink(ctx, "where is `./f.ts:7`");

  await link.click();
  await until(
    async () => {
      const at = await inSource(source, cursorLine);

      return at.resource?.endsWith("/f.ts") && at.line === 7;
    },
    "f.ts at line 7 in the Source window",
    60000,
  );
  assert.deepEqual(sourcePages(ctx), [source]);
  check(
    ctx,
    `10. the Ask answer's ./f.ts:7 link opened f.ts at line 7 in the same Source window`,
  );

  // Extension-host RSS with one Source window, then two; checked at the end.
  const rss = { one: await extensionHosts() };
  const other = await openFile(second);

  assert.equal(sourcePages(ctx).length, 2);
  await until(
    async () => (await extensionHosts()).length > rss.one.length,
    "the second window's extension host",
    60000,
  );
  rss.two = await extensionHosts();
  await other.keyboard.press("ControlOrMeta+Shift+KeyW");
  await until(() => other.isClosed(), "the second Source window to close");

  // 11–12. The host freezes: the window's status bar says so, then names the host again.
  const offlineText = `${alias} — offline, reconnecting…`;

  let thaw = await freeze();
  const paused = Date.now();

  await until(
    async () => (await hostEntry(source)) === offlineText,
    "the Source window's status bar to read offline",
    30000,
  );
  timings.offline = Date.now() - paused;
  assert.ok(timings.offline <= 20000, `offline after ${timings.offline} ms`);
  assert.equal((await inSource(source, windowStatus)).dialogs, 0);
  check(
    ctx,
    `11. paused: the Source window's status bar read "${offlineText}" after ${timings.offline} ms, with no dialog`,
  );

  await thaw();

  const resumed = Date.now();

  await until(
    async () =>
      (await hostEntry(source)) === alias &&
      (await inSource(source, readsCheckout).catch(() => false)),
    "the Source window to reconnect",
    60000,
  );
  timings.reconnect = Date.now() - resumed;
  assert.ok(
    timings.reconnect <= 30000,
    `reconnected after ${timings.reconnect} ms`,
  );
  check(
    ctx,
    `12. resumed: the status bar read "${alias}" again and the checkout answered after ${timings.reconnect} ms`,
  );

  // 13–14. A restart with the host paused: the restored window is offline, without a dialog, then reconnects.
  thaw = await freeze();
  await ctx.quitAndRelaunchDesktop();

  const relaunched = Date.now();

  const restored = await until(
    async () => {
      for (const page of ctx.browser.contexts().flatMap((c) => c.pages()))
        if ((await page.title().catch(() => "")) === state.title) return page;

      return null;
    },
    "the restored Source window",
    60000,
  );

  // The harness takes the first workbench page, which can be the restored Source window.
  ctx.page = ctx.browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((page) => page !== restored && page.url().includes("workbench"));
  await ctx.watchPage(ctx.page);
  await recordNavigator(ctx.page, navigator);

  await until(
    async () => (await hostEntry(restored)) === offlineText,
    "the restored window's status bar to read offline",
    120000,
  );
  timings.restoredOffline = Date.now() - relaunched;
  assert.equal(
    (await inSource(restored, windowStatus)).dialogs,
    0,
    "a dialog in the restored window",
  );
  check(
    ctx,
    `13. after a restart with ${alias} paused, the restored Source window's status bar read "${offlineText}" ${timings.restoredOffline} ms after the relaunch, with no dialog`,
  );

  await thaw();

  const unpaused = Date.now();

  await until(
    async () =>
      (await hostEntry(restored).catch(() => "")) === alias &&
      (await lines(restored).catch(() => "")).includes("return one() + 1;") &&
      (await inSource(restored, readsCheckout).catch(() => false)),
    "the restored Source window to reconnect",
    90000,
  );
  timings.restoredReconnect = Date.now() - unpaused;
  assert.ok(
    timings.restoredReconnect <= 30000,
    `reconnected after ${timings.restoredReconnect} ms`,
  );
  check(
    ctx,
    `14. resumed: the restored window's status bar read "${alias}" and it showed f.ts from the host ${timings.restoredReconnect} ms later`,
  );

  // 15. Removing the host closes its window.
  await removeHost(ctx, alias);
  await until(() => restored.isClosed(), "the Source window to close", 30000);
  assert.deepEqual(sourcePages(ctx), []);
  check(ctx, `15. removing ${alias} in Settings closed its Source window`);

  // 16. Every navigator answer the UI received named URIs, never host paths.
  const answers = assertUriAnswers(navigator, authority);

  assert.ok(answers >= 4, `${answers} navigator answers`);

  check(
    ctx,
    `16. ${answers} navigator answers reached the UI, each with workspaceUri and fileUri (or emptySide) on ${authority}, none with workspacePath or filePath`,
  );

  // 17. The host's extension hosts with one Source window, then two.
  const total = (hosts) => mib(hosts.reduce((sum, [, kib]) => sum + kib, 0));
  const extra = rss.two.filter(([pid]) => !rss.one.some(([p]) => p === pid));

  check(
    ctx,
    `17. extension hosts on ${alias}: the review window and one Source window ${rss.one.length} processes, ${rss.one.map(([, kib]) => `${mib(kib)} MiB`).join(" + ")} = ${total(rss.one)} MiB; two Source windows ${rss.two.length}, ${total(rss.two)} MiB (the second window's ${extra.map(([, kib]) => `${mib(kib)} MiB`).join(", ")})`,
  );
}

// The functions below run in a window.

/** TypeScript's quick fix for the unused declaration on line 6, run as a click would run it. */
async function codeAction({ get, imp }, resource) {
  const [commands, markers] = await Promise.all([
    get("vs/platform/commands/common/commands.js", "ICommandService"),
    get("vs/platform/markers/common/markers.js", "IMarkerService"),
  ]);

  const { URI } = await imp("vs/base/common/uri.js");
  const uri = URI.parse(resource);

  const unused = () =>
    markers
      .read({ resource: uri })
      .find((m) => m.startLineNumber === 6 && /never read/.test(m.message));

  const diagnostic = unused();

  if (!diagnostic) return null;

  const actions = await commands.executeCommand(
    "_executeCodeActionProvider",
    uri,
    {
      startLineNumber: diagnostic.startLineNumber,
      startColumn: diagnostic.startColumn,
      endLineNumber: diagnostic.endLineNumber,
      endColumn: diagnostic.endColumn,
    },
  );

  const action = actions?.find((a) =>
    /^Remove unused declaration/.test(a.title),
  );

  if (!action?.command) return null;

  const result = await commands.executeCommand(
    action.command.id,
    ...(action.command.arguments ?? []),
  );

  for (let frame = 0; unused() && frame < 120; frame++)
    await new Promise((resolve) => requestAnimationFrame(resolve));

  return {
    title: action.title,
    command: action.command.id,
    result,
    diagnosticBefore: diagnostic.message,
    diagnosticAfter: !!unused(),
  };
}

/** The canvas bridge's openDiff verb for `path`, on the review's current view. */
async function openDiff({ get, imp }, reviewId, path) {
  const { resolveReviewSourceView } = await imp(
    "vs/review/common/reviewProtocol.js",
  );

  const source = await get(
    "vs/review/services/reviewApiSourceService.js",
    "IReviewApiSourceService",
  );

  const snapshot = await source.read(reviewId, "", { full: "true" });

  await source.openDiff(resolveReviewSourceView(snapshot), path);

  return true;
}

async function activeDiff({ get }) {
  const editors = await get(
    "vs/workbench/services/editor/common/editorService.js",
    "IEditorService",
  );

  const control = editors.activeTextEditorControl;
  const model = control?.getModel?.();

  if (!model?.original || !model?.modified) return null;

  if (!model.modified.uri.path.endsWith("/added.ts")) return null;

  return {
    original: {
      scheme: model.original.uri.scheme,
      uri: model.original.uri.toString(),
      text: model.original.getValue(),
    },
    modified: {
      uri: model.modified.uri.toString(),
      text: model.modified.getValue(),
    },
  };
}

/** Moves the cursor to `line` when given; returns the active file and line. */
async function cursorLine({ get }, line) {
  const editor = (
    await get(
      "vs/editor/browser/services/codeEditorService.js",
      "ICodeEditorService",
    )
  ).getActiveCodeEditor();

  if (line) editor?.setPosition({ lineNumber: line, column: 1 });

  return {
    resource: editor?.getModel()?.uri.toString(),
    line: editor?.getPosition()?.lineNumber,
  };
}

async function readsCheckout({ get }) {
  const [files, workspace] = await Promise.all([
    get("vs/platform/files/common/files.js", "IFileService"),
    get(
      "vs/platform/workspace/common/workspace.js",
      "IWorkspaceContextService",
    ),
  ]);

  const folder = workspace.getWorkspace().folders[0].uri;
  const stat = await files.resolve(folder);

  return stat.children?.some((child) => child.name === "f.ts") ?? false;
}

/** Open dialogs, native or not, and the window's text. */
async function windowStatus({ get }) {
  const dialogs = await get(
    "vs/platform/dialogs/common/dialogs.js",
    "IDialogService",
  );

  return {
    dialogs: dialogs.model.dialogs.length,
    body: document.body.innerText,
  };
}

/** Opens Ask on the review's sentence, asks `question`, and returns the answer's link for its file. */
async function askLink(ctx, question) {
  const panel = askPanel(ctx);

  await askAboutReviewSentence(ctx);

  const composer = panel.getByRole("combobox", { name: "Question" });

  await composer.waitFor({ timeout: 30000 });
  await composer.fill(question);
  await panel.getByRole("button", { name: "Ask", exact: true }).click();

  const link = panel.getByRole("link").filter({ hasText: /^\.\/f\.ts:7$/ });

  await link.waitFor({ timeout: 30000 });

  return link;
}
