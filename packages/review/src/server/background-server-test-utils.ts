import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

export const sourceCli = [
  process.execPath,
  "--import",
  pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
  path.join(packageRoot, "src", "cli.ts"),
];

export function isolatedEnv(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env))
    if (
      !/^(DEV_REVIEW_|DEV_FAST_REVIEW_|REVIEW_DIFFR_|TRACE_|TSX_|XDG_CONFIG_HOME$|CODEX_HOME$)/.test(
        key,
      ) &&
      !/^(https?|no|all)_proxy$/i.test(key)
    )
      env[key] = value;

  const home = path.join(root, "home");
  roots.add(root);

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

const roots = new Set<string>();

process.on("exit", () => {
  for (const root of roots)
    spawnSync("pkill", ["-KILL", "-f", path.basename(root)]);
});

export async function stopServersUnder(root: string) {
  const pattern = path.basename(root);

  for (const signal of ["TERM", "TERM", "KILL"]) {
    checked(spawnSync("pkill", [`-${signal}`, "-f", pattern]));

    for (let i = 0; i < 30 && running(pattern); i++) await delay(100);

    if (!running(pattern)) {
      roots.delete(root);

      return;
    }
  }

  throw new Error(`Processes under ${root} survived SIGKILL`);
}

function running(pattern: string) {
  return checked(spawnSync("pgrep", ["-f", pattern])).status === 0;
}

function checked(result: ReturnType<typeof spawnSync>) {
  if (result.error) throw result.error;

  return result;
}
