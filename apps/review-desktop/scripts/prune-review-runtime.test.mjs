import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { pruneReviewRuntime } from "./prune-review-runtime.mjs";

test("desktop pruning retains runnable variants, licenses, maps, native and runtime fixtures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "whiteboard-prune-"));

  const contents = "fixture";

  const remove = [
    "src/cli.ts",
    "node_modules/zod/src/index.ts",
    "node_modules/pino/test/transport.js",
    "node_modules/@modelcontextprotocol/sdk/dist/cjs/server/index.js",
    "node_modules/hono/dist/cjs/index.js",
    "node_modules/zod/index.d.cts",
  ];

  const retain = [
    "dist/cli.js",
    "src/cli.ts.map",
    "node_modules/zod/LICENSE",
    "node_modules/hono/dist/index.js",
    "node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js",
    "node_modules/hono/dist/cjs/index.js.map",
    "node_modules/sharp/lib/index.d.ts",
    "node_modules/@img/sharp-wasm32/lib/sharp.node",
    "node_modules/unknown/fixtures/schema.json",
    "tutorial/runtime-manifest.json",
    "node_modules/thread-stream/lib/worker.js",
  ];

  try {
    for (const file of [...remove, ...retain]) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), contents);
    }

    const counts = await pruneReviewRuntime(root);
    assert.equal(
      Object.values(counts).reduce((a, b) => a + b, 0),
      remove.length * Buffer.byteLength(contents),
    );

    for (const file of remove)
      await assert.rejects(access(path.join(root, file)));

    for (const file of retain) await access(path.join(root, file));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
