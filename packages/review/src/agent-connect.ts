import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { type JsonObject, type JsonValue, isJsonObject } from "@dev.fast/json";
import type {
  ReviewConnectAgent,
  ReviewConnectResult,
} from "@dev.fast/review-protocol";

import { findExecutable } from "./ask/agents.js";
import { type McpLaunch, reviewMcpLaunch } from "./connect-prompts.js";
import { cursorInstallDeeplink } from "./cursor-deeplink.js";
import { ALL_INSTALL_TARGETS, type InstallTarget } from "./install.js";

const MARKETPLACE = "devdotfast/whiteboard";

const PLUGIN = "whiteboard@devfast";

const STEP_TIMEOUT_MS = 120_000;

interface Harness {
  name: string;
  /** The CLI's names on PATH, most specific first. */
  commands: string[];
  /** Where its installer puts the CLI when that is not on PATH, under home. */
  installDirs?: string[];
  /** A directory under home whose presence means the harness is installed,
   * for one that is an app rather than a CLI. */
  homeDir?: string;
  /** macOS app bundles that mean the harness is installed. */
  apps?: string[];
}

const HARNESSES: Record<InstallTarget, Harness> = {
  claude: {
    name: "Claude Code",
    commands: ["claude"],
    installDirs: [".claude/local", ".local/bin"],
  },
  codex: { name: "Codex", commands: ["codex"] },
  cursor: {
    name: "Cursor",
    commands: ["cursor"],
    homeDir: ".cursor",
    apps: ["/Applications/Cursor.app"],
  },
  opencode: {
    name: "OpenCode",
    commands: ["opencode"],
    installDirs: [".opencode/bin"],
  },
  pi: { name: "Pi", commands: ["pi"] },
  omp: { name: "oh-my-pi", commands: ["omp"], homeDir: ".omp" },
  copilot: { name: "Copilot CLI", commands: ["copilot"] },
};

export interface ConnectEnvironment {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Whether ~/.local/bin/whiteboard exists for the MCP launch to run. */
  hasShim: boolean;
  run?: ConnectRun;
}

/** Runs one subprocess; never rejects, so a step's failure is its output. */
export type ConnectRun = (
  file: string,
  args: string[],
) => Promise<{ code: number; output: string }>;

