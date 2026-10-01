import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  type AgentTraceHookAgent,
  agentTraceHomeDirectory,
} from "@dev.fast/trace-core";
import { parse as parseToml } from "smol-toml";

import { CONNECT_COMMANDS } from "./connect-prompts";
import { isDirectory } from "./fs-utils";

/** The harnesses this machine can be found to have, and connected without a person: trace-core's. */
export const AGENT_CONNECT_TARGETS = [
  "claude",
  "codex",
  "opencode",
  "pi",
] as const satisfies readonly AgentTraceHookAgent[];

export type AgentConnectTarget = (typeof AGENT_CONNECT_TARGETS)[number];

export const AGENT_NAMES: Record<AgentConnectTarget, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
};

export interface DetectedAgent {
  id: AgentConnectTarget;
  name: string;
  present: true;
  /** The plugin or package the connect prompt installs is recorded. */
  connected: boolean;
  /** Its CLI is not on PATH, so only the agent itself can follow the prompt. */
  manual?: true;
}

export interface ConnectedAgent {
  id: AgentConnectTarget;
  name: string;
  connected: boolean;
  /** What the commands printed, last part only. */
  output: string;
}

const OUTPUT_LIMIT = 4000;

export const AGENT_CONNECT_TIMEOUT_MS = 120_000;

interface Scope {
  homeDir: string;
  env: NodeJS.ProcessEnv;
}

/** Reads only: every harness whose configuration directory exists, and whether it is connected. */
export async function detectAgents(scope: Scope): Promise<DetectedAgent[]> {
  const found: DetectedAgent[] = [];

  for (const id of AGENT_CONNECT_TARGETS) {
    if (
      !(await isDirectory(
        agentTraceHomeDirectory(id, scope.homeDir, scope.env),
      ))
    )
      continue;

    const manual = !(await onPath(CONNECT_COMMANDS[id][0].argv[0], scope.env));

    found.push({
      id,
      name: AGENT_NAMES[id],
      present: true,
      connected: await connected(id, scope),
      ...(manual && { manual: true as const }),
    });
  }

  return found;
}

/** Runs each harness's connect prompt commands; a harness counts as connected only once its own record says so. */
export async function connectAgents(
  input: Scope & {
    agents: readonly AgentConnectTarget[];
    timeoutMs?: number;
  },
): Promise<ConnectedAgent[]> {
  const results: ConnectedAgent[] = [];

  for (const id of input.agents) {
    const deadline = Date.now() + (input.timeoutMs ?? AGENT_CONNECT_TIMEOUT_MS);
    let output = "";

    for (const { argv } of CONNECT_COMMANDS[id]) {
      const left = deadline - Date.now();

      if (left <= 0) break;
      output += `$ ${argv.join(" ")}\n${await run(argv, input.env, left)}`;
    }

    results.push({
      id,
      name: AGENT_NAMES[id],
      connected: await connected(id, input),
      output: output.slice(-OUTPUT_LIMIT),
    });
  }

  return results;
}

async function connected(
  id: AgentConnectTarget,
  scope: Scope,
): Promise<boolean> {
  const home = agentTraceHomeDirectory(id, scope.homeDir, scope.env);

  try {
    switch (id) {
      case "claude": {
        const record = JSON.parse(
          await readFile(
            path.join(home, "plugins", "installed_plugins.json"),
            "utf8",
          ),
        );
        const installs = record?.plugins?.["whiteboard@devfast"];

        return Array.isArray(installs)
          ? installs.length > 0
          : Boolean(installs);
      }
      case "codex": {
        const config = parseToml(
          await readFile(path.join(home, "config.toml"), "utf8"),
        );
        const plugin = (
          config.plugins as Record<string, { enabled?: unknown }> | undefined
        )?.["whiteboard@devfast"];

        return plugin !== undefined && plugin.enabled !== false;
      }
      case "opencode": {
        for (const name of ["opencode.json", "opencode.jsonc", "config.json"]) {
          const text = await readFile(path.join(home, name), "utf8").catch(
            () => "",
          );

          if (
            /"plugin"\s*:\s*\[[^\]]*"@dev\.fast\/opencode-whiteboard(@[^"]*)?"/.test(
              text,
            )
          )
            return true;
        }

        return false;
      }
      case "pi": {
        const settings = JSON.parse(
          await readFile(path.join(home, "agent", "settings.json"), "utf8"),
        );

        return (
          Array.isArray(settings?.packages) ? settings.packages : []
        ).some((entry: unknown) => {
          const source =
            typeof entry === "string"
              ? entry
              : (entry as { source?: unknown } | null)?.source;

          return (
            typeof source === "string" &&
            /^npm:@dev\.fast\/pi-whiteboard(@.*)?$/.test(source)
          );
        });
      }
    }
  } catch {
    return false;
  }
}

async function onPath(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, command);

    try {
      await access(candidate, constants.X_OK);

      return candidate;
    } catch {
      // Not here.
    }
  }

  return undefined;
}

/** One command, without a shell, its output kept; never rejects. */
async function run(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<string> {
  const [command = "", ...args] = argv;
  const file = await onPath(command, env);

  if (!file) return `${command} was not found on PATH.\n`;

  return new Promise((resolve) => {
    let output = "";
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-OUTPUT_LIMIT);
    };
    const child = spawn(file, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const timer = setTimeout(() => {
      output += `\n${command} did not finish within ${Math.round(timeoutMs / 1000)} seconds.\n`;
      // The whole group: a harness CLI may have started its own children.
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve(`${output}${error.message}\n`);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(
        code === 0
          ? output
          : `${output}${output.endsWith("\n") || !output ? "" : "\n"}(exit ${code ?? "signal"})\n`,
      );
    });
  });
}
