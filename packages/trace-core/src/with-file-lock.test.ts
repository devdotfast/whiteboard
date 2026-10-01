import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { processStartIdentity, withFileLock } from "./with-file-lock";

const FAST = {
  retryMs: 10,
  staleMs: 60_000,
  timeoutMs: 250,
  unownedGraceMs: 50,
};

describe("withFileLock", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0)
        .map((target) => rm(target, { recursive: true, force: true })),
    );
  });

  async function createLockPath(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "with-file-lock-"));
    cleanupPaths.push(root);

    return path.join(root, "resource.lock");
  }

  it("acquires, runs the operation, and releases", async () => {
    const lockPath = await createLockPath();

    const outcome = await withFileLock(lockPath, FAST, async () => {
      expect(existsSync(lockPath)).toBe(true);

      return "ran";
    });

    expect(outcome).toEqual({ acquired: true, result: "ran" });
    expect(existsSync(lockPath)).toBe(false);
  });

  it("steals a lock whose owning process is dead", async () => {
    const lockPath = await createLockPath();
    await mkdir(lockPath, { recursive: true });
    await writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: 2_147_483_647 }),
      "utf8",
    );

    const outcome = await withFileLock(lockPath, FAST, async () => "ran");

    expect(outcome).toEqual({ acquired: true, result: "ran" });
  });

  it("never steals from a live owner inside the stale window", async () => {
    const lockPath = await createLockPath();
    await mkdir(lockPath, { recursive: true });
    await writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: process.pid }),
      "utf8",
    );
    // Older than the old age-based theft would tolerate, but the owner is
    // alive and the heartbeat window has not passed: the waiter must time
    // out instead of stealing.
    const aged = new Date(Date.now() - 10_000);
    await utimes(lockPath, aged, aged);

    const outcome = await withFileLock(lockPath, FAST, async () => "ran");

    expect(outcome).toEqual({ acquired: false });
    expect(existsSync(lockPath)).toBe(true);
  });

  it("reclaims a live owner only after the heartbeat goes silent past staleMs", async () => {
    const lockPath = await createLockPath();
    await mkdir(lockPath, { recursive: true });
    await writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: process.pid }),
      "utf8",
    );
    const silent = new Date(Date.now() - 5_000);
    await utimes(lockPath, silent, silent);

    const outcome = await withFileLock(
      lockPath,
      { ...FAST, staleMs: 1_000 },
      async () => "ran",
    );

    expect(outcome).toEqual({ acquired: true, result: "ran" });
  });

  it("steals from a live process that only reuses the recorded owner's pid", async () => {
    const lockPath = await createLockPath();
    await mkdir(lockPath, { recursive: true });
    await writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: process.pid, started: "an earlier process" }),
      "utf8",
    );

    const outcome = await withFileLock(lockPath, FAST, async () => "ran");

    expect(outcome).toEqual({ acquired: true, result: "ran" });
  });

  it("never steals from the recorded owner itself, however silent", async () => {
    const lockPath = await createLockPath();

    const held = await withFileLock(
      lockPath,
      { ...FAST, staleMs: Infinity, identifyOwner: true },
      async () => {
        expect(processStartIdentity(process.pid)).toEqual(expect.any(String));
        const silent = new Date(Date.now() - 3_600_000);
        await utimes(lockPath, silent, silent);

        return withFileLock(
          lockPath,
          { ...FAST, staleMs: Infinity },
          async () => "stole",
        );
      },
    );

    expect(held).toEqual({ acquired: true, result: { acquired: false } });
  });

  describe.skipIf(
    process.platform === "linux" ||
      spawnSync("ps", ["-p", String(process.pid)]).error !== undefined,
  )("where ps supplies the start", () => {
    const zone = process.env.TZ;

    afterEach(() => {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    });

    it("identifies a process the same in every time zone", async () => {
      process.env.TZ = "Asia/Tokyo";
      const tokyo = processStartIdentity(process.pid);
      process.env.TZ = "America/Los_Angeles";

      expect(processStartIdentity(process.pid)).toBe(tokyo);

      const lockPath = await createLockPath();
      await mkdir(lockPath, { recursive: true });
      await writeFile(
        path.join(lockPath, "owner.json"),
        JSON.stringify({ pid: process.pid, started: tokyo }),
        "utf8",
      );

      expect(
        await withFileLock(
          lockPath,
          { ...FAST, staleMs: Infinity },
          async () => "stole",
        ),
      ).toEqual({ acquired: false });
    });
  });

  it("reclaims a lock whose owner file never appeared after the grace", async () => {
    const lockPath = await createLockPath();
    await mkdir(lockPath, { recursive: true });
    const aged = new Date(Date.now() - 1_000);
    await utimes(lockPath, aged, aged);

    const outcome = await withFileLock(lockPath, FAST, async () => "ran");

    expect(outcome).toEqual({ acquired: true, result: "ran" });
  });
});
