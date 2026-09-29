import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { sshConfigBlock } from "./ssh.mjs";

const exec = promisify(execFile);

const script = path.join(import.meta.dirname, "remote.mjs");

const hasDocker = (() => {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });

    return true;
  } catch {
    return false;
  }
})();

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
  { skip: !hasDocker && "needs Docker" },
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
