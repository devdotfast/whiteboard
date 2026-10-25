import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { REMOTE_BUILTIN_EXTENSIONS } from "./build-remote-runtime.mjs";
import { remoteExtensionIds } from "./curated-extensions.manifest.mjs";
import { stageVscodeServer } from "./stage-vscode-server.mjs";

const commit = "a".repeat(40);

async function write(file, content, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, { mode });
}

async function fixture(t, { runtimeCommit = commit } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "whiteboard-stage-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

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

  const server = createServer((request, response) =>
    readFile(path.join(tarballs, path.basename(request.url))).then(
      (data) => response.end(data),
      () => response.writeHead(404).end(),
    ),
  );

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  for (const [name, files] of [
    ["rg", { "bin/linux-x64/rg": "x64", "bin/linux-arm64/rg": "arm64" }],
    ["watcher", { "package.json": "{}" }],
  ]) {
    for (const [file, content] of Object.entries(files))
      await write(path.join(tarballs, name, "package", file), content, 0o755);

    const tarball = path.join(tarballs, `${name}.tgz`);
    execFileSync("tar", ["-czf", tarball, "-C", path.join(tarballs, name), "package"]);
    downloads.push({
      url: `http://127.0.0.1:${server.address().port}/${name}.tgz`,
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

  const cacheDir = path.join(root, "cache");
  await mkdir(cacheDir);

  for (const { url, sha256 } of downloads)
    await writeFile(
      path.join(cacheDir, `${sha256}-${path.basename(url)}`),
      await readFile(path.join(tarballs, path.basename(url))),
    );

  return {
    output: path.join(root, "output"),
    downloads,
    cacheDir,
    options: { commit, runtime, cacheDir, downloads },
  };
}

test("stages the VS Code server with ripgrep, the watcher and the curated extensions", async (t) => {
  const { output, options } = await fixture(t);

  const server = await stageVscodeServer(output, options);

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

  const go = curated.extensions.find((extension) => extension.id === "golang.go");
  assert.equal(go.tier, "optional");
  assert.equal(go.group, "go");

  for (const extension of curated.extensions)
    for (const target of ["linux-x64", "linux-arm64"]) {
      const { url, sha256 } = extension.targets[target];

      assert.match(url, /^https:\/\/open-vsx\.org\//);
      assert.match(sha256, /^[0-9a-f]{64}$/);
    }
});

test("refuses a runtime built from another commit", async (t) => {
  const { output, options } = await fixture(t, {
    runtimeCommit: "0".repeat(40),
  });

  await assert.rejects(
    stageVscodeServer(output, options),
    /the remote runtime was built from 0{40}/,
  );
});

test("deletes a download that fails its checksum", async (t) => {
  const { output, options, cacheDir, downloads } = await fixture(t);

  const [rg] = downloads;
  rg.sha256 = "0".repeat(64);
  const cachedFile = path.join(cacheDir, `${rg.sha256}-${path.basename(rg.url)}`);

  await assert.rejects(stageVscodeServer(output, options), /Checksum mismatch/);
  await assert.rejects(stat(cachedFile));
});
