/** Language features for reviews on two SSH hosts and the laptop, in one window: containers from remote/remote.mjs, or two hosts prepared by hand. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { DEFAULT_REMOTE_RUNTIME } from "../../build-remote-runtime.mjs";
import {
  appRoot,
  closeSourceWindow,
  createReview,
  openHome,
  openSettings,
  sleep,
  sourceWindowFor,
} from "../harness.mjs";

const exec = promisify(execFile);

const remoteScript = path.join(import.meta.dirname, "../remote/remote.mjs");

const runId = process.env.WB_TEST_RUN ?? `e2e${Date.now().toString(36)}`;

export const runDir = `/tmp/wbt.${runId}`;

const prepared = process.env.REVIEW_E2E_REMOTE_HOSTS?.split(",");

const [nameA, nameB] = prepared ?? ["a", "b"];

const [aliasA, aliasB] = [`wb-test-${nameA}`, `wb-test-${nameB}`];

const proj = `${runDir}/proj`;

const pyProj = `${runDir}/py`;

const GRACE_SECONDS = 20;

const overridesPath = path.join(appRoot, "code-oss/product.overrides.json");

export const name = "remote-lsp";

export const phase = 2;

export const options = {
  settings: { "review.experimental.remoteHosts.enabled": true },
  env: { DEV_FAST_REVIEW_SSH_CONFIG: `${runDir}/ssh_config` },
  beforeLaunch: stampDesktopCommit,
};

async function stampDesktopCommit(ctx) {
  if (ctx.report.mode === "packaged") return;

  const { commit } = JSON.parse(
    await readFile(path.join(DEFAULT_REMOTE_RUNTIME, "product.json"), "utf8"),
  );

  const stamp = `${JSON.stringify({ commit })}\n`;

  if (existsSync(overridesPath)) {
    assert.equal(
      readFileSync(overridesPath, "utf8"),
      stamp,
      `${overridesPath} exists with other content; move it away first`,
    );

    return;
  }

  writeFileSync(overridesPath, stamp);
  process.once("exit", () => rmSync(overridesPath, { force: true }));
}

const typescriptFixture = String.raw`
set -e
field() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).$1"; }
rm -rf "$1"
git init -q -b main "$1"
cd "$1"
git config user.email e2e@example.invalid
git config user.name e2e
printf '{"compilerOptions":{"strict":true,"target":"ES2022","module":"commonjs"}}\n' > tsconfig.json
printf 'export const answer = %s;\n' "$2" > a.ts
printf 'import { answer } from "./a";\n\nexport const total = 0;\n' > b.ts
git add .
git commit -qm one
printf 'import { answer } from "./a";\n\nexport const total = answer + 1;\n' > b.ts
git commit -qam two
whiteboard api session_create "{\"title\":\"$3\",\"open\":false,\"target\":{\"kind\":\"commits\",\"repositoryPath\":\"$1\",\"base\":\"HEAD~1\",\"head\":\"HEAD\"}}" | field sessionId
`;

const pythonFixture = String.raw`
set -e
field() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).$1"; }
rm -rf "$1"
git init -q -b main "$1"
cd "$1"
git config user.email e2e@example.invalid
git config user.name e2e
printf 'def f(x: int) -> int:\n    return x\n' > m.py
git add .
git commit -qm one
printf 'def f(x: int) -> int:\n    return x\n\n\nvalue = f(1)\n' > m.py
git commit -qam two
whiteboard api session_create "{\"title\":\"$2\",\"open\":false,\"target\":{\"kind\":\"commits\",\"repositoryPath\":\"$1\",\"base\":\"HEAD~1\",\"head\":\"HEAD\"}}" | field sessionId
`;

const processTree = String.raw`
cat ~/.dev/whiteboard-remote/server/server.json
echo
ps -eo pid=,ppid=,rss=,args=
`;

export function bounded(promise, ms, label) {
  let timer;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} did not finish within ${ms} ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function remote(...args) {
  return (
    await exec(process.execPath, [remoteScript, ...args], {
      env: { ...process.env, WB_TEST_RUN: runId },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 900000,
    })
  ).stdout.trim();
}

export function onRemote(alias, command, input = "", timeout = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      ["-F", `${runDir}/ssh_config`, "-o", "BatchMode=yes", alias, command],
      { stdio: ["pipe", "pipe", "pipe"], timeout },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve(stdout.trim())
        : reject(
            new Error(
              `${command.split("\n")[0]} on ${alias}: ${code}: ${stderr}`,
            ),
          ),
    );
    child.stdin.end(input);
  });
}

function check(ctx, text) {
  console.error(`[remote-lsp] ${new Date().toISOString()} ${text}`);
  ctx.check(text);
}

async function attach(alias, env = "") {
  const out = (await onRemote(alias, `${env} whiteboard remote attach --json`))
    .split("\n")
    .map((line) => line.trim());

  let parsed;

  try {
    parsed = JSON.parse(out[out.indexOf("WHITEBOARD-REMOTE-BEGIN") + 1]);
  } catch {
    throw new Error(
      `whiteboard remote attach on ${alias} printed no attach line`,
    );
  }

  assert.ok(
    parsed.languageServer,
    `${alias} has no VS Code server: ${parsed.languageServerDetail}`,
  );

  return parsed.serverId;
}

export async function extensionHosts(alias) {
  return Number(await onRemote(alias, `pgrep -fc '[e]xtensionHost' || true`));
}

export async function remoteMemory(alias) {
  const [serverJson, , ...lines] = (await onRemote(alias, processTree)).split(
    "\n",
  );

  const root = JSON.parse(serverJson).pid;

  const processes = lines
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, rss, args]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      rss: Number(rss),
      args,
    }));

  const tree = processes.filter((p) => p.pid === root);

  for (let i = 0; i < tree.length; i++)
    tree.push(...processes.filter((p) => p.ppid === tree[i].pid));

  const mb = (list) =>
    Math.round(list.reduce((sum, p) => sum + p.rss, 0) / 1024);

  const hosts = tree.filter((p) => p.args.includes("--type=extensionHost"));

  return {
    server: mb(tree.slice(0, 1)),
    extensionHost: mb(hosts),
    languageServers: mb(tree.slice(1).filter((p) => !hosts.includes(p))),
    total: mb(tree),
    processes: tree.length,
  };
}

async function freeze(alias, name, frozen) {
  if (prepared === undefined) return remote(frozen ? "pause" : "resume", name);

  await onRemote(
    alias,
    `pkill -${frozen ? "STOP" : "CONT"} -f '[v]scode-server/out/server-main.js|[w]hiteboard.*server'`,
  );
}

export async function run(ctx) {
  if (ctx.report.mode === "packaged")
    throw new Error("skip: remote-lsp runs in development mode only");

  if (prepared === undefined)
    try {
      await exec("docker", ["info", "--format", "{{.ServerVersion}}"]);
    } catch (error) {
      throw new Error(
        `skip: remote-lsp needs Docker for its SSH servers (${error.message.split("\n")[0]})`,
      );
    }
  else
    assert.equal(prepared.length, 2, "REVIEW_E2E_REMOTE_HOSTS names two hosts");

  try {
    await journey(ctx);
  } finally {
    rmSync(overridesPath, { force: true });

    if (prepared === undefined)
      await remote("down", "--all").catch((error) =>
        console.error(`[remote-lsp] down --all: ${error.message}`),
      );
    else {
      await closeDesktop(ctx);
      await rm(proj, { recursive: true, force: true });
      await rm(`${runDir}/runtime-other`, { recursive: true, force: true });
    }
  }
}

async function journey(ctx) {
  const { page, until } = ctx;
  const timings = {};
  const memory = {};

  if (prepared === undefined) {
    for (const name of [nameA, nameB]) await remote("up", name);

    for (const name of [nameA, nameB]) await remote("install", name);
  }

  let started = Date.now();

  await Promise.all(
    [aliasA, aliasB].map((alias) =>
      onRemote(alias, "whiteboard remote extensions ensure --json"),
    ),
  );
  timings.extensionsDownload = Date.now() - started;

  const serverB = await attach(
    aliasB,
    `DEV_FAST_REVIEW_REMOTE_RECONNECTION_GRACE_SECONDS=${GRACE_SECONDS}`,
  );

  const authorityB = `whiteboard+${serverB.toLowerCase()}`;

  const serverA = await attach(aliasA);

  const title = {
    laptop: "Answer on the laptop",
    a: `Answer on ${aliasA}`,
    b: `Answer on ${aliasB}`,
    py: `Python on ${aliasA}`,
  };

  const reviewA = await onRemote(
    aliasA,
    `bash -s -- '${proj}' 42 '${title.a}'`,
    typescriptFixture,
  );

  const reviewB = await onRemote(
    aliasB,
    `bash -s -- '${proj}' 99 '${title.b}'`,
    typescriptFixture,
  );

  const reviewPy = await onRemote(
    aliasA,
    `bash -s -- '${pyProj}' '${title.py}'`,
    pythonFixture,
  );

  for (const id of [reviewA, reviewB, reviewPy])
    assert.match(id, /^[0-9a-f-]{36}$/, "a remote review's id");

  const commits = await laptopFixture();

  check(
    ctx,
    `${aliasA} and ${aliasB}${prepared ? " (prepared)" : ", containers with this checkout's package,"} hold reviews of ${proj} with answer = 42 and 99, and ${aliasA} a Python review; their extensions downloaded in ${timings.extensionsDownload} ms`,
  );

  const hostState = async (alias) =>
    (await ctx.apiOk("/remote-hosts")).find((host) => host.alias === alias);

  // 1. Add both hosts in Settings; both report language features.
  let settings = await openSettings(ctx);
  let section = settings.getByRole("region", { name: "Remote hosts" });
  const added = {};

  const hostRow = (alias) =>
    section.locator("[data-remote-host]").filter({ hasText: alias });

  for (const alias of [aliasA, aliasB]) {
    await section.getByLabel("SSH alias").fill(alias);
    added[alias] = Date.now();
    await section.getByRole("button", { name: "Add", exact: true }).click();
    await hostRow(alias).waitFor();
  }

  await Promise.all(
    [aliasA, aliasB].map(async (alias) => {
      await until(
        async () => {
          const state = await hostState(alias);

          return state?.state === "online" && state.languageFeatures === true;
        },
        `${alias} online with language features`,
        120000,
      );
      timings[`available ${alias}`] = Date.now() - added[alias];
      await until(
        async () =>
          (await hostRow(alias).innerText()).includes(
            "Language features: available",
          ),
        `the Settings row of ${alias} to say language features are available`,
      );
    }),
  );

  check(
    ctx,
    `1. Settings added ${aliasA} and ${aliasB}; both online with "Language features: available" ${timings[`available ${aliasA}`]} and ${timings[`available ${aliasB}`]} ms after Add`,
  );

  // 2. A review on each machine, open at the same time.
  const laptop = await createReview(ctx, {
    title: title.laptop,
    repoPath: proj,
    base: commits.base,
    head: commits.head,
    blocks: [{ type: "markdown", markdown: "The laptop's answer." }],
  });

  await openHome(ctx);

  const rows = page
    .locator("main.review-home")
    .getByRole("region", { name: "Sessions", exact: true })
    .locator("tbody tr");

  for (const text of [title.a, title.py, title.b]) {
    const row = rows.filter({ hasText: text });

    await row.waitFor({ timeout: 60000 });
    await row.getByTitle(text, { exact: true }).click();
    await visibleCanvas(page)
      .getByRole("heading", { name: text })
      .waitFor({ timeout: 60000 });
    await openHome(ctx);
  }

  for (const text of Object.values(title)) await tab(page, text).waitFor();
  check(
    ctx,
    "2. the laptop's review, two on A and one on B are open in tabs at once",
  );

  const timeOrigin = await page.evaluate(() => performance.timeOrigin);

  const machines = [
    { key: "laptop", alias: "the laptop", review: laptop.reviewId, answer: 1 },
    { key: "a", alias: aliasA, review: reviewA, answer: 42, serverId: serverA },
    { key: "b", alias: aliasB, review: reviewB, answer: 99, serverId: serverB },
  ];

  const answer = (n) => new RegExp(`\\banswer: ${n}\\b`);

  const hover = (m) =>
    windowCall(ctx, "query", m.review, "b.ts", 3, "answer", m.uri);

  const answers = async (m) => {
    const deadline = Date.now() + 20000;
    let result;

    do {
      result = await hover(m);

      if (answer(m.answer).test(result.text)) return result;
      await sleep(500);
    } while (Date.now() < deadline);

    throw new Error(`${m.alias} stopped answering: ${JSON.stringify(result)}`);
  };

  // 3. Hover `answer` in each; go to definition lands in that machine's a.ts.
  const warm = {};
  let countsBefore;

  for (const m of machines) {
    if (m.key === "a") {
      countsBefore = await windowCall(ctx, "counts", laptop.reviewId, "b.ts");
      assert.deepEqual(
        [await extensionHosts(aliasA), await extensionHosts(aliasB)],
        [0, 0],
        "an extension host on a remote before its review's Diff view",
      );
    }

    const diffShown = Date.now();

    await showDiff(ctx, title[m.key], "b.ts");

    const point = await windowCall(ctx, "point", m.review, "b.ts", 3, "answer");

    m.uri = point.uri;
    const shown = await pointerHover(page, point, answer(m.answer), 60000);

    assert.ok(
      shown.ms !== null,
      `no "answer: ${m.answer}" hover on ${m.alias}: ${JSON.stringify(shown.seen)}`,
    );
    timings[`first hover ${m.key}`] = shown.ms;
    timings[`diff to hover ${m.key}`] = Date.now() - diffShown;

    if (m.key !== "laptop")
      timings[`connect to first hover ${m.key}`] = Date.now() - added[m.alias];

    warm[m.key] = [];

    for (let i = 0; i < 3; i++) {
      const result = await hover(m);

      assert.match(
        result.text,
        answer(m.answer),
        `warm hover on ${m.alias}: ${JSON.stringify(result)}`,
      );
      warm[m.key].push(result.ms);
    }

    const opened = await windowCall(ctx, "goto", m.review, "b.ts", 3, "answer");

    if (m.key === "laptop") {
      const source = await sourceWindowFor(ctx, "a.ts");

      assert.match(await lines(source), /export const answer = 1;/);
      await closeSourceWindow(source);
    } else {
      assert.match(
        opened.active?.resource ?? "",
        new RegExp(
          `^vscode-remote://whiteboard%2B${m.serverId.toLowerCase()}/.*/a\\.ts$`,
        ),
        JSON.stringify(opened),
      );
      assert.match(opened.active.text, new RegExp(`answer = ${m.answer};`));
      assert.ok(opened.active.readonly, "the host's a.ts is not read-only");
      assert.ok(opened.active.label.startsWith(`${m.alias}: `));
      await windowCall(ctx, "closeModal");
    }

    check(
      ctx,
      `3${m.key}. ${m.alias}: the hover read "${shown.text.match(answer(m.answer))[0]}" ${shown.ms} ms after the pointer arrived; go to definition opened ${m.key === "laptop" ? "a Source window on" : "read-only"} its a.ts`,
    );
  }

  // 4. A Python review on A: ty answers with a type.
  await showDiff(ctx, title.py, "m.py");

  const pyPoint = await windowCall(ctx, "point", reviewPy, "m.py", 5, "value");
  const pyHover = await pointerHover(page, pyPoint, /\bint\b/, 120000);

  assert.ok(
    pyHover.ms !== null,
    `no type in the Python hover: ${JSON.stringify(pyHover.seen)}`,
  );
  timings["first hover python"] = pyHover.ms;
  check(
    ctx,
    `4. ${aliasA}'s Python review: the hover on value read "${pyHover.text.slice(0, 80)}" after ${pyHover.ms} ms`,
  );

  // 5. The laptop's own providers for its file are the same after the remotes connected.
  await showDiff(ctx, title.laptop, "b.ts");
  await answers(machines[0]);

  const countsAfter = await windowCall(ctx, "counts", laptop.reviewId, "b.ts");

  assert.deepEqual(countsAfter, countsBefore);
  assert.ok(countsBefore.file, "no laptop model for b.ts");
  check(
    ctx,
    `5. the laptop's b.ts has ${countsBefore.file.hover} hover and ${countsBefore.file.definition} definition provider(s) in the window, and its review model ${countsBefore.review.hover}/${countsBefore.review.definition}, before and after both remotes connected`,
  );

  for (const alias of [aliasA, aliasB])
    memory[alias] = await remoteMemory(alias);

  const logLines = (pattern) =>
    windowLog(ctx).then((log) => log.match(pattern) ?? []);

  const failedB = new RegExp(
    `\\[Remote language\\] ${authorityB.replace("+", "\\+")}: .* failed; connecting again`,
    "g",
  );

  // 6. B's tunnel ends for longer than its reconnection lasts; A and the laptop keep answering; B comes back without a reload.
  const [a, b] = [machines[1], machines[2]];
  await showDiff(ctx, title.b, "b.ts");

  const failuresBefore = (await logLines(failedB)).length;
  const master = await masterPid(aliasB);

  assert.ok(master, `no ssh master for ${aliasB}`);

  const down = Date.now();

  await freeze(aliasB, nameB, true);
  process.kill(master, "SIGKILL");

  const whileDown = [];

  try {
    while (Date.now() - down < (GRACE_SECONDS + 25) * 1000) {
      const [fromA, fromLaptop, fromB] = await Promise.all([
        answers(a),
        answers(machines[0]),
        hover(b),
      ]);

      assert.doesNotMatch(fromB.text, answer(99));
      assert.ok(fromB.ms <= 5500, `B's hover took ${fromB.ms} ms while down`);
      whileDown.push([fromA.ms, fromLaptop.ms, fromB.ms]);
      await sleep(3000);
    }
  } finally {
    await freeze(aliasB, nameB, false);
  }

  assert.ok(
    (await logLines(failedB)).length > failuresBefore,
    "B's session did not fail for good while its tunnel was down",
  );

  const restored = Date.now();

  await until(
    async () => answer(99).test((await hover(b)).text),
    `${aliasB} to answer again`,
    240000,
  );
  timings.tunnelBack = Date.now() - restored;
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  check(
    ctx,
    `6. ${aliasB} frozen and its ssh master killed for ${GRACE_SECONDS + 25} s (its grace is ${GRACE_SECONDS} s; its session failed for good): ${whileDown.length} rounds of A 42 and the laptop 1 answered, B empty within ${Math.max(...whileDown.map((r) => r[2]))} ms; B answered 99 ${timings.tunnelBack} ms after it came back, no reload`,
  );

  // 7. B's VS Code server restarts; A keeps answering; B answers again without a reload.
  const serverPid = () =>
    onRemote(aliasB, "pgrep -f '[v]scode-server/out/server-main.js' || true");

  const oldServer = await serverPid();

  assert.ok(oldServer, `no VS Code server on ${aliasB}`);
  await onRemote(aliasB, `kill ${oldServer}`);

  const killed = Date.now();

  await answers(a);
  await until(
    async () => answer(99).test((await hover(b)).text),
    `${aliasB} to answer from a new server`,
    240000,
  );
  timings.serverBack = Date.now() - killed;

  const newServer = await serverPid();

  assert.ok(newServer && newServer !== oldServer, "B's server did not restart");
  await answers(a);
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  check(
    ctx,
    `7. ${aliasB}'s VS Code server killed (pid ${oldServer}); A kept answering; B answered 99 from pid ${newServer} ${timings.serverBack} ms later, no reload`,
  );

  // 8. B runs another commit: its reviews read normally, hovers are absent, and Settings says why.
  if (prepared === undefined) {
    const other = `${runDir}/runtime-other`;

    const { commit } = JSON.parse(
      await readFile(path.join(DEFAULT_REMOTE_RUNTIME, "product.json"), "utf8"),
    );

    await cp(DEFAULT_REMOTE_RUNTIME, other, { recursive: true });
    await writeFile(
      path.join(other, "product.json"),
      JSON.stringify({
        ...JSON.parse(await readFile(path.join(other, "product.json"), "utf8")),
        commit: commit === "f".repeat(40) ? "e".repeat(40) : "f".repeat(40),
      }),
    );
    await remote("install", nameB, "--runtime", other);
    await onRemote(aliasB, "whiteboard server stop");

    const why = `language features need the same Whiteboard version on ${aliasB}`;

    await until(
      async () => {
        const state = await hostState(aliasB);

        return (
          state?.state === "online" &&
          state.languageFeatures === false &&
          state.languageFeaturesDetail?.startsWith(why)
        );
      },
      `${aliasB} online without language features`,
      120000,
    );
    settings = await openSettings(ctx);
    section = settings.getByRole("region", { name: "Remote hosts" });
    await until(
      async () =>
        (await hostRow(aliasB).innerText()).includes(
          `Language features: unavailable — ${why}`,
        ),
      "the Settings row to say why",
    );

    const detail = (await hostRow(aliasB).innerText()).match(
      /Language features: unavailable — .*/,
    )[0];

    await showDiff(ctx, title.b, "b.ts");
    assert.match(await lines(visibleCanvas(page)), /answer \+ 1/);

    const absent = await hover(b);

    assert.equal(absent.text, "", "a hover from a host with another commit");

    const point = await windowCall(ctx, "point", reviewB, "b.ts", 3, "answer");
    const shown = await pointerHover(page, point, /answer/, 6000);

    assert.equal(
      shown.ms,
      null,
      `a hover widget: ${JSON.stringify(shown.seen)}`,
    );
    check(
      ctx,
      `8. ${aliasB} with another commit: its review and Diff read normally, the hover is empty (${absent.ms} ms) and no widget shows; Settings says "${detail}"`,
    );

    await remote("install", nameB);
    await onRemote(aliasB, "whiteboard server stop");
    await until(
      async () => (await hostState(aliasB))?.languageFeatures === true,
      `${aliasB} available again`,
      120000,
    );
  } else check(ctx, "8. skipped on prepared hosts: no package swap");

  // 9. Two reloads leave one extension host per remote; closing the window leaves none.
  const perReload = [];

  let origin = timeOrigin;

  for (let reload = 1; reload <= 2; reload++) {
    await windowCall(ctx, "reload");
    origin = await until(async () => {
      const now = await page
        .evaluate(() => performance.timeOrigin)
        .catch(() => origin);

      return (
        now !== origin &&
        (await page.locator(".monaco-workbench").count()) > 0 &&
        now
      );
    }, `the window to reload (${reload})`);

    for (const m of [a, b])
      await until(
        async () => (await windowCall(ctx, "host", m.serverId)).authority,
        `${m.alias} to connect after reload ${reload}`,
        180000,
      );

    const counts = [];

    for (const alias of [aliasA, aliasB]) {
      await until(
        async () => (await extensionHosts(alias)) === 1,
        `one extension host on ${alias} after reload ${reload}`,
        30000,
      );
      counts.push(await extensionHosts(alias));
    }

    perReload.push(counts);
  }

  const session = await ctx.browser.newBrowserCDPSession();

  await Promise.race([
    session.send("Browser.close").catch(() => {}),
    sleep(2000),
  ]);

  const closed = Date.now();

  for (const alias of [aliasA, aliasB])
    await waitFor(
      async () => (await extensionHosts(alias)) === 0,
      `no extension host on ${alias} after the close`,
      300000,
    );
  timings.closeToNone = Date.now() - closed;
  check(
    ctx,
    `9. after each of two reloads, extension hosts on A and B: ${JSON.stringify(perReload)}; ${timings.closeToNone} ms after the window closed, none`,
  );

  // 10. Timings and memory.
  const firstHovers = ["a", "b"].map((key) => timings[`diff to hover ${key}`]);
  const warmest = Math.max(...Object.values(warm).flat());

  assert.ok(
    Math.max(...firstHovers) <= 10000,
    `a first hover took ${firstHovers} ms`,
  );
  assert.ok(
    warmest <= 500,
    `a warm hover took ${warmest} ms: ${JSON.stringify(warm)}`,
  );
  check(
    ctx,
    `10. first hover from the Diff click (host connect, activation, hover): laptop ${timings["diff to hover laptop"]}, A ${firstHovers[0]}, B ${firstHovers[1]} ms; pointer to text: laptop ${timings["first hover laptop"]}, A ${timings["first hover a"]}, B ${timings["first hover b"]}, Python on A ${timings["first hover python"]} ms; Add to first hover: A ${timings["connect to first hover a"]}, B ${timings["connect to first hover b"]} ms; warm hovers ${JSON.stringify(warm)} ms; memory in MB ${JSON.stringify(memory)}`,
  );
}

