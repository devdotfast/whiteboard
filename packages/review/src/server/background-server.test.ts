import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  REVIEW_REMOTE_ATTACH_BEGIN,
  REVIEW_REMOTE_ATTACH_END,
} from "@dev.fast/review-protocol";
import { processStartIdentity } from "@dev.fast/trace-core";
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

it("a paused server still owns its state directory: start and reset-id refuse, and stop ends it", async () => {
  const { discovery } = await ensureBackgroundServer({
    stateDir,
    env,
    cli: sourceCli,
  });

  const pid = discovery.serverPid;
  process.kill(pid, "SIGSTOP");

  try {
    expect(await readReviewServerHealth(discovery)).toBeNull();

    const start = spawnSync(
      sourceCli[0]!,
      [...sourceCli.slice(1), "server", "start", "--state-dir", stateDir],
      { env, encoding: "utf8", timeout: 30_000 },
    );

    expect(start.status).toBe(1);
    expect(start.stderr).toMatch(/^A Whiteboard server already owns [^\n]+\n$/);
    expect(await cli(["server", "reset-id"])).toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/^A Whiteboard server is using [^\n]+\n$/),
    });
    expect((await cli(["server", "reset-id", "--json"])).code).toBe(1);
    expect(alive(pid)).toBe(true);

    const stopped = await cli(["server", "stop", "--json"]);

    expect(JSON.parse(stopped.stdout)).toMatchObject({
      event: "server.stop",
      stopped: true,
      serverPid: pid,
    });
    expect(alive(pid)).toBe(false);
  } finally {
    try {
      process.kill(pid, "SIGCONT");
    } catch {}
  }
}, 90_000);

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
  const first = await cli(["remote", "attach", "--json"]);

  expect(first.code).toBe(0);
  const lines = first.stdout.split("\n");
  expect(lines).toEqual([
    REVIEW_REMOTE_ATTACH_BEGIN,
    expect.any(String),
    REVIEW_REMOTE_ATTACH_END,
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

  const second = await cli(["remote", "attach", "--json"]);
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
    {},
    path.join(root, "file", "state"),
  );

  expect(failed.code).toBe(1);
  const lines = failed.stdout.split("\n");
  expect(lines).toEqual([
    REVIEW_REMOTE_ATTACH_BEGIN,
    expect.any(String),
    REVIEW_REMOTE_ATTACH_END,
    "",
  ]);
  expect(JSON.parse(lines[1]!)).toMatchObject({
    event: "error",
    error: { message: expect.stringContaining("ENOTDIR") },
  });
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

async function writeLock(owner: { pid: number; started: string | null }) {
  const lock = headlessServerLockPath(stateDir);
  await mkdir(lock, { recursive: true });
  await writeFile(path.join(lock, "owner.json"), JSON.stringify(owner));
}