const runProcess: ConnectRun = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: STEP_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        // A plugin install must never wait on a prompt nobody can see.
        env: { ...process.env, CI: "1", GIT_TERMINAL_PROMPT: "0" },
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`.trim();

        // Only success matters to a step, not which failure it was.
        resolve(
          error
            ? { code: 1, output: output || error.message }
            : { code: 0, output },
        );
      },
    );
  });

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);

    return true;
  } catch {
    return false;
  }
}

async function findHarness(
  harness: Harness,
  homeDir: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const installed = (harness.installDirs ?? []).map((directory) =>
    path.join(homeDir, directory),
  );

  for (const command of harness.commands) {
    const found =
      (await findExecutable(command, env)) ??
      (await findExecutable(command, { PATH: installed.join(path.delimiter) }));

    if (found) return found;
  }

  return undefined;
}

async function harnessFound(
  harness: Harness,
  homeDir: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<boolean> {
  if (await findHarness(harness, homeDir, env)) return true;

  if (harness.homeDir && (await exists(path.join(homeDir, harness.homeDir))))
    return true;

  if (platform !== "darwin") return false;

  for (const app of harness.apps ?? []) if (await exists(app)) return true;

  return false;
}

async function readJson(file: string): Promise<JsonValue | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Follows `keys` down nested JSON objects. */
function lookup(value: JsonValue | undefined, ...keys: string[]) {
  let current = value;

  for (const key of keys) {
    if (!isJsonObject(current)) return undefined;
    current = current[key];
  }

  return current;
}

/** Whether a `[plugins."…"]` table names the plugin, and does not turn it
 * off. */
export function codexHasPlugin(toml: string): boolean {
  const lines = toml.split("\n");

  const start = lines.findIndex(
    (line) => line.trim() === `[plugins."${PLUGIN}"]`,
  );

  if (start === -1) return false;

  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();

    if (trimmed.startsWith("[")) break;

    if (/^enabled\s*=\s*false\b/.test(trimmed)) return false;
  }

  return true;
}

/** Whether a harness already has Whiteboard, as its own config records it:
 * the plugin it installed, or the MCP server added to it. Copilot keeps no
 * record Whiteboard reads, so it always installs again, which is harmless. */
async function harnessConnected(
  target: InstallTarget,
  homeDir: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<boolean> {
  const claudeDir = env.CLAUDE_CONFIG_DIR ?? path.join(homeDir, ".claude");

  const hasServer = async (file: string, ...keys: string[]) =>
    lookup(await readJson(file), ...keys, "whiteboard") !== undefined;

  switch (target) {
    case "claude": {
      if (platform === "win32")
        return hasServer(path.join(homeDir, ".claude.json"), "mcpServers");

      const [installed, settings] = await Promise.all([
        readJson(path.join(claudeDir, "plugins", "installed_plugins.json")),
        readJson(path.join(claudeDir, "settings.json")),
      ]);

      const installs = lookup(installed, "plugins", PLUGIN);

      return (
        Array.isArray(installs) &&
        installs.length > 0 &&
        lookup(settings, "enabledPlugins", PLUGIN) !== false
      );
    }

    case "codex":
      try {
        return codexHasPlugin(
          await readFile(
            path.join(
              env.CODEX_HOME ?? path.join(homeDir, ".codex"),
              "config.toml",
            ),
            "utf8",
          ),
        );
      } catch {
        return false;
      }

    case "opencode": {
      const config = await readJson(
        path.join(
          env.XDG_CONFIG_HOME ?? path.join(homeDir, ".config"),
          "opencode",
          "opencode.json",
        ),
      );

      // Its `mcp add` has written both shapes.
      return (
        lookup(config, "mcp", "whiteboard") !== undefined ||
        lookup(config, "mcp", "servers", "whiteboard") !== undefined
      );
    }

    case "pi":
      return hasServer(
        path.join(homeDir, ".pi", "agent", "mcp.json"),
        "mcpServers",
      );
    case "omp":
      return hasServer(
        path.join(homeDir, ".omp", "agent", "mcp.json"),
        "mcpServers",
      );
    case "cursor":
      return cursorHasServer(homeDir);
    case "copilot":
      return false;
  }
}

/** Every harness Whiteboard connects to, whether this machine has it, and
 * whether it already has Whiteboard. */
export async function detectConnectAgents(
  input: Omit<ConnectEnvironment, "hasShim" | "run"> = {},
): Promise<ReviewConnectAgent[]> {
  const homeDir = input.homeDir ?? os.homedir();
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;

  return Promise.all(
    ALL_INSTALL_TARGETS.map(async (target) => {
      const found = await harnessFound(
        HARNESSES[target],
        homeDir,
        env,
        platform,
      );

      return {
        target,
        name: HARNESSES[target].name,
        found,
        connected:
          found && (await harnessConnected(target, homeDir, env, platform)),
      };
    }),
  );
}

interface Step {
  args: string[];
  /** Output that means the step had already been done. */
  done?: RegExp;
  /** Whether a failure leaves the next step to decide the outcome. */
  optional?: boolean;
}

const ALREADY = /already/i;

/** The commands that install Whiteboard into a CLI harness, as
 * connect-prompts.ts tells an agent to run them. */
function cliSteps(
  target: Exclude<InstallTarget, "cursor" | "omp">,
  launch: McpLaunch,
  platform: NodeJS.Platform,
): Step[] {
  // The plugin install says whether it worked: the marketplace can already be
  // known by another source, such as the repository's earlier name.
  const marketplace = {
    args: ["plugin", "marketplace", "add", MARKETPLACE],
    optional: true,
  };

  // The plugins' sh launch cannot start on Windows, so there Claude and
  // Copilot (which loads the Claude plugin) register the server directly.
  const windowsServer = (scope: string[]) => ({
    args: [
      "mcp",
      "add",
      ...scope,
      "whiteboard",
      "--",
      launch.command,
      ...launch.args,
    ],
    done: ALREADY,
  });

  switch (target) {
    case "claude":
      return platform === "win32"
        ? [windowsServer(["-s", "user"])]
        : [
            marketplace,
            {
              args: ["plugin", "install", PLUGIN, "--scope", "user"],
              done: ALREADY,
            },
          ];
    case "codex":
      return [marketplace, { args: ["plugin", "add", PLUGIN], done: ALREADY }];
    case "copilot":
      return platform === "win32"
        ? [windowsServer([])]
        : [marketplace, { args: ["plugin", "install", PLUGIN], done: ALREADY }];
    case "opencode":
      return [
        {
          args: [
            "mcp",
            "add",
            "--global",
            "whiteboard",
            "--",
            launch.command,
            ...launch.args,
          ],
          done: ALREADY,
        },
      ];
    case "pi":
      return [
        {
          args: [
            "mcp",
            "add",
            "whiteboard",
            "--",
            launch.command,
            ...launch.args,
          ],
          done: ALREADY,
        },
      ];
  }
}

/** oh-my-pi reads its MCP servers from one JSON file; merge ours in. */
async function connectOmp(
  homeDir: string,
  launch: McpLaunch,
): Promise<ReviewConnectResult> {
  const file = path.join(homeDir, ".omp", "agent", "mcp.json");

  try {
    const config: JsonValue = (await exists(file))
      ? JSON.parse(await readFile(file, "utf8"))
      : {};

    if (!isJsonObject(config)) throw new Error(`${file} is not a JSON object.`);

    const servers: JsonObject = isJsonObject(config.mcpServers)
      ? { ...config.mcpServers }
      : {};

    servers.whiteboard = { command: launch.command, args: [...launch.args] };
    const next: JsonObject = { ...config, mcpServers: servers };

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);

    return { target: "omp", state: "connected", output: `Updated ${file}` };
  } catch (error) {
    return {
      target: "omp",
      state: "failed",
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Whether Cursor's global MCP config already names Whiteboard's server. */
async function cursorHasServer(homeDir: string): Promise<boolean> {
  try {
    const config: JsonValue = JSON.parse(
      await readFile(path.join(homeDir, ".cursor", "mcp.json"), "utf8"),
    );

    return (
      isJsonObject(config) &&
      isJsonObject(config.mcpServers) &&
      config.mcpServers.whiteboard !== undefined
    );
  } catch {
    return false;
  }
}

/** Cursor only installs an MCP server the user confirms, so open its link,
 * unless it already has one: confirming again would ask for nothing new. */
async function connectCursor(
  homeDir: string,
  launch: McpLaunch,
  platform: NodeJS.Platform,
  run: ConnectRun,
): Promise<ReviewConnectResult> {
  if (await cursorHasServer(homeDir))
    return {
      target: "cursor",
      state: "connected",
      output: "Cursor already has the whiteboard MCP server.",
    };

  const url = cursorInstallDeeplink(launch);

  const [file, args] =
    platform === "darwin"
      ? // In the background, so Cursor's prompt waits behind Whiteboard.
        ["open", ["-g", url]]
      : platform === "win32"
        ? ["cmd", ["/d", "/c", "start", '""', url]]
        : ["xdg-open", [url]];

  const result = await run(file, args);

  return {
    target: "cursor",
    state: result.code === 0 ? "approve" : "failed",
    output: result.output,
  };
}

/** Installs Whiteboard's plugin, or its MCP server, into one harness. */
export async function connectAgent(
  target: InstallTarget,
  input: ConnectEnvironment,
): Promise<ReviewConnectResult> {
  const homeDir = input.homeDir ?? os.homedir();
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const run = input.run ?? runProcess;
  const launch = reviewMcpLaunch(input.hasShim, platform);

  if (target === "omp") return connectOmp(homeDir, launch);

  if (target === "cursor") return connectCursor(homeDir, launch, platform, run);

  const executable = await findHarness(HARNESSES[target], homeDir, env);

  if (!executable)
    return {
      target,
      state: "failed",
      output: `${HARNESSES[target].name} is not installed.`,
    };
  const outputs: string[] = [];

  for (const step of cliSteps(target, launch, platform)) {
    const result = await run(executable, step.args);

    outputs.push(result.output);

    if (result.code !== 0 && !step.optional && !step.done?.test(result.output))
      return { target, state: "failed", output: outputs.join("\n").trim() };
  }

  return { target, state: "connected", output: outputs.join("\n").trim() };
}