async function laptopFixture() {
  const git = async (...args) =>
    (await exec("git", args, { cwd: proj })).stdout.trim();

  await rm(proj, { recursive: true, force: true });
  await mkdir(proj, { recursive: true });
  await git("init", "-q", "-b", "main");
  await git("config", "user.name", "Review E2E");
  await git("config", "user.email", "review-e2e@example.invalid");
  await writeFile(
    `${proj}/tsconfig.json`,
    '{"compilerOptions":{"strict":true,"target":"ES2022","module":"commonjs"}}\n',
  );
  await writeFile(`${proj}/a.ts`, "export const answer = 1;\n");
  await writeFile(
    `${proj}/b.ts`,
    'import { answer } from "./a";\n\nexport const total = 0;\n',
  );
  await git("add", ".");
  await git("commit", "-qm", "one");

  const base = await git("rev-parse", "HEAD");

  await writeFile(
    `${proj}/b.ts`,
    'import { answer } from "./a";\n\nexport const total = answer + 1;\n',
  );
  await git("commit", "-qam", "two");

  return { base, head: await git("rev-parse", "HEAD") };
}

export const visibleCanvas = (page) =>
  page
    .locator(".review-canvas-root [data-review-api]")
    .filter({ visible: true });

export const tab = (page, text) =>
  page.locator(".tabs-container .tab").filter({ hasText: text });

