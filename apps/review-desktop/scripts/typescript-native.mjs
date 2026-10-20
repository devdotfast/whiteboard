#!/usr/bin/env node
// Installs the pinned TypeScript 7 language server into extensions/typescript-native.
// Pinned per target: npm only installs the host's platform package.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { downloadPinned } from "../../../packages/review/src/pinned-download.ts";

const CHECKOUT = path.join(import.meta.dirname, "..", "code-oss");

export const DEFAULT_EXTENSION_DIR = path.join(
  CHECKOUT,
  "extensions",
  "typescript-native",
);

const CACHE_DIR = path.join(CHECKOUT, ".build", "typescript-native");

const npmTarball = (name, version) =>
  `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;

// tsrs, the Rust port, where it publishes a binary; Go's tsgo elsewhere.
const tsrs = (platform, sha256) => ({
  url: npmTarball(`@tsrs/${platform}`, "0.18.0-ts7.1.0-dev.20260929"),
  sha256,
  lib: ".",
  exe: "tsrs",
});

const tsgo = (target, sha256) => ({
  url: npmTarball(`@typescript/typescript-${target}`, "7.0.2"),
  sha256,
  lib: "lib",
  exe: target.startsWith("win32-") ? "tsc.exe" : "tsc",
});

const SERVERS = {
  "darwin-arm64": tsrs(
    "darwin-arm64",
    "f096a65c201a8dab481417a724e1cc3dbfafb253788401b88d2a8b0040f10e28",
  ),
  "darwin-x64": tsgo(
    "darwin-x64",
    "eba158cb54050f723d5ff781438f33de5640054440bb4f2bd170cfe9bc2eb551",
  ),
  "linux-x64": tsrs(
    "linux-x64-gnu",
    "8ce88ce11ca20b3d4270e2d4c4fcf15743688fc46812779ef909e6202a1bd311",
  ),
  "linux-arm64": tsrs(
    "linux-arm64-gnu",
    "af448b186e3237fa95bbf5b4438007a4c8fdd302dc2131f4ec767eda4af4e2cb",
  ),
  "win32-x64": tsgo(
    "win32-x64",
    "61fc4e141d2bc687db580e71bbfa63b9c209f0310645d82ca1b457eb3a24fd19",
  ),
  "win32-arm64": tsgo(
    "win32-arm64",
    "0a73534e6ee50cdbb2a29ac48657ca0ad13cf0f424cf63808e4df7baeb87b8be",
  ),
};

export async function installTypeScriptNative({
  target = `${os.platform()}-${os.arch()}`,
  extensionDir = DEFAULT_EXTENSION_DIR,
  cacheDir = CACHE_DIR,
} = {}) {
  const server = SERVERS[target];

  if (!server) throw new Error(`no TypeScript 7 server for ${target}`);

  const lib = path.join(extensionDir, "lib");
  const stamp = path.join(lib, ".pin");

  if (
    fs.existsSync(stamp) &&
    fs.readFileSync(stamp, "utf8").trim() === server.sha256
  )
    return lib;

  const tarball = path.join(
    cacheDir,
    `${server.sha256}-${path.basename(server.url)}`,
  );

  await downloadPinned(server, tarball);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wb-typescript-native-"));

  try {
    execFileSync("tar", ["-xzf", tarball, "-C", scratch]);
    fs.rmSync(lib, { recursive: true, force: true });
    fs.cpSync(path.join(scratch, "package", server.lib), lib, {
      recursive: true,
    });

    for (const notice of ["LICENSE", "NOTICE.txt"])
      fs.copyFileSync(
        path.join(scratch, "package", notice),
        path.join(lib, notice),
      );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  for (const extra of ["package.json", "README.md"])
    fs.rmSync(path.join(lib, extra), { force: true });

  // The client starts lib/tsc.
  const exe = path.join(lib, target.startsWith("win32-") ? "tsc.exe" : "tsc");

  if (path.basename(exe) !== server.exe)
    fs.renameSync(path.join(lib, server.exe), exe);

  if (!fs.existsSync(exe)) throw new Error(`${server.url} has no ${server.exe}`);
  fs.chmodSync(exe, 0o755);
  fs.writeFileSync(stamp, `${server.sha256}\n`);

  return lib;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      "extension-dir": { type: "string" },
    },
  });

  await installTypeScriptNative({
    target: values.target,
    extensionDir: values["extension-dir"],
  });
}
