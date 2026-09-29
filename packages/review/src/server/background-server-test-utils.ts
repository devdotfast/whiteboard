import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

/** The CLI from source; `--import` takes a URL so any cwd resolves it. */
export const sourceCli = [
  process.execPath,
  "--import",
  pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
  path.join(packageRoot, "src", "cli.ts"),
];

/**
 * An environment with its own home, no Desktop selection, no telemetry and
 * HTTPS through a port that refuses, so nothing reaches the real ~/.dev, a
 * running Desktop, or the network.
 */
export function isolatedEnv(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env))
    if (
      !/^(DEV_REVIEW_|DEV_FAST_REVIEW_|REVIEW_DIFFR_|TRACE_HOME_DIR$)/.test(
        key,
      ) &&
      !/^(https?|no|all)_proxy$/i.test(key)
    )
      env[key] = value;

  const home = path.join(root, "home");

  return {
    ...env,
    HOME: home,
    TRACE_HOME_DIR: home,
    DEV_REVIEW_HOME: path.join(home, ".dev"),
    DEV_FAST_REVIEW_TELEMETRY_DISABLED: "1",
    DEV_FAST_REVIEW_CLI_NO_DELEGATE: "1",
    NODE_USE_ENV_PROXY: "1",
    HTTPS_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "127.0.0.1,localhost",
  };
}

/** Detached servers outlive their CLI; each has `root` in its arguments. */
export async function stopServersUnder(root: string) {
  const pattern = path.basename(root);

  for (const signal of ["TERM", "TERM", "KILL"]) {
    spawnSync("pkill", [`-${signal}`, "-f", pattern]);

    for (let i = 0; i < 30 && running(pattern); i++) await delay(100);

    if (!running(pattern)) return;
  }

  throw new Error(`Processes under ${root} survived SIGKILL`);
}

function running(pattern: string) {
  return spawnSync("pgrep", ["-f", pattern]).status === 0;
}
