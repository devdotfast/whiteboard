import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { processStartIdentity } from "@dev.fast/trace-core";
import {
  REMOTE_ATTACH_BEGIN,
  REMOTE_ATTACH_END,
  ensureDiffr,
  remoteAttach,
} from "@review/remote-attach.js";
import {
  headlessServerLockPath,
  readReviewServerDiscovery,
  readReviewServerHealth,
  reviewServerDiscoveryPath,
} from "@review/server-discovery.js";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  isolatedEnv,
  packageRoot,
  sourceCli,
  stopServersUnder,
} from "./background-server-test-utils.js";
import {
  backgroundServerLogPath,
  ensureBackgroundServer,
} from "./background-server.js";
import { fetchedDiffrPath } from "./structural-diff.js";

let root: string;

let stateDir: string;

let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "wb-bg-")));
  stateDir = path.join(root, "state");
  env = isolatedEnv(root);
});

afterEach(async () => {
  await stopServersUnder(root);
  await rm(root, { recursive: true, force: true });
});

it("leaves a detached server running, reports it again, and stops it", async () => {
  const first = await cli(["server", "start", "--detach", "--json"]);

  expect(first).toMatchObject({ code: 0, stderr: "" });
  const started = JSON.parse(first.stdout);
  expect(started).toMatchObject({ event: "server.status", started: true });

  const discovery = (await readReviewServerDiscovery(stateDir))!;
  expect(discovery.startedBy).toBe("cli");
  expect(discovery.serverPid).toBe(started.serverPid);
  expect(await readReviewServerHealth(discovery)).toMatchObject({ ok: true });

  const second = await cli(["server", "start", "--detach", "--json"]);
  expect(JSON.parse(second.stdout)).toMatchObject({
    started: false,
    serverPid: started.serverPid,
    url: started.url,
  });

  expect((await cli(["server", "reset-id", "--json"])).code).toBe(1);

  const stopped = await cli(["server", "stop", "--json"]);
  expect(JSON.parse(stopped.stdout)).toMatchObject({
    event: "server.stop",
    stopped: true,
    serverPid: started.serverPid,
  });
  expect(alive(started.serverPid)).toBe(false);
  expect(await readReviewServerDiscovery(stateDir)).toBeNull();
}, 60_000);

