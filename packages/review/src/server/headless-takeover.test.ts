import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  headlessServerLockPath,
  reviewServerDiscoveryPath,
} from "@review/server-discovery.js";
import { afterEach, beforeEach, expect, it } from "vitest";

import { takeOverServerHome } from "./headless-host.js";

let stateDir: string;

beforeEach(async () => {
  stateDir = await realpath(await mkdtemp(path.join(tmpdir(), "wb-take-")));
});

afterEach(() => rm(stateDir, { recursive: true, force: true }));

it("never signals a live process that reuses a stale server's pid", async () => {
  const bystander = spawn(process.execPath, [
    "-e",
    "setTimeout(() => {}, 60000)",
  ]);

  try {
    const lock = headlessServerLockPath(stateDir);
    await mkdir(lock, { recursive: true });
    await writeFile(
      path.join(lock, "owner.json"),
      // Windows records no start time.
      JSON.stringify({ pid: bystander.pid, started: null }),
    );

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

    await takeOverServerHome(stateDir, async () => {}, {
      timeoutMs: 300,
    }).catch(() => {});

    expect(() => process.kill(bystander.pid!, 0)).not.toThrow();
  } finally {
    bystander.kill("SIGKILL");
  }
}, 30_000);