export async function showDiff(ctx, title, file) {
  await tab(ctx.page, title).click();
  await ctx.page
    .locator('[aria-label="Session views"] button[aria-label="Diff"]')
    .filter({ visible: true })
    .click();
  await ctx.until(
    async () =>
      (
        await ctx.page
          .locator(".review-path-label")
          .filter({ visible: true })
          .allInnerTexts()
      ).some((text) => text.includes(file)),
    `the Diff view of ${title} to show ${file}`,
  );
}

export async function lines(scope) {
  return (await scope.locator(".view-line").allInnerTexts())
    .join("\n")
    .replaceAll(" ", " ");
}

export async function pointerHover(page, point, pattern, timeout) {
  const started = Date.now();
  const seen = [];
  let moved = 0;

  while (Date.now() - started < timeout) {
    const text = await bounded(
      page.evaluate(() =>
        [...document.querySelectorAll(".monaco-hover")]
          .flatMap((e) =>
            e.offsetParent !== null && !e.classList.contains("hidden")
              ? [e.innerText.replace(/\s+/g, " ").trim()]
              : [],
          )
          .filter(Boolean)
          .join(" | "),
      ),
      30000,
      "reading the hover",
    );

    if (text && seen.at(-1) !== text) seen.push(text);

    if (pattern.test(text)) return { ms: Date.now() - started, text, seen };

    if (Date.now() - moved > 3000) {
      await page.mouse.move(5, 5);
      await sleep(100);
      await page.mouse.move(point.x - 1, point.y);
      await page.mouse.move(point.x, point.y);
      moved = Date.now();
    }

    await sleep(50);
  }

  return { ms: null, text: "", seen };
}

