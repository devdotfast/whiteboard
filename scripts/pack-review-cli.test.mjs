import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { REMOTE_BUILTIN_EXTENSIONS } from "../apps/review-desktop/scripts/build-remote-runtime.mjs";
import { remoteExtensionIds } from "../apps/review-desktop/scripts/curated-extensions.manifest.mjs";
import { packReviewCli } from "./pack-review-cli.mjs";

const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

const version = "1.2.4-preview.20260901.42";

async function write(file, content, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, { mode });
}

// A copy of the real manifest without its build scripts, a runtime as
// build-remote-runtime.mjs lays it out, and local npm tarballs in place of the
// pinned downloads, so the test never builds, downloads or writes to the checkout.
async function fixture(t, { runtimeCommit = commit } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "whiteboard-pack-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const { scripts, devDependencies, ...manifest } = JSON.parse(
    await readFile("packages/review/package.json", "utf8"),
  );

  const packageDirectory = path.join(root, "package-source");
  await write(
    path.join(packageDirectory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await write(path.join(packageDirectory, "dist/cli.js"), "");

  const runtime = path.join(root, "runtime");
  await write(
    path.join(runtime, "product.json"),
    JSON.stringify({ commit: runtimeCommit }),
  );
  await write(path.join(runtime, "out/server-main.js"), "");
  await write(
    path.join(runtime, "extensions/node_modules/typescript/lib/tsserver.js"),
    "",
  );

  for (const name of REMOTE_BUILTIN_EXTENSIONS)
    await write(path.join(runtime, "extensions", name, "package.json"), "{}");

  const tarballs = path.join(root, "tarballs");
  const downloads = [];

  for (const [name, files] of [
    ["rg", { "bin/linux-x64/rg": "x64", "bin/linux-arm64/rg": "arm64" }],
    ["watcher", { "package.json": "{}" }],
  ]) {
    for (const [file, content] of Object.entries(files))
      await write(path.join(tarballs, name, "package", file), content, 0o755);

    const tarball = path.join(tarballs, `${name}.tgz`);
    execFileSync("tar", ["-czf", tarball, "-C", path.join(tarballs, name), "package"]);
    downloads.push({
      url: `file://${tarball}`,
      sha256: createHash("sha256")
        .update(await readFile(tarball))
        .digest("hex"),
      copy:
        name === "rg"
          ? {
              "bin/linux-x64/rg": "out/vs/workbench/api/bin/linux-x64/rg",
              "bin/linux-arm64/rg": "out/vs/workbench/api/bin/linux-arm64/rg",
            }
          : { ".": "node_modules/@parcel/watcher" },
    });
  }

  // The cache already holds each download, as after an earlier pack.
  const cacheDir = path.join(root, "cache");
  await mkdir(cacheDir);

  for (const { url, sha256 } of downloads)
    await writeFile(
      path.join(cacheDir, `${sha256}-${path.basename(url)}`),
      await readFile(new URL(url)),
    );

  return {
    root,
    packageDirectory,
    downloads,
    cacheDir,
    vscodeServer: { runtime, cacheDir, downloads },
  };
}

test("packs the Desktop version under the whiteboard name with both bins and the VS Code server", async (t) => {
  const { root, packageDirectory, vscodeServer } = await fixture(t);
  const output = path.join(root, "output");

  const tarball = await packReviewCli({ version, commit }, output, {
    packageDirectory,
    stdio: "pipe",
    vscodeServer,
  });

  assert.equal(path.basename(tarball), `dev.fast-whiteboard-${version}.tgz`);
  execFileSync("tar", ["-xzf", tarball, "-C", output]);
  const pkgRoot = path.join(output, "package");

  const pkg = JSON.parse(
    await readFile(path.join(pkgRoot, "package.json"), "utf8"),
  );

  assert.equal(pkg.name, "@dev.fast/whiteboard");
  assert.equal(pkg.version, version);
  assert.equal(pkg.gitHead, commit);
  assert.deepEqual(pkg.bin, {
    review: "./dist/cli.js",
    whiteboard: "./dist/cli.js",
  });

  const server = path.join(pkgRoot, "vscode-server");

  for (const file of [
    "out/server-main.js",
    "extensions/node_modules/typescript/lib/tsserver.js",
    ...REMOTE_BUILTIN_EXTENSIONS.map((name) => `extensions/${name}/package.json`),
    "node_modules/@parcel/watcher/package.json",
  ])
    await stat(path.join(server, file));

  for (const arch of ["x64", "arm64"]) {
    const rg = await stat(
      path.join(server, `out/vs/workbench/api/bin/linux-${arch}/rg`),
    );

    assert.ok(rg.mode & 0o111, `rg for ${arch} is executable`);
  }

  const curated = JSON.parse(
    await readFile(path.join(server, "curated.json"), "utf8"),
  );

  assert.deepEqual(
    curated.extensions.map((extension) => extension.id),
    remoteExtensionIds,
  );

  for (const extension of curated.extensions)
    for (const target of ["linux-x64", "linux-arm64"]) {
      const { url, sha256, size } = extension.targets[target];

      assert.match(url, /^https:\/\/open-vsx\.org\//);
      assert.match(sha256, /^[0-9a-f]{64}$/);
      assert.ok(size > 0);
    }
});

test("refuses a runtime built from another commit", async (t) => {
  const { root, packageDirectory, vscodeServer } = await fixture(t, {
    runtimeCommit: "0".repeat(40),
  });

  await assert.rejects(
    packReviewCli({ version, commit }, path.join(root, "output"), {
      packageDirectory,
      stdio: "pipe",
      vscodeServer,
    }),
    /the remote runtime was built from 0{40}/,
  );
});

test("deletes a download that fails its checksum and packs nothing", async (t) => {
  const { root, packageDirectory, vscodeServer, cacheDir, downloads } =
    await fixture(t);

  const [rg] = downloads;
  const cachedFile = path.join(cacheDir, `${rg.sha256}-${path.basename(rg.url)}`);
  await writeFile(cachedFile, "tampered");

  await assert.rejects(
    packReviewCli({ version, commit }, path.join(root, "output"), {
      packageDirectory,
      stdio: "pipe",
      vscodeServer,
    }),
    /checksum mismatch/,
  );
  await assert.rejects(stat(cachedFile));
  await assert.rejects(stat(path.join(root, "output", `dev.fast-whiteboard-${version}.tgz`)));
});

test("refuses a tarball over the size limit", async (t) => {
  const { root, packageDirectory, vscodeServer } = await fixture(t);

  await assert.rejects(
    packReviewCli({ version, commit }, path.join(root, "output"), {
      packageDirectory,
      stdio: "pipe",
      vscodeServer,
      maxBytes: 1024,
    }),
    /over the 1024-byte limit/,
  );
});
