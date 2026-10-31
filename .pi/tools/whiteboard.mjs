#!/usr/bin/env node
// Pin authoring clients to the Desktop owned by this checkout's harness.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
const repo = path.resolve(import.meta.dirname, "../..");
const root = path.join(repo, ".pi-subagents/desktop");
const state = JSON.parse(await readFile(path.join(root, "state.json"), "utf8"));
const targets = await fetch(`http://127.0.0.1:${state.port}/json/list`).then(
  (r) => r.json(),
);
if (!targets.some((t) => t.type === "page" && t.url.includes("workbench"))) {
  throw new Error(
    "The harness Desktop is not ready. Run desktop.mjs restart first.",
  );
}
const child = spawn(
  process.execPath,
  [path.join(repo, "packages/review/dist/cli.js"), ...process.argv.slice(2)],
  {
    cwd: repo,
    stdio: "inherit",
    env: { ...process.env, DEV_REVIEW_HOME: path.join(root, "review-home") },
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
