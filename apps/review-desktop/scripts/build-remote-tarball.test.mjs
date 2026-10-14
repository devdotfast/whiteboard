import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  REMOTE_TARBALL_MAX_BYTES,
  pinnedNode,
  remoteTarballName,
} from "./build-remote-tarball.mjs";

const script = fileURLToPath(
  new URL("./build-remote-tarball.mjs", import.meta.url),
);

const roots = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempDir() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wb-remote-tarball-"));
  roots.push(root);

  return root;
}

const NODE_VERSION = (
  await readFile(new URL("../code-oss/.nvmrc", import.meta.url), "utf8")
).trim();

const ARM64 = "b".repeat(64);

function fakeShasums(lines) {
  const fetchMock = async (url) => {
    assert.equal(url, `https://dist.test/v${NODE_VERSION}/SHASUMS256.txt`);

    return new Response(
      [
        `${"a".repeat(64)}  node-v${NODE_VERSION}-linux-x64.tar.xz`,
        `${"c".repeat(64)}  node-v${NODE_VERSION}-linux-arm64.tar.gz`,
        ...lines,
        "",
      ].join("\n"),
    );
  };

  return fetchMock;
}

test("pins the target's Node tarball from SHASUMS256.txt", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    fakeShasums([`${ARM64}  node-v${NODE_VERSION}-linux-arm64.tar.xz`]),
  );

  assert.deepEqual(
    await pinnedNode("linux-arm64", {
      cacheDir: await tempDir(),
      dist: "https://dist.test",
    }),
    {
      url: `https://dist.test/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz`,
      sha256: ARM64,
      version: NODE_VERSION,
    },
  );
});

test("refuses a SHASUMS256.txt without the target's tarball", async (t) => {
  t.mock.method(globalThis, "fetch", fakeShasums([]));

  await assert.rejects(
    pinnedNode("linux-arm64", {
      cacheDir: await tempDir(),
      dist: "https://dist.test",
    }),
    new RegExp(
      `no line for node-v${NODE_VERSION.replaceAll(".", "\\.")}-linux-arm64\\.tar\\.xz`,
    ),
  );
});

const hasDocker = (() => {
  try {
    execFileSync("docker", ["version"], { stdio: "ignore" });

    return true;
  } catch {
    return false;
  }
})();

test("builds a self-contained tarball for this machine's Linux arch", async () => {
  const target = process.arch === "arm64" ? "linux-arm64" : "linux-x64";
  const other = target === "linux-arm64" ? "linux-x64" : "linux-arm64";
  const out = await tempDir();

  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      script,
      "--version",
      "0.0.0-test",
      "--commit",
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      "--target",
      target,
      "--out",
      out,
    ],
    {
      env: { ...process.env, REVIEW_REMOTE_BUILD_CACHE: await tempDir() },
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  const result = JSON.parse(stdout);
  assert.equal(result.target, target);
  assert.equal(
    path.basename(result.file),
    remoteTarballName(result.version, target),
  );

  const tarball = await readFile(result.file);
  assert.ok(
    tarball.length < REMOTE_TARBALL_MAX_BYTES,
    `${tarball.length} bytes`,
  );
  assert.equal(
    createHash("sha256").update(tarball).digest("hex"),
    result.sha256,
  );
  assert.equal(
    await readFile(`${result.file}.sha256`, "utf8"),
    `${result.sha256}  ${path.basename(result.file)}\n`,
  );

  const entries = execFileSync("tar", ["-tJf", result.file], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .map((entry) => entry.replace(/^\.\//, ""));

  assert.deepEqual(
    new Set(entries.map((entry) => entry.split("/")[0])),
    new Set(["whiteboard-remote"]),
  );

  const listed = new Set(entries.map((entry) => entry.replace(/\/$/, "")));

  for (const file of [
    "whiteboard",
    "bin/node",
    "dist/cli.js",
    "package.json",
    "vscode-server/out/server-main.js",
    `node_modules/@dev.fast/diffr-${target}/diffr`,
    `node_modules/@parcel/watcher-${target}-glibc/watcher.node`,
    "node_modules/@img/sharp-wasm32",
    "node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
    "node_modules/@agentclientprotocol/codex-acp/dist/index.js",
    "node_modules/pi-acp/dist/index.js",
    "bin/NODE-LICENSE",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "onboarding.md",
    "instructions/authoring.md",
    "docs/remote-hosts.md",
  ])
    assert.ok(listed.has(`whiteboard-remote/${file}`), file);

  assert.ok(
    !entries.some(
      (entry) =>
        entry.includes(`/bin/${other}/`) ||
        entry.includes(`watcher-${other}-glibc`),
    ),
    `the tarball holds ${other} binaries`,
  );
  assert.ok(
    !entries.some((entry) => /\/@img\/sharp-(linux|libvips)-/.test(entry)),
    "the tarball holds native sharp",
  );

  if (!hasDocker) return;

  const extracted = await tempDir();
  execFileSync("tar", ["-xJf", result.file, "-C", extracted]);

  const inDebian = (workdir, ...command) =>
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--platform",
        target === "linux-x64" ? "linux/amd64" : "linux/arm64",
        "-v",
        `${extracted}:/t:ro`,
        "-w",
        workdir,
        "debian:12",
        ...command,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

  assert.equal(
    JSON.parse(
      inDebian(
        "/",
        "sh",
        "-c",
        "ln -s /t/whiteboard-remote/whiteboard /usr/local/bin/whiteboard && whiteboard version --json",
      ),
    ).version,
    result.version,
  );
  inDebian(
    "/t/whiteboard-remote",
    "bin/node",
    "--input-type=module",
    "-e",
    "await import('sharp'); await import('@parcel/watcher')",
  );
});
