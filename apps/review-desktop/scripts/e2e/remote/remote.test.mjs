import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { promisify } from "node:util";

import { sshConfigBlock } from "./ssh.mjs";

const exec = promisify(execFile);

const script = path.join(import.meta.dirname, "remote.mjs");

// Creating containers is opt-in, so a plain `pnpm test` or CI never touches Docker.
const withoutContainers =
  process.env.WB_TEST_CONTAINERS !== "1" &&
  "set WB_TEST_CONTAINERS=1 to create a Docker container";

const run = (args, env = {}) =>
  exec(process.execPath, [script, ...args], {
    env: { ...process.env, ...env },
  }).then(
    (result) => ({ code: 0, ...result }),
    (error) => ({
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    }),
  );

test("ssh_config for a host names its port, key and known-hosts file", () => {
  const block = sshConfigBlock("/tmp/wbt.x", {
    alias: "wb-test-a",
    hostName: "127.0.0.1",
    port: 49152,
    user: "dev",
  });

  assert.match(block, /^Host wb-test-a$/m);
  assert.match(block, /^ {2}Port 49152$/m);
  assert.match(block, /^ {2}IdentityFile \/tmp\/wbt\.x\/id_ed25519$/m);
  assert.match(block, /^ {2}UserKnownHostsFile \/tmp\/wbt\.x\/known_hosts$/m);
  assert.doesNotMatch(block, /ProxyJump/);
});

test("ssh_config for a --jump host goes through the other host", () => {
  const block = sshConfigBlock("/tmp/wbt.x", {
    alias: "wb-test-b",
    hostName: "wb-test-b",
    port: 22,
    user: "dev",
    jump: "wb-test-a",
  });

  assert.match(block, /^ {2}ProxyJump wb-test-a$/m);
  assert.match(block, /^ {2}Port 22$/m);
});

test("the fake OpenCode answers a prompt with a chunk and a tool call on f.ts", async (t) => {
  const child = spawn(process.execPath, [
    path.join(import.meta.dirname, "fake-agent/acp-agent.mjs"),
  ]);

  t.after(() => child.kill());

  const lines = createInterface({ input: child.stdout })[
    Symbol.asyncIterator
  ]();

  const next = async () => JSON.parse((await lines.next()).value);

  const send = (id, method, params) =>
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );

  send(1, "initialize", { protocolVersion: 1, clientCapabilities: {} });
  assert.equal((await next()).result.protocolVersion, 1);

  send(2, "session/new", { cwd: "/work/repo", mcpServers: [] });
  const { sessionId, modes } = (await next()).result;

  assert.equal(modes.currentModeId, "build");

  send(3, "session/set_mode", { sessionId, modeId: "build" });
  assert.deepEqual((await next()).result, {});

  send(4, "session/prompt", {
    sessionId,
    prompt: [
      { type: "text", text: "<whiteboard-context>x</whiteboard-context>" },
      { type: "text", text: "why?" },
    ],
  });

  const chunk = await next();
  const toolCall = await next();
  const answer = await next();

  assert.equal(chunk.params.update.sessionUpdate, "agent_message_chunk");
  assert.equal(chunk.params.update.content.text, "You asked: why?. See `f.ts`.");
  assert.equal(toolCall.params.update.sessionUpdate, "tool_call");
  assert.deepEqual(toolCall.params.update.locations, [
    { path: "/work/repo/f.ts", line: 1 },
  ]);
  assert.deepEqual(answer, {
    jsonrpc: "2.0",
    id: 4,
    result: { stopReason: "end_turn" },
  });
});

test("the fake OpenCode falls back to the managed node off PATH", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "wb-test-home-"));
  const bin = path.join(home, "bin");
  const managed = path.join(home, ".dev/whiteboard-remote/node/v24.0.0/bin");
  const shim = path.join(import.meta.dirname, "fake-agent/opencode");

  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(bin);

  const acp = (input) =>
    exec("/bin/sh", ["-c", `printf '%s\\n' '${input}' | "$0" acp`, shim], {
      env: { PATH: bin, HOME: home },
    }).then(
      ({ stdout }) => ({ code: 0, stdout }),
      ({ code, stderr }) => ({ code, stderr }),
    );

  const missing = await acp("");

  assert.equal(missing.code, 127);
  assert.match(missing.stderr, /no node on PATH/);

  await mkdir(managed, { recursive: true });
  await symlink(process.execPath, path.join(managed, "node"));

  const found = await acp(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  );

  assert.equal(JSON.parse(found.stdout).result.protocolVersion, 1);
});

test("down --all with an empty state.json exits 0", async () => {
  const id = `t${randomBytes(4).toString("hex")}`;
  const runDir = `/tmp/wbt.${id}`;

  await mkdir(runDir);
  await writeFile(path.join(runDir, "state.json"), "");

  const { code, stderr } = await run(["down", "--all"], { WB_TEST_RUN: id });

  assert.equal(code, 0, stderr);
  assert.equal(existsSync(runDir), false);
});

test("a host name or run id outside [a-z0-9-] is refused before any work", async () => {
  const id = `t${randomBytes(4).toString("hex")}`;

  const badName = await run(["up", "a,b"], { WB_TEST_RUN: id });

  assert.equal(badName.code, 1);
  assert.match(badName.stderr, /host name must match/);
  assert.equal(existsSync(`/tmp/wbt.${id}`), false);

  const badRun = await run(["down", "--all"], { WB_TEST_RUN: "../x" });

  assert.equal(badRun.code, 1);
  assert.match(badRun.stderr, /WB_TEST_RUN must match/);
});

test(
  "verify-clean fails and names a leftover wb-test container",
  { skip: withoutContainers },
  async (t) => {
    execFileSync("docker", ["create", "--name", "wb-test-x", "ubuntu:22.04"], {
      stdio: "ignore",
    });
    t.after(() =>
      execFileSync("docker", ["rm", "-f", "wb-test-x"], { stdio: "ignore" }),
    );

    const { code, stdout } = await run(["verify-clean"]);

    assert.notEqual(code, 0);
    assert.match(stdout, /container wb-test-x/);
  },
);
