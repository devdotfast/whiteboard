import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { packReviewCli } from "./pack-review-cli.mjs";

test("packs the Desktop version under the whiteboard name with both bins", async (t) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "whiteboard-pack-test-"));
  t.after(() => rm(output, { recursive: true, force: true }));

  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  const version = "1.2.4-preview.20260901.42";
  const tarball = await packReviewCli({ version, commit }, output);
  assert.equal(path.basename(tarball), `dev.fast-whiteboard-${version}.tgz`);
  execFileSync("tar", ["-xzf", tarball, "-C", output]);

  const read = async (file) =>
    JSON.parse(await readFile(path.join(output, "package", file), "utf8"));

  const pkg = await read("package.json");
  assert.equal(pkg.name, "@dev.fast/whiteboard");
  assert.equal(pkg.version, version);
  assert.equal(pkg.gitHead, commit);
  assert.deepEqual(pkg.bin, {
    review: "./dist/cli.js",
    whiteboard: "./dist/cli.js",
  });
  assert.equal((await read("dist/build-info.json")).version, version);
});