it("prints the new lines of the log when a detached server never becomes ready", async () => {
  const busy = createServer().listen(0, "127.0.0.1");
  await once(busy, "listening");
  const { port } = busy.address() as { port: number };

  try {
    await mkdir(path.dirname(backgroundServerLogPath(stateDir)), {
      recursive: true,
    });
    await writeFile(backgroundServerLogPath(stateDir), "earlier run\n");

    const result = await cli([
      "server",
      "start",
      "--detach",
      "--port",
      `${port}`,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("EADDRINUSE");
    expect(result.stderr).not.toContain("earlier run");
  } finally {
    busy.close();
  }
}, 60_000);

it("refuses to stop a server the user started in the foreground", async () => {
  const server = spawn(
    sourceCli[0]!,
    [
      ...sourceCli.slice(1),
      "server",
      "start",
      "--json",
      "--state-dir",
      stateDir,
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );

  await readyLine(server);

  const refused = await cli(["server", "stop", "--json"]);

  expect(refused.code).toBe(1);
  expect(JSON.parse(refused.stdout).error.message).toMatch(/foreground/);

  const discovery = (await readReviewServerDiscovery(stateDir))!;
  expect(discovery.startedBy).toBe("user");
  expect(await readReviewServerHealth(discovery)).toMatchObject({ ok: true });
}, 60_000);

it("never signals the pid of a stale discovery file", async () => {
  const bystander = spawn(process.execPath, [
    "-e",
    "setTimeout(() => {}, 60000)",
    root,
  ]);

  try {
    const file = reviewServerDiscoveryPath(stateDir);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        instanceId: crypto.randomUUID(),
        url: "http://127.0.0.1:9",
        serverPid: bystander.pid,
        token: "stale",
        startedBy: "cli",
      }),
    );

    const result = await cli(["server", "stop", "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ stopped: false });
    expect(alive(bystander.pid!)).toBe(true);
  } finally {
    bystander.kill("SIGKILL");
  }
}, 30_000);

it("ends two simultaneous starts with one server that both callers reach", async () => {
  const [a, b] = await Promise.all([
    ensureBackgroundServer({ stateDir, env, cli: sourceCli }),
    ensureBackgroundServer({ stateDir, env, cli: sourceCli }),
  ]);

  expect(a.discovery.instanceId).toBe(b.discovery.instanceId);
  expect([a.started, b.started].filter(Boolean)).toHaveLength(1);
  expect(await readReviewServerHealth(a.discovery)).toMatchObject({ ok: true });
  expect(
    spawnSync("pgrep", ["-f", `server start --state-dir ${stateDir}`], {
      encoding: "utf8",
    })
      .stdout.trim()
      .split("\n"),
  ).toEqual([`${a.discovery.serverPid}`]);
}, 60_000);

it("attaches with one JSON line between the sentinels, and its token reaches the server", async () => {
  // An override resolves diffr, so the real fetcher never runs and nothing
  // is written into this checkout's package.
  const diffr = await fakeDiffr();
  const first = await cli(["remote", "attach", "--json"], diffr);

  expect(first.code).toBe(0);
  const lines = first.stdout.split("\n");
  expect(lines).toEqual([
    REMOTE_ATTACH_BEGIN,
    expect.any(String),
    REMOTE_ATTACH_END,
    "",
  ]);

  const attach = JSON.parse(lines[1]!);
  expect(attach).toEqual({
    event: "remote.attach",
    version: expect.any(String),
    commit: null,
    serverId: expect.any(String),
    url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
    token: expect.any(String),
    startedServer: true,
    diffr: true,
    languageServer: null,
    languageServerDetail: expect.stringContaining("has no VS Code server"),
    languageGroups: [],
  });

  const reviews = (token?: string) =>
    fetch(`${attach.url}/reviews-api`, {
      headers: token ? { "x-review-token": token } : {},
    }).then((response) => response.status);

  expect(await reviews(attach.token)).toBe(200);
  expect(await reviews()).toBe(401);
  expect((await readReviewServerDiscovery(stateDir))!.startedBy).toBe(
    "desktop",
  );

  const second = await cli(["remote", "attach", "--json"], diffr);
  expect(JSON.parse(second.stdout.split("\n")[1]!)).toMatchObject({
    startedServer: false,
    serverId: attach.serverId,
    url: attach.url,
    token: attach.token,
  });

  expect(
    await readFile(backgroundServerLogPath(stateDir), "utf8"),
  ).not.toContain(attach.token);
  expect(
    spawnSync("ps", ["-eo", "args"], { encoding: "utf8" }).stdout,
  ).not.toContain(attach.token);
}, 60_000);

it("prints a failed attach between the sentinels and exits non-zero", async () => {
  await writeFile(path.join(root, "file"), "");

  const failed = await cli(
    ["remote", "attach", "--json"],
    await fakeDiffr(),
    path.join(root, "file", "state"),
  );

  expect(failed.code).toBe(1);
  const lines = failed.stdout.split("\n");
  expect(lines).toEqual([
    REMOTE_ATTACH_BEGIN,
    expect.any(String),
    REMOTE_ATTACH_END,
    "",
  ]);
  expect(JSON.parse(lines[1]!)).toMatchObject({
    event: "error",
    error: { message: expect.stringContaining("ENOTDIR") },
  });
}, 30_000);

it("ensures diffr on its own, one JSON line, without starting a server", async () => {
  const found = await cli(
    ["remote", "diffr", "ensure", "--json"],
    await fakeDiffr(),
  );
  expect(found.code).toBe(0);
  expect(JSON.parse(found.stdout)).toEqual({
    event: "remote.diffr",
    diffr: true,
  });

  // A missing override and HTTPS refused: the fetch fails, and that is not an error.
  const missing = await cli(["remote", "diffr", "ensure", "--json"], {
    REVIEW_DIFFR_BINARY: path.join(root, "absent", "diffr"),
  });
  expect(missing.code).toBe(0);
  expect(JSON.parse(missing.stdout)).toEqual({
    event: "remote.diffr",
    diffr: false,
  });
  expect(existsSync(reviewServerDiscoveryPath(stateDir))).toBe(false);
}, 60_000);

it("attaches without a network, with structural diff off and nothing written", async () => {
  const packageRoot = path.join(root, "package");
  await mkdir(packageRoot);

  const attach = await remoteAttach({
    stateDir,
    env: { ...env, PATH: path.dirname(process.execPath) },
    stderr: discard(),
    packageRoot,
    cli: sourceCli,
  });

  expect(attach).toMatchObject({ startedServer: true, diffr: false });
  expect(existsSync(path.join(packageRoot, "bin", "diffr"))).toBe(false);
  expect(existsSync(fetchedDiffrPath(stateDir))).toBe(false);
}, 60_000);

it("attaches the review server when the language extensions cannot be installed", async () => {
  const packageRoot = path.join(root, "package");
  await mkdir(path.join(packageRoot, "vscode-server"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "vscode-server", "product.json"),
    JSON.stringify({ commit: "f".repeat(40) }),
  );

  const attach = await remoteAttach({
    stateDir,
    env: { ...env, PATH: path.dirname(process.execPath) },
    stderr: discard(),
    packageRoot,
    cli: sourceCli,
    groups: ["go"],
    ensureExtensions: async ({ groups }) => ({
      failed: [{ id: "golang.go", error: `groups ${groups?.join(",")}` }],
    }),
  });

  expect(attach).toMatchObject({
    startedServer: true,
    languageServer: null,
    languageServerDetail:
      "Could not install the language extensions: golang.go: groups go",
    languageGroups: [{ group: "go", installed: false }],
  });

  const reviews = await fetch(`${attach.url}/reviews-api`, {
    headers: { "x-review-token": attach.token },
  });

  expect(reviews.status).toBe(200);
}, 60_000);

it("attaches a remote whose login shell has no Swift, and the group names what is missing", async () => {
  const packageRoot = path.join(root, "package");
  await mkdir(path.join(packageRoot, "vscode-server"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "vscode-server", "product.json"),
    JSON.stringify({ commit: "f".repeat(40) }),
  );

  // A login shell that finds no command at all.
  const shell = path.join(root, "shell");
  await writeFile(shell, "#!/bin/sh\nexit 127\n", { mode: 0o755 });

  const attach = await remoteAttach({
    stateDir,
    env: { ...env, PATH: path.dirname(process.execPath), SHELL: shell },
    stderr: discard(),
    packageRoot,
    cli: sourceCli,
    groups: ["swift"],
    ensureExtensions: async () => ({
      failed: [],
      groups: [{ group: "swift", installed: true }],
    }),
  });

  expect(attach).toMatchObject({
    startedServer: true,
    languageGroups: [
      {
        group: "swift",
        installed: true,
        detail: "swift was not found on the login shell's PATH",
      },
    ],
  });
}, 60_000);

it("gives up on a refused download at once and on a stalled one at the bound", async () => {
  const packageRoot = path.join(root, "package");
  await mkdir(packageRoot);
  const noDiffr = { ...env, PATH: path.dirname(process.execPath) };

  let began = Date.now();
  expect(
    await ensureDiffr({
      stateDir,
      env: noDiffr,
      stderr: discard(),
      packageRoot,
    }),
  ).toBe(false);
  expect(Date.now() - began).toBeLessThan(5_000);

  const stalls = path.join(root, "stalls.mjs");
  await writeFile(stalls, "setTimeout(() => {}, 60_000);\n");
  began = Date.now();
  expect(
    await ensureDiffr({
      stateDir,
      env: noDiffr,
      stderr: discard(),
      packageRoot,
      fetcher: stalls,
      timeoutMs: 500,
    }),
  ).toBe(false);
  expect(Date.now() - began).toBeLessThan(3_000);
}, 30_000);

it("fetches diffr into the state directory, never into the package", async () => {
  const packageRoot = path.join(root, "package");
  await mkdir(packageRoot);

  expect(await attachDiffr(packageRoot, await fakeFetcher())).toBe(true);
  expect(existsSync(fetchedDiffrPath(stateDir))).toBe(true);
  expect(existsSync(path.join(packageRoot, "bin"))).toBe(false);
});

it("keeps a fetched diffr whose stamp matches the pin, without downloading", async () => {
  const binary = await fetchedCopy(PINNED);
  const before = await stat(binary);

  // The real fetcher, with HTTPS refused: a download attempt would fail.
  expect(await attachDiffr(path.join(root, "package"))).toBe(true);
  expect((await stat(binary)).mtimeMs).toBe(before.mtimeMs);
});

it("replaces a fetched diffr of another version", async () => {
  const binary = await fetchedCopy("0.0.0-old");

  expect(
    await attachDiffr(path.join(root, "package"), await fakeFetcher()),
  ).toBe(true);
  expect(await readFile(binary, "utf8")).toBe("#!/bin/sh\n# fetched\n");
});

it("reports an old fetched diffr it could not refresh as missing, and keeps it", async () => {
  const binary = await fetchedCopy("0.0.0-old");

  expect(await attachDiffr(path.join(root, "package"))).toBe(false);
  expect(await readFile(binary, "utf8")).toBe("#!/bin/sh\n# old\n");
});

it("leaves a bundled or overriding diffr alone and fetches nothing", async () => {
  const packageRoot = path.join(root, "package");
  await mkdir(path.join(packageRoot, "bin"), { recursive: true });
  await writeFile(path.join(packageRoot, "bin", "diffr"), "#!/bin/sh\n", {
    mode: 0o755,
  });
  const fetcher = await fakeFetcher();
  let stderr = "";

  expect(
    await ensureDiffr({
      stateDir,
      env: { ...env, PATH: path.dirname(process.execPath) },
      stderr: new Writable({
        write(chunk, _encoding, done) {
          stderr += chunk;
          done();
        },
      }),
      packageRoot,
      fetcher,
    }),
  ).toBe(true);
  expect(stderr).toBe("");
  expect(existsSync(`${fetcher}.ran`)).toBe(false);
  expect(existsSync(path.join(stateDir, "review-tools"))).toBe(false);

  expect(
    await ensureDiffr({
      stateDir,
      env: { ...env, ...(await fakeDiffr()) },
      stderr: discard(),
      packageRoot: path.join(root, "empty"),
      fetcher,
    }),
  ).toBe(true);
  expect(existsSync(`${fetcher}.ran`)).toBe(false);
});

it("ends a pending download when the server cannot start", async () => {
  const stalls = path.join(root, "stalls.mjs");
  await writeFile(stalls, "setTimeout(() => {}, 60_000);\n");
  await writeFile(path.join(root, "file"), "");
  await mkdir(path.join(root, "package"));
  const began = Date.now();

  await expect(
    remoteAttach({
      stateDir: path.join(root, "file", "state"),
      env: { ...env, PATH: path.dirname(process.execPath) },
      stderr: discard(),
      packageRoot: path.join(root, "package"),
      fetcher: stalls,
      cli: sourceCli,
    }),
  ).rejects.toThrow(/ENOTDIR/);
  expect(Date.now() - began).toBeLessThan(5_000);

  expect(spawnSync("pgrep", ["-f", stalls]).status).toBe(1);
}, 30_000);

it("runs the detached server in its state directory, not the caller's", async () => {
  const caller = path.join(root, "caller");
  await mkdir(caller);

  const started = await cli(
    ["server", "start", "--detach", "--json"],
    {},
    stateDir,
    caller,
  );

  expect(started.code).toBe(0);
  const { serverPid, url } = JSON.parse(started.stdout);
  await rm(caller, { recursive: true });

  const cwd = spawnSync(
    "lsof",
    ["-a", "-p", `${serverPid}`, "-d", "cwd", "-Fn"],
    {
      encoding: "utf8",
    },
  ).stdout;

  expect(cwd).toContain(`n${stateDir}\n`);

  const discovery = (await readReviewServerDiscovery(stateDir))!;
  expect(await readReviewServerHealth(discovery)).toMatchObject({ ok: true });

  const response = await fetch(`${url}/reviews-api`, {
    headers: { "x-review-token": discovery.token },
  });

  expect(response.status).toBe(200);
}, 60_000);

it("starts over a lock whose pid now belongs to an unrelated live process", async () => {
  await writeLock({ pid: process.pid, started: "a process before a reboot" });

  const { started } = await ensureBackgroundServer({
    stateDir,
    env,
    cli: sourceCli,
  });

  expect(started).toBe(true);
}, 60_000);

it("never starts beside a live lock holder", async () => {
  await writeLock({
    pid: process.pid,
    started: processStartIdentity(process.pid),
  });

  await expect(
    ensureBackgroundServer({ stateDir, env, cli: sourceCli, timeoutMs: 3_000 }),
  ).rejects.toThrow(/did not become ready/);
  expect(await readReviewServerDiscovery(stateDir)).toBeNull();
}, 30_000);

it("tries once more when the lock holder was shutting down", async () => {
  await writeLock({
    pid: process.pid,
    started: processStartIdentity(process.pid),
  });

  const starting = ensureBackgroundServer({ stateDir, env, cli: sourceCli });

  // The holder exits once our first child has lost the lock to it.
  let log = "";

  for (let i = 0; i < 200 && !log.includes("already owns"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    log = await readFile(backgroundServerLogPath(stateDir), "utf8").catch(
      () => "",
    );
  }

  expect(log).toContain("already owns");
  await rm(headlessServerLockPath(stateDir), { recursive: true });

  expect(await starting).toMatchObject({ started: true });
}, 60_000);

it("points tsx at the package's tsconfig only for a source entry", async () => {
  const seen = path.join(root, "seen");
  const entry = path.join(root, "entry");
  const script = `require("node:fs").appendFileSync(${JSON.stringify(seen)}, (process.env.TSX_TSCONFIG_PATH ?? "none") + "\\n");`;

  for (const extension of [".js", ".ts"]) {
    await writeFile(`${entry}${extension}`, script);
    await expect(
      ensureBackgroundServer({
        stateDir,
        env,
        cli: [process.execPath, `${entry}${extension}`],
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/did not become ready/);
  }

  expect((await readFile(seen, "utf8")).split("\n")).toEqual([
    "none",
    "none",
    path.join(packageRoot, "tsconfig.json"),
    path.join(packageRoot, "tsconfig.json"),
    "",
  ]);
}, 30_000);

it("reports a server command that cannot be spawned", async () => {
  await expect(
    ensureBackgroundServer({
      stateDir,
      env,
      cli: [path.join(root, "missing")],
    }),
  ).rejects.toThrow(/Could not start the Whiteboard server: .*ENOENT/);
});

async function cli(
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
  dir = stateDir,
  cwd?: string,
) {
  const child = spawn(
    sourceCli[0]!,
    [...sourceCli.slice(1), ...args, "--state-dir", dir],
    {
      cwd,
      // Only this process may run outside the package; the server it starts
      // gets the variable from spawnServer.
      env: {
        ...env,
        ...(cwd && {
          TSX_TSCONFIG_PATH: path.join(packageRoot, "tsconfig.json"),
        }),
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  // "close", not "exit": a detached server holding our pipes would hang here.
  const [code] = await once(child, "close");

  return { code, stdout, stderr };
}

async function readyLine(child: ChildProcess) {
  let output = "";

  for await (const chunk of child.stdout!) {
    output += chunk;

    if (output.includes("server.ready")) return;
  }

  throw new Error(`The server exited before it was ready: ${output}`);
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

async function fakeDiffr() {
  const binary = path.join(root, "override", "diffr");
  await mkdir(path.dirname(binary), { recursive: true });
  await writeFile(binary, "#!/bin/sh\n", { mode: 0o755 });

  return { REVIEW_DIFFR_BINARY: binary };
}

/** Writes an executable diffr where it is told, and leaves a mark that it ran. */
async function fakeFetcher() {
  const fetcher = path.join(root, "fetcher.mjs");
  await writeFile(
    fetcher,
    [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      "const into = process.argv[process.argv.indexOf('--into') + 1];",
      "mkdirSync(into, { recursive: true });",
      'writeFileSync(`${into}/diffr`, "#!/bin/sh\\n# fetched\\n", { mode: 0o755 });',
      `writeFileSync(\`\${into}/diffr.stamp.json\`, ${JSON.stringify(JSON.stringify({ version: PINNED }))});`,
      `writeFileSync(${JSON.stringify(`${fetcher}.ran`)}, into);`,
      "",
    ].join("\n"),
  );

  return fetcher;
}

async function writeLock(owner: { pid: number; started: string | null }) {
  const lock = headlessServerLockPath(stateDir);
  await mkdir(lock, { recursive: true });
  await writeFile(path.join(lock, "owner.json"), JSON.stringify(owner));
}

function discard() {
  return new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
}

const PINNED = (
  createRequire(import.meta.url)("@dev.fast/diffr/package.json") as {
    version: string;
  }
).version;

/** A diffr fetched earlier, stamped as the given version. */
async function fetchedCopy(version: string) {
  const binary = fetchedDiffrPath(stateDir);

  const target = new Map([
    ["darwin-arm64", "aarch64-apple-darwin"],
    ["darwin-x64", "x86_64-apple-darwin"],
    ["linux-x64", "x86_64-unknown-linux-gnu"],
    ["linux-arm64", "aarch64-unknown-linux-gnu"],
  ]).get(`${process.platform}-${process.arch}`);

  await mkdir(path.dirname(binary), { recursive: true });
  await writeFile(binary, "#!/bin/sh\n# old\n", { mode: 0o755 });
  await writeFile(
    path.join(path.dirname(binary), "diffr.stamp.json"),
    JSON.stringify({ version, target }),
  );

  return binary;
}

/** ensureDiffr with no diffr on PATH; the real fetcher unless one is given. */
function attachDiffr(packageRoot: string, fetcher?: string) {
  return ensureDiffr({
    stateDir,
    env: { ...env, PATH: path.dirname(process.execPath) },
    stderr: discard(),
    packageRoot,
    fetcher,
  });
}
