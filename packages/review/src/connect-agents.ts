import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  REVIEW_CLI_INSTALL_TARGET_LABELS,
  REVIEW_REMOTE_AGENT_IDS,
  type ReviewRemoteAgentId,
} from "@dev.fast/review-protocol";
import {
  type AgentTraceHookAgent,
  agentTraceHomeDirectory,
} from "@dev.fast/trace-core";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";

import { CONNECT_COMMANDS, type ConnectCommand } from "./connect-prompts";
import { isDirectory } from "./fs-utils";

export const AGENT_CONNECT_TARGETS: readonly (ReviewRemoteAgentId &
  AgentTraceHookAgent)[] = REVIEW_REMOTE_AGENT_IDS;

export type AgentConnectTarget = ReviewRemoteAgentId;

export interface DetectedAgent {
  id: AgentConnectTarget;
  name: string;
  connected: boolean;
  manual?: true;
}

export interface ConnectedAgent {
  id: AgentConnectTarget;
  name: string;
  connected: boolean;
  output: string;
}

const OUTPUT_LIMIT = 4000;

export const AGENT_CONNECT_TIMEOUT_MS = 120_000;

interface Scope {
  homeDir: string;
  env: NodeJS.ProcessEnv;
}

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
      name: REVIEW_CLI_INSTALL_TARGET_LABELS[id],
      connected: await connected(id, scope),
      ...(manual && { manual: true as const }),
    });
  }

  return found;
}

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

    const commands: readonly ConnectCommand[] = CONNECT_COMMANDS[id];

    for (const { argv, ifAny } of commands) {
      const left = deadline - Date.now();

      if (left <= 0) break;
      const step = await run(argv, input.env, left);

      output += `$ ${argv.join(" ")}\n${step.output}`;

      if (!step.ok && !ifAny) {
        output += `Stopped: ${argv.join(" ")} failed.\n`;
        break;
      }
    }

    results.push({
      id,
      name: REVIEW_CLI_INSTALL_TARGET_LABELS[id],
      connected: await connected(id, input),
      output: output.slice(-OUTPUT_LIMIT),
    });
  }

  return results;
}

const WHITEBOARD_PLUGIN = "whiteboard@devfast";

const ClaudePluginsSchema = z.object({
  plugins: z.record(z.string(), z.unknown()),
});

const CodexConfigSchema = z.object({
  plugins: z.record(z.string(), z.unknown()).optional(),
});

const CodexPluginSchema = z.object({ enabled: z.boolean().optional() });

const PiSettingsSchema = z.object({
  packages: z.array(
    z.union([
      z.string(),
      z.object({ source: z.string() }).transform((entry) => entry.source),
    ]),
  ),
});

const PI_PACKAGE = /^npm:@dev\.fast\/pi-whiteboard(@.*)?$/;

const OPENCODE_PLUGIN =
  /"plugin"\s*:\s*\[[^\]]*"@dev\.fast\/opencode-whiteboard(@[^"]*)?"/;

const OpenCodeConfigSchema = z.object({
  mcp: z.object({
    whiteboard: z.unknown().optional(),
    servers: z.object({ whiteboard: z.unknown().optional() }).optional(),
  }),
});

/** OpenCode's config is JSONC: drop comments and trailing commas, keep strings. */
const JSONC_EXTRAS =
  /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\/|,(?=\s*[}\]])/g;

function openCodeConnected(text: string): boolean {
  if (OPENCODE_PLUGIN.test(text)) return true;

  try {
    const { mcp } = OpenCodeConfigSchema.parse(
      JSON.parse(text.replace(JSONC_EXTRAS, "$1")),
    );

    return (
      mcp.whiteboard !== undefined || mcp.servers?.whiteboard !== undefined
    );
  } catch {
    return false;
  }
}

async function connected(
  id: AgentConnectTarget,
  scope: Scope,
): Promise<boolean> {
  const home = agentTraceHomeDirectory(id, scope.homeDir, scope.env);

  const read = (...parts: string[]) =>
    readFile(path.join(home, ...parts), "utf8");

  try {
    switch (id) {
      case "claude": {
        const installs = ClaudePluginsSchema.parse(
          JSON.parse(await read("plugins", "installed_plugins.json")),
        ).plugins[WHITEBOARD_PLUGIN];

        return Array.isArray(installs)
          ? installs.length > 0
          : Boolean(installs);
      }

      case "codex": {
        const entry = CodexConfigSchema.parse(
          parseToml(await read("config.toml")),
        ).plugins?.[WHITEBOARD_PLUGIN];

        return (
          entry !== undefined &&
          CodexPluginSchema.parse(entry).enabled !== false
        );
      }

      case "opencode": {
        for (const name of ["opencode.json", "opencode.jsonc", "config.json"]) {
          if (openCodeConnected(await read(name).catch(() => ""))) return true;
        }

        return false;
      }

      case "pi":
        return PiSettingsSchema.parse(
          JSON.parse(await read("agent", "settings.json")),
        ).packages.some((entry) => PI_PACKAGE.test(entry));
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
    } catch {}
  }

  return undefined;
}

async function run(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ output: string; ok: boolean }> {
  const [command = "", ...args] = argv;
  const file = await onPath(command, env);

  if (!file)
    return { output: `${command} was not found on PATH.\n`, ok: false };

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
      resolve({ output: `${output}${error.message}\n`, ok: false });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(
        code === 0
          ? { output, ok: true }
          : {
              output: `${output}${output.endsWith("\n") || !output ? "" : "\n"}(exit ${code ?? "signal"})\n`,
              ok: false,
            },
      );
    });
  });
}
