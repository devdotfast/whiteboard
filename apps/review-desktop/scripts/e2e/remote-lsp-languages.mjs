/** One optional language group on an SSH host with its toolchain: the group turned on in the Desktop, a remote review, a hover and go to definition from the remote. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  installExtensionGroup,
  openHome,
  openSettings,
  sleep,
} from "./harness.mjs";
import {
  extensionHosts,
  onRemote,
  pointerHover,
  remote,
  remoteMemory,
  runDir,
  showDiff,
  tab,
  visibleCanvas,
  waitFor,
  windowCall,
} from "./journeys/remote-lsp.mjs";

const exec = promisify(execFile);

const fixtures = path.join(import.meta.dirname, "fixtures/lsp");

// rust-analyzer can take minutes on a large project; these fixtures are small.
const FIRST_HOVER_LIMIT_MS = 120000;

export const LANGUAGES = {
  rust: {
    toolchain: "rust",
    toolDir: "/usr/local/cargo/bin",
    label: "Rust (rust-analyzer)",
    extensionId: "rust-lang.rust-analyzer",
    members: ["rust-lang.rust-analyzer"],
    fixture: "rust",
    file: "src/lib.rs",
    // The reviewed change: commit one stores the order without the storage layer.
    before: [
      "storage::save_order(OrderRecord { id, status })",
      "OrderRecord { id, status }",
    ],
    symbol: "save_order",
    hoverText: /fn save_order\(order: OrderRecord\) -> OrderRecord/,
    definitionFile: "src/storage.rs",
    definitionText: /pub fn save_order\(order: OrderRecord\) -> OrderRecord/,
    // The server binary the extension runs, and the manifest patch that starts it for a Rust file.
    installedCheck: String.raw`
d=$(ls -d ~/.dev/whiteboard-remote/extensions/rust-lang.rust-analyzer-*/)
"$d/server/rust-analyzer" --version
node -pe "JSON.parse(require('fs').readFileSync('$d/package.json','utf8')).activationEvents.includes('onLanguage:rust')"
`,
    debuggers: [],
  },
  swift: {
    toolchain: "swift",
    toolDir: "/usr/bin",
    label: "Swift",
    extensionId: "swiftlang.swift-vscode",
    members: ["swiftlang.swift-vscode", "llvm-vs-code-extensions.lldb-dap"],
    fixture: "swift",
    file: "Sources/Orders/Orders.swift",
    before: [
      "return saveOrder(OrderRecord(id: id, status: status))",
      "return OrderRecord(id: id, status: status)",
    ],
    symbol: "saveOrder",
    hoverText: /func saveOrder\(_ order: OrderRecord\) -> OrderRecord/,
    definitionFile: "Sources/Orders/Storage.swift",
    definitionText: /public func saveOrder\(_ order: OrderRecord\)/,
    debuggers: ["lldb-dap"],
    // A second host with no Swift: it attaches, and Settings names what is missing.
    withoutToolchain: "d",
  },
  csharp: {
    toolchain: "dotnet",
    toolDir: "/usr/share/dotnet",
    label: "C#",
    extensionId: "muhammad-sammy.csharp",
    members: ["muhammad-sammy.csharp", "ms-dotnettools.vscode-dotnet-runtime"],
    fixture: "csharp",
    file: "Orders.cs",
    before: [
      'Storage.SaveOrder(new OrderRecord(id, "queued"))',
      'new OrderRecord(id, "queued")',
    ],
    symbol: "SaveOrder",
    hoverText: /OrderRecord Storage\.SaveOrder\(OrderRecord order\)/,
    definitionFile: "Storage.cs",
    definitionText: /public static OrderRecord SaveOrder\(OrderRecord order\)/,
    debuggers: ["netcoredbg", "vsdbg"],
  },
};

/** The harness options: remote hosts on, and the run's ssh_config. */
export const remoteLspOptions = () => ({
  extensions: "none",
  settings: { "review.experimental.remoteHosts.enabled": true },
  env: { DEV_FAST_REVIEW_SSH_CONFIG: `${runDir}/ssh_config` },
});

/**
 * Runs on the remote: a repository at $1 whose second commit is `file` ($2)
 * as the fixture has it, the first with $3 (base64) replaced by $4 (base64),
 * and a review titled $5. Prints the review's id.
 */
const repository = String.raw`
set -e
uuid() { cat /proc/sys/kernel/random/uuid; }
field() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).$1"; }
cd "$1"
git init -q -b main
git config user.email e2e@example.invalid
git config user.name e2e
cp "$2" "$2.after"
node -e '
const fs = require("fs");
const [file, from, to] = process.argv.slice(1);
const text = fs.readFileSync(file, "utf8");
const [a, b] = [from, to].map((v) => Buffer.from(v, "base64").toString());
if (!text.includes(a)) process.exit(3);
fs.writeFileSync(file, text.replace(a, b));
' "$2" "$3" "$4"
git add -A ':!*.after'
git commit -qm one
mv "$2.after" "$2"
git commit -qam two
repo=$(whiteboard api session_register_repository "{\"path\":\"$1\"}" | field id)
whiteboard api session_create "{\"commandId\":\"$(uuid)\",\"title\":\"$5\",\"open\":false,\"target\":{\"kind\":\"commits\",\"repositoryId\":\"$repo\",\"base\":\"HEAD~1\",\"head\":\"HEAD\"}}" | field sessionId
`;

function check(ctx, id, text) {
  console.error(`[remote-lsp-${id}] ${new Date().toISOString()} ${text}`);
  ctx.check(text);
}

/** The `PATH` a remote process runs with. */
const pathOf = async (alias, pid) =>
  (
    await onRemote(
      alias,
      `tr '\\0' '\\n' < /proc/${pid}/environ | grep '^PATH=' || true`,
    )
  ).slice("PATH=".length);

export async function runRemoteLspJourney(ctx, id) {
  if (ctx.report.mode === "packaged")
    throw new Error(`skip: remote-lsp-${id} runs in development mode only`);

  try {
    await exec("docker", ["info", "--format", "{{.ServerVersion}}"]);
  } catch (error) {
    throw new Error(
      `skip: remote-lsp-${id} needs Docker for its SSH server (${error.message.split("\n")[0]})`,
    );
  }

  try {
    await journey(ctx, id, LANGUAGES[id]);
  } catch (error) {
    // The remote's server and extension host logs say why a language server did not answer.
    await onRemote(
      "wb-test-c",
      'ps -eo pid,rss,args | cut -c1-240; cd ~/.dev/whiteboard-remote/server && find data/logs -name \'*.log\' | while read f; do echo "== $f"; tail -n 60 "$f"; done',
      "",
      60000,
    ).then(
      (logs) => console.error(`[remote-lsp-${id}] remote logs:\n${logs}`),
      () => {},
    );
    throw error;
  } finally {
    const session = await ctx.browser?.newBrowserCDPSession().catch(() => null);

    // The browser drops the connection as it closes, so this answer may never come.
    await Promise.race([
      session?.send("Browser.close").catch(() => {}),
      sleep(2000),
    ]);
    await remote("down", "--all").catch((error) =>
      console.error(`[remote-lsp-${id}] down --all: ${error.message}`),
    );
  }
}

async function journey(ctx, id, language) {
  const { page, until } = ctx;
  const name = "c";
  const alias = `wb-test-${name}`;
  const platform = process.env.REVIEW_E2E_REMOTE_PLATFORM;
  const timings = {};

  // 1. A container from the toolchain's official image, with this checkout's package.
  let started = Date.now();

  await remote(
    "up",
    name,
    "--toolchain",
    language.toolchain,
    ...(platform ? ["--platform", platform] : []),
  );
  await remote("install", name);
  timings.host = Date.now() - started;

  const tool = language.toolchain === "rust" ? "cargo" : language.toolchain;

  // sshd gives a command the system PATH; only a login shell adds the user's.
  const [plain, login, arch] = await Promise.all([
    onRemote(alias, `command -v ${tool} || echo none`),
    onRemote(alias, `bash -lc 'command -v ${tool}'`),
    onRemote(alias, "uname -m"),
  ]);

  check(
    ctx,
    id,
    `1. ${alias} (${arch}) from the ${language.toolchain} image in ${timings.host} ms: ${tool} is ${login} for a login shell, ${plain} for a plain one`,
  );

  // 2. The group turned on in the Desktop: the reader consents, and its extensions download.
  started = Date.now();
  await installExtensionGroup(ctx, {
    label: language.label,
    extensionId: language.extensionId,
  });
  check(
    ctx,
    id,
    `2. "${language.label}" turned on in the Desktop in ${Date.now() - started} ms`,
  );

  // 3. A review of the fixture on the remote.
  const proj = `${runDir}/proj-${id}`;
  const title = `${language.label} on ${alias}`;

  const tar = (
    await exec(
      "tar",
      [
        "--no-xattrs",
        "-C",
        path.join(fixtures, language.fixture),
        "-cf",
        "-",
        ".",
      ],
      { encoding: "buffer", env: { ...process.env, COPYFILE_DISABLE: "1" } },
    )
  ).stdout;

  await onRemote(
    alias,
    `mkdir -p '${proj}' && base64 -d | tar -xf - -C '${proj}'`,
    tar.toString("base64"),
  );

  const encode = (text) => Buffer.from(text).toString("base64");

  const reviewId = await onRemote(
    alias,
    `bash -s -- '${proj}' '${language.file}' '${encode(language.before[0])}' '${encode(language.before[1])}' '${title}'`,
    repository,
  );

  assert.match(reviewId, /^[0-9a-f-]{36}$/, "the remote review's id");
  check(
    ctx,
    id,
    `3. ${alias} holds "${title}", a review of ${proj} whose second commit changes ${language.file}`,
  );

  // 4. The host added in Settings: the Desktop's group reaches the remote, which installs it.
  const settings = await openSettings(ctx);
  const section = settings.getByRole("region", { name: "Remote hosts" });

  const hostRow = (host) =>
    section.locator("[data-remote-host]").filter({ hasText: host });

  const addHost = async (host) => {
    await section.getByLabel("SSH alias").fill(host);
    await section.getByRole("button", { name: "Add", exact: true }).click();
    await hostRow(host).waitFor();
  };

  const hostState = async (host) =>
    (await ctx.apiOk("/remote-hosts")).find((state) => state.alias === host);

  started = Date.now();
  await addHost(alias);

  // A large first download finishes in a detached install, and the Desktop attaches again after a minute.
  const state = await until(
    async () => {
      const current = await hostState(alias);

      return (
        current?.state === "online" &&
        current.languageFeatures === true &&
        current
      );
    },
    `${alias} online with language features`,
    300000,
  );

  timings.available = Date.now() - started;
  assert.deepEqual(state.languageGroups, [{ group: id, installed: true }]);
  await until(async () => {
    const text = await hostRow(alias).innerText();

    return (
      text.includes("Language features: available") &&
      text.includes(`${id}: installed`)
    );
  }, `the Settings row of ${alias} to list ${id} as installed`);

  const listed = JSON.parse(
    await onRemote(
      alias,
      "cat ~/.dev/whiteboard-remote/extensions/extensions.json",
    ),
  ).map((entry) => entry.identifier.id);

  const others = Object.values(LANGUAGES).flatMap((other) =>
    other === language ? [] : other.members,
  );

  for (const member of language.members)
    assert.ok(listed.includes(member), `${member} on ${alias}: ${listed}`);
  assert.deepEqual(
    listed.filter((installed) => others.includes(installed)),
    [],
    "another group on the remote",
  );

  const installed = language.installedCheck
    ? (await onRemote(alias, language.installedCheck)).replace(/\s+/g, " ")
    : "";

  if (language.installedCheck)
    assert.match(installed, /true$/, "onLanguage:rust on the remote");
  check(
    ctx,
    id,
    `4. ${alias} added in Settings: online with language features after ${timings.available} ms, the row says "${id}: installed"; the remote lists ${language.members.join(", ")} and no other optional group${installed ? `; ${installed}` : ""}`,
  );

  // 5. A second host without the toolchain attaches, and Settings names what is missing.
  if (language.withoutToolchain) {
    const bare = `wb-test-${language.withoutToolchain}`;

    await remote(
      "up",
      language.withoutToolchain,
      ...(platform ? ["--platform", platform] : []),
    );
    await remote("install", language.withoutToolchain);
    await addHost(bare);

    const missing = `${tool} was not found on the login shell's PATH`;

    const bareState = await until(
      async () => {
        const current = await hostState(bare);

        return (
          current?.state === "online" &&
          current.languageGroups?.length &&
          current
        );
      },
      `${bare} online with its language groups`,
      300000,
    );

    assert.deepEqual(bareState.languageGroups, [
      { group: id, installed: true, detail: missing },
    ]);
    await until(
      async () =>
        (await hostRow(bare).innerText()).includes(
          `${id}: installed — ${missing}`,
        ),
      `the Settings row of ${bare} to name what is missing`,
    );
    check(
      ctx,
      id,
      `5. ${bare}, with no ${tool}: online, and its Settings row says "${id}: installed — ${missing}"`,
    );
  }

  // 6. The review's Diff view connects the host: a hover shows a type from the remote.
  await openHome(ctx);

  const row = page
    .locator("main.review-home")
    .getByRole("region", { name: "Sessions", exact: true })
    .locator("tbody tr")
    .filter({ hasText: title });

  await row.waitFor({ timeout: 60000 });
  await row.getByTitle(title, { exact: true }).click();
  await visibleCanvas(page)
    .getByRole("heading", { name: title })
    .waitFor({ timeout: 60000 });
  await tab(page, title).waitFor();

  const fileName = path.basename(language.file);

  const content = await readFile(
    path.join(fixtures, language.fixture, language.file),
    "utf8",
  );

  const line =
    content.split("\n").findIndex((text) => text.includes(language.before[0])) +
    1;

  const diffShown = Date.now();

  await showDiff(ctx, title, fileName);

  const point = await windowCall(
    ctx,
    "point",
    reviewId,
    language.file,
    line,
    language.symbol,
  );

  const shown = await pointerHover(
    page,
    point,
    language.hoverText,
    FIRST_HOVER_LIMIT_MS,
  );

  assert.ok(
    shown.ms !== null,
    `no ${language.hoverText} hover on ${alias}: ${JSON.stringify(shown.seen)}`,
  );
  timings.firstHover = Date.now() - diffShown;
  assert.ok(
    timings.firstHover <= FIRST_HOVER_LIMIT_MS,
    `the first hover took ${timings.firstHover} ms`,
  );

  const warm = [];

  for (let i = 0; i < 3; i++) {
    const result = await windowCall(
      ctx,
      "query",
      reviewId,
      language.file,
      line,
      language.symbol,
      point.uri,
    );

    assert.match(
      result.text,
      language.hoverText,
      `warm hover: ${JSON.stringify(result)}`,
    );
    warm.push(result.ms);
  }

  check(
    ctx,
    id,
    `6. the hover on ${language.symbol} read "${shown.text.match(language.hoverText)[0]}" ${timings.firstHover} ms after the Diff click (${shown.ms} ms after the pointer arrived); warm ${warm.join(" / ")} ms`,
  );

  // 7. Go to definition opens the remote's own file, read-only.
  const opened = await windowCall(
    ctx,
    "goto",
    reviewId,
    language.file,
    line,
    language.symbol,
  );

  const serverId = (await hostState(alias)).serverId;

  assert.match(
    opened.active?.resource ?? "",
    new RegExp(
      `^vscode-remote://whiteboard%2B${serverId.toLowerCase()}/.*/${language.definitionFile.replaceAll(".", "\\.")}$`,
    ),
    JSON.stringify(opened),
  );
  assert.match(opened.active.text, language.definitionText);
  assert.ok(
    opened.active.readonly,
    `the host's ${language.definitionFile} is not read-only`,
  );
  assert.ok(opened.active.label.startsWith(`${alias}: `), opened.active.label);
  await windowCall(ctx, "closeModal");
  check(
    ctx,
    id,
    `7. go to definition opened ${opened.active.label}, read-only, holding the definition`,
  );

  // 8. The extension host has the login shell's PATH, which the server was not started with; no debugger runs.
  const server = JSON.parse(
    await onRemote(alias, "cat ~/.dev/whiteboard-remote/server/server.json"),
  ).pid;

  const host = (
    await onRemote(alias, "pgrep -f '[t]ype=extensionHost' | head -1")
  ).trim();

  const [serverPath, hostPath] = [
    await pathOf(alias, server),
    await pathOf(alias, host),
  ];

  assert.ok(
    hostPath.split(":").includes(language.toolDir),
    `the extension host's PATH: ${hostPath}`,
  );

  const debuggers = language.debuggers.length
    ? await onRemote(
        alias,
        `pgrep -fl '${language.debuggers.map((d) => `[${d[0]}]${d.slice(1)}`).join("|")}' || true`,
      )
    : "";

  assert.equal(debuggers, "", "a debugger runs on the remote");

  const memory = await remoteMemory(alias);

  check(
    ctx,
    id,
    `8. the extension host's PATH holds ${language.toolDir} (${hostPath}); the server's is ${serverPath}; ${language.debuggers.length ? `no ${language.debuggers.join(" or ")} process; ` : ""}memory in MB ${JSON.stringify(memory)}`,
  );

  // 9. The window closes; its extension host on the remote ends.
  const session = await ctx.browser.newBrowserCDPSession();

  await Promise.race([
    session.send("Browser.close").catch(() => {}),
    sleep(2000),
  ]);
  await waitFor(
    async () => (await extensionHosts(alias)) === 0,
    `no extension host on ${alias} after the close`,
    300000,
  );
  check(
    ctx,
    id,
    `9. first hover ${timings.firstHover} ms (limit ${FIRST_HOVER_LIMIT_MS}); no extension host on ${alias} after the close`,
  );
}
