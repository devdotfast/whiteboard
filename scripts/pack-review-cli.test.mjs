import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { packReviewCli } from "./pack-review-cli.mjs";

// Packs a copy of the real manifest without its build scripts, so the test
// never builds or writes to the checkout.
test("packs the Desktop version under the whiteboard name with both bins", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "whiteboard-pack-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const { scripts, devDependencies, ...manifest } = JSON.parse(
    await readFile("packages/review/package.json", "utf8"),
  );

  const packageDirectory = path.join(root, "package-source");
  await mkdir(path.join(packageDirectory, "dist"), { recursive: true });
  await writeFile(
    path.join(packageDirectory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(path.join(packageDirectory, "dist/cli.js"), "");

  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  const version = "1.2.4-preview.20260901.42";
  const output = path.join(root, "output");

  const tarball = await packReviewCli({ version, commit }, output, {
    packageDirectory,
    stdio: "pipe",
  });

  assert.equal(path.basename(tarball), `dev.fast-whiteboard-${version}.tgz`);
  execFileSync("tar", ["-xzf", tarball, "-C", output]);

  const pkg = JSON.parse(
    await readFile(path.join(output, "package/package.json"), "utf8"),
  );

  assert.equal(pkg.name, "@dev.fast/whiteboard");
  assert.equal(pkg.version, version);
  assert.equal(pkg.gitHead, commit);
  assert.deepEqual(pkg.bin, {
    review: "./dist/cli.js",
    whiteboard: "./dist/cli.js",
  });
});
