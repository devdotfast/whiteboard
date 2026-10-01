import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { missingToolchains } from "@review/remote-toolchains.js";
import { afterEach, beforeEach, expect, it } from "vitest";

let home: string;

let env: NodeJS.ProcessEnv;

// Names no machine has, so only this test's toolchain directory provides them.
const toolchains = {
  one: [["wbtest-one", "--version"]],
  two: [
    ["wbtest-build", "--version"],
    ["wbtest-compile", "--version"],
  ],
  slow: [["wbtest-slow", "--version"]],
};

async function tool(name: string, body: string) {
  const file = path.join(home, "toolchain", name);
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
}

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "wb-toolchains-"));
  await mkdir(path.join(home, "toolchain"));
  // Only the login shell puts the toolchain on PATH, as rustup or a .NET install does.
  await writeFile(
    path.join(home, ".profile"),
    `PATH="${home}/toolchain:$PATH"\nexport PATH\n`,
  );
  env = { HOME: home, SHELL: "/bin/bash", PATH: "/usr/bin:/bin" };
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

it("finds a toolchain that only the login shell puts on PATH", async () => {
  await tool("wbtest-one", "echo one 1.0");

  expect(await missingToolchains(["one"], env, { toolchains })).toEqual(
    new Map(),
  );
});

it("names each tool that the login shell cannot find, and skips an unknown group", async () => {
  await tool("wbtest-compile", "echo compile 1.0");

  expect(
    await missingToolchains(["one", "two", "unknown"], env, { toolchains }),
  ).toEqual(
    new Map([
      ["one", "wbtest-one was not found on the login shell's PATH"],
      ["two", "wbtest-build was not found on the login shell's PATH"],
    ]),
  );
});

it("knows no toolchain for a group named after an object property", async () => {
  // As `whiteboard remote attach --groups constructor` passes it.
  expect(await missingToolchains(["constructor", "toString"], env)).toEqual(
    new Map(),
  );
});

it("gives up on a tool that does not answer, and says so", async () => {
  await tool("wbtest-slow", "sleep 30");

  const started = Date.now();

  expect(
    await missingToolchains(["slow"], env, { toolchains, timeoutMs: 500 }),
  ).toEqual(
    new Map([["slow", "wbtest-slow --version did not answer within 0.5 s"]]),
  );
  expect(Date.now() - started).toBeLessThan(5_000);
});
