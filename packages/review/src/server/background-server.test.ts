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
import { Writable } from "node:stream";

import {
  REMOTE_ATTACH_BEGIN,
  REMOTE_ATTACH_END,
  remoteAttach,
} from "@review/remote-attach.js";
import {
  readReviewServerDiscovery,
  readReviewServerHealth,
  reviewServerDiscoveryPath,
} from "@review/server-discovery.js";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  isolatedEnv,
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
    diffr: expect.any(Boolean),
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

it("attaches without a network, with structural diff off", async () => {
  const packageRoot = path.join(root, "package");
  await mkdir(packageRoot);
  let stderr = "";

  const began = Date.now();

  const attach = await remoteAttach({
    stateDir,
    env: { ...env, PATH: path.dirname(process.execPath) },
    stderr: new Writable({
      write(chunk, _encoding, done) {
        stderr += chunk;
        done();
      },
    }),
    packageRoot,
    cli: sourceCli,
  });

  expect(attach).toMatchObject({ startedServer: true, diffr: false });
  expect(stderr).toContain("could not download");
  expect(Date.now() - began).toBeLessThan(15_000);
}, 60_000);

async function cli(args: string[]) {
  const child = spawn(
    sourceCli[0]!,
    [...sourceCli.slice(1), ...args, "--state-dir", stateDir],
    { env, stdio: ["ignore", "pipe", "pipe"] },
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
