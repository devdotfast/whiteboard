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

const tsgo = (target, sha256) => ({
  url: npmTarball(`@typescript/typescript-${target}`, "7.0.2"),
  sha256,
});

const SERVERS = {
  "darwin-arm64": tsgo(
    "darwin-arm64",
    "902e2fe1cf0799198ef902c6b8c310a450fef629a6baba41d45641ef75c04ebd",
  ),
  "darwin-x64": tsgo(
    "darwin-x64",
    "eba158cb54050f723d5ff781438f33de5640054440bb4f2bd170cfe9bc2eb551",
  ),
  "linux-x64": tsgo(
    "linux-x64",
    "7ecad6f67377e831856367ab062ef394f21506a611405bf8ac0ff039348637d3",
  ),
  "linux-arm64": tsgo(
    "linux-arm64",
    "c83d931ac9dd7549cde6e71246aa9d6a9812843023df3e277fe3b5dcf41dd0ea",
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

const exeName = (target) => (target.startsWith("win32-") ? "tsc.exe" : "tsc");

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

  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), "wb-typescript-native-"),
  );

  try {
    execFileSync("tar", ["-xzf", tarball, "-C", scratch]);
    fs.rmSync(lib, { recursive: true, force: true });
    fs.cpSync(path.join(scratch, "package", "lib"), lib, { recursive: true });

    for (const notice of ["LICENSE", "NOTICE.txt"])
      fs.copyFileSync(
        path.join(scratch, "package", notice),
        path.join(lib, notice),
      );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  const exe = path.join(lib, exeName(target));

  if (!fs.existsSync(exe))
    throw new Error(`${server.url} has no lib/${exeName(target)}`);
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