async function windowLog(ctx) {
  const root = path.join(ctx.userData, "logs");

  const files = (await readdir(root, { recursive: true })).filter((file) =>
    file.endsWith(".log"),
  );

  return (
    await Promise.all(
      files.map((file) =>
        readFile(path.join(root, file), "utf8").catch(() => ""),
      ),
    )
  ).join("\n");
}

export async function waitFor(check, label, timeout) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await sleep(1000);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

export async function windowCall(ctx, command, ...args) {
  const cdp = await bounded(
    ctx.page.context().newCDPSession(ctx.page),
    30000,
    "a CDP session",
  );

  const stage = { at: "start" };

  try {
    return await bounded(
      inWindowOver(cdp, command, args, stage),
      60000,
      `the window's ${command}`,
    ).catch((error) => {
      throw new Error(`${error.message} (at ${stage.at})`);
    });
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function inWindowOver(cdp, command, args, stage) {
  stage.at = "focus emulation";
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  stage.at = "import";

  const prototype = await cdp.send("Runtime.evaluate", {
    expression:
      'import(globalThis._VSCODE_FILE_ROOT + "vs/review/services/remote/reviewRemoteHosts.js").then((m) => m.ReviewRemoteHostsService.prototype)',
    awaitPromise: true,
  });

  stage.at = "queryObjects";

  const { objects } = await cdp.send("Runtime.queryObjects", {
    prototypeObjectId: prototype.result.objectId,
  });

  stage.at = "call";

  const result = await cdp.send("Runtime.callFunctionOn", {
    objectId: objects.objectId,
    functionDeclaration: inWindow.toString(),
    arguments: [{ value: command }, { value: args }],
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );

  if (result.result.value?.error) throw new Error(result.result.value.error);

  return result.result.value;
}

async function inWindow(command, args) {
  const service = [...this].reverse().find((s) => !s.closing);

  if (!service) return { error: "no live ReviewRemoteHostsService" };

  const get = async (file, id) => {
    const module = await import(globalThis._VSCODE_FILE_ROOT + file);

    return service.instantiationService.invokeFunction((a) =>
      a.get(module[id]),
    );
  };

  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);

  if (command === "host") {
    const host = await service.host(args[0]);

    return { authority: host?.authority ?? null, ms: ms() };
  }

  if (command === "reload") {
    const { INativeHostService } = await import(
      `${globalThis._VSCODE_FILE_ROOT}vs/platform/native/common/native.js`
    );

    // Never awaited: the service is an IPC proxy, whose `then` is a remote call that never answers.
    // After this call answers, as the reload ends the page it runs in.
    setTimeout(
      () =>
        service.instantiationService.invokeFunction((a) =>
          a.get(INativeHostService).reload(),
        ),
      100,
    );

    return {};
  }

  if (command === "closeModal") {
    const groups = await get(
      "vs/workbench/services/editor/common/editorGroupsService.js",
      "IEditorGroupsService",
    );

    return { closed: (await groups.activeModalEditorPart?.close()) ?? null };
  }

  const languages = await get(
    "vs/editor/common/services/languageFeatures.js",
    "ILanguageFeaturesService",
  );

  const models = (
    await get("vs/editor/common/services/model.js", "IModelService")
  ).getModels();

  const [reviewId, file, line, word, uri] = args;

  const isReviewHead = (uri) =>
    uri?.scheme === "review-api-source" &&
    uri.authority === reviewId &&
    uri.path === `/${file}` &&
    new URLSearchParams(uri.query).get("side") === "head";

  if (command === "counts") {
    const count = (model) =>
      model && {
        hover: languages.hoverProvider.all(model).length,
        definition: languages.definitionProvider.all(model).length,
      };

    return {
      file: count(
        models.find(
          (m) => m.uri.scheme === "file" && m.uri.path.endsWith(`/${file}`),
        ),
      ),
      review: count(models.find((m) => isReviewHead(m.uri))),
    };
  }

  const { CancellationToken } = await import(
    `${globalThis._VSCODE_FILE_ROOT}vs/base/common/cancellation.js`
  );

  if (command === "query") {
    const { URI } = await import(
      `${globalThis._VSCODE_FILE_ROOT}vs/base/common/uri.js`
    );

    const reference =
      !models.some((m) => isReviewHead(m.uri)) &&
      (await get(
        "vs/editor/common/services/resolverService.js",
        "ITextModelService",
      ).then((resolver) => resolver.createModelReference(URI.parse(uri))));

    const model = reference
      ? reference.object.textEditorModel
      : models.find((m) => isReviewHead(m.uri));

    const queried = performance.now();
    const column = model.getLineContent(line).indexOf(word) + 2;

    const { getHoversPromise } = await import(
      `${globalThis._VSCODE_FILE_ROOT}vs/editor/contrib/hover/browser/getHover.js`
    );

    const hovers = await getHoversPromise(
      languages.hoverProvider,
      model,
      { lineNumber: line, column },
      CancellationToken.None,
    );

    if (reference) reference.dispose();

    return {
      ms: Math.round(performance.now() - queried),
      text: hovers.flatMap((h) => h.contents.map((c) => c.value)).join(" | "),
    };
  }

  const editor = (
    await get(
      "vs/editor/browser/services/codeEditorService.js",
      "ICodeEditorService",
    )
  )
    .listCodeEditors()
    .find(
      (e) =>
        isReviewHead(e.getModel()?.uri) &&
        e.getDomNode()?.isConnected &&
        e.getDomNode().offsetParent !== null,
    );

  if (!editor)
    return { error: `no visible head editor for ${reviewId}/${file}` };

  const model = editor.getModel();

  const position = {
    lineNumber: line,
    column: model.getLineContent(line).indexOf(word) + 2,
  };

  if (command === "point") {
    editor.getDomNode().scrollIntoView({ block: "center" });
    editor.revealLineInCenter(line);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const at = editor.getScrolledVisiblePosition(position);
    const rect = editor.getDomNode().getBoundingClientRect();

    return {
      uri: model.uri.toString(),
      x: Math.round(rect.left + at.left),
      y: Math.round(rect.top + at.top + at.height / 2),
    };
  }

  if (command === "goto") {
    const [editors, labels, commands, { SymbolNavigationAnchor }] =
      await Promise.all([
        get(
          "vs/workbench/services/editor/common/editorService.js",
          "IEditorService",
        ),
        get("vs/platform/label/common/label.js", "ILabelService"),
        get("vs/platform/commands/common/commands.js", "ICommandService"),
        import(
          `${globalThis._VSCODE_FILE_ROOT}vs/editor/contrib/gotoSymbol/browser/goToCommands.js`
        ),
      ]);

    editor.setPosition(position);
    editor.focus();
    await commands.executeCommand(
      "editor.action.revealDefinition",
      new SymbolNavigationAnchor(model, position),
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const active = editors.activeEditor;

    return {
      ms: ms(),
      active: active && {
        resource: active.resource?.toString() ?? null,
        label: active.resource ? labels.getUriLabel(active.resource) : null,
        readonly: Boolean(active.isReadonly()),
        text: editors.activeTextEditorControl?.getModel?.()?.getValue?.() ?? "",
      },
    };
  }

  return { error: `unknown ${command}` };
}

async function closeDesktop(ctx) {
  const session = await ctx.browser?.newBrowserCDPSession().catch(() => null);

  await Promise.race([
    session?.send("Browser.close").catch(() => {}),
    sleep(2000),
  ]);

  for (let i = 0; i < 40 && (await desktopSsh()).length; i++) await sleep(250);

  for (const pid of await desktopSsh()) process.kill(pid, "SIGTERM");
}

async function desktopSshProcesses() {
  const { stdout } = await exec("ps", ["-axo", "pid=,args="]);

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

const desktopSsh = async () =>
  (await desktopSshProcesses()).map(([pid]) => pid);

async function masterPid(alias) {
  return (await desktopSshProcesses()).find(
    ([, args]) => args.includes(" -M -N ") && args.endsWith(`-- ${alias}`),
  )?.[0];
}
