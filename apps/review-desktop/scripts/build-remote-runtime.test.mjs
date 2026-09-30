import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { REMOTE_RUNTIME_ENTRIES } from "./build-remote-runtime.mjs";

const script = fileURLToPath(
  new URL("./build-remote-runtime.mjs", import.meta.url),
);

test("builds a runtime that starts on this Node and reports the Desktop's commit", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wb-remote-runtime-"));
  const commit = "89abcdef0123456789abcdef0123456789abcdef";
  let server;
  t.after(() => {
    server?.kill();
    rmSync(root, { recursive: true, force: true });
  });

  const runtime = path.join(root, "remote-runtime");
  execFileSync(process.execPath, [script, "--out", runtime], {
    env: { ...process.env, BUILD_SOURCEVERSION: commit },
    stdio: "pipe",
  });

  for (const entry of REMOTE_RUNTIME_ENTRIES) {
    assert.ok(existsSync(path.join(runtime, "out", `${entry}.js`)), entry);
  }

  const tokenFile = path.join(root, "token");
  writeFileSync(tokenFile, "token", { mode: 0o600 });
  server = spawn(
    process.execPath,
    [
      path.join(runtime, "out/server-main.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--connection-token-file",
      tokenFile,
      "--server-data-dir",
      path.join(root, "data"),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  server.stderr.on("data", (chunk) => (output += chunk));

  const port = await new Promise((resolve, reject) => {
    server.once("exit", () => reject(new Error(output)));
    server.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /Extension host agent listening on (\d+)/.exec(output);

      if (match) resolve(Number(match[1]));
    });
  });

  const response = await fetch(`http://127.0.0.1:${port}/version`);
  assert.equal(await response.text(), commit);
});
