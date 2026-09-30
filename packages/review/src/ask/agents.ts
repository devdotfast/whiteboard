import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import {
  type ClientApp,
  type ClientConnection,
  type NewSessionRequest,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import { type AskAgentId, askAgentIds } from "@review/ask/thread-state.js";

/** How Whiteboard runs an agent that speaks ACP on stdio. */
type AskAgentLaunch =
  /** An ACP adapter's executable entry, run with this server's Node, which
   * drives the user's CLI with the user's login. */
  | {
      adapter: string;
      /** How the adapter is told to use the user's CLI instead of a bundled one. */
      executableEnv: string;
    }
  /** The user's CLI speaks ACP itself, given these arguments. */
  | { args: string[] };

interface AskAgentSpec {
  name: string;
  /** The user's own CLI: the names it goes by on PATH, most specific first. */
  commands: string[];
  /** Where its installer puts it when that is not on PATH, under home. */
  installDirs?: string[];
  launch: AskAgentLaunch;
  /** The session mode Whiteboard starts the agent in, when it has one that
   * keeps the checkout as it is. Read-only is best effort: an agent without
   * one still answers. */
  readOnlyMode?: string;
  /** Adapter-specific session settings, sent as the session's `_meta`. */
  sessionMeta?: NewSessionRequest["_meta"];
  /** Settings for the agent's process. */
  env?: Record<string, string>;
  /** Signs the user's CLI in again, run in a terminal. */
  signIn: string;
}

export const askAgents: Record<AskAgentId, AskAgentSpec> = {
  claude: {
    name: "Claude Code",
    commands: ["claude"],
    launch: {
      adapter: "@agentclientprotocol/claude-agent-acp/dist/index.js",
      executableEnv: "CLAUDE_CODE_EXECUTABLE",
    },
    signIn: "claude auth login",
    // Plan mode would end each answer asking to leave it, and it blocks the
    // Whiteboard tools that edit the review. Claude instead runs in its
    // default mode without its file tools, and without bypass, so commands
    // still ask; the review is edited through Whiteboard's MCP server.
    readOnlyMode: "default",
    sessionMeta: {
      claudeCode: {
        options: {
          disallowedTools: [
            "Edit",
            "MultiEdit",
            "Write",
            "NotebookEdit",
            "EnterPlanMode",
            "ExitPlanMode",
          ],
          allowDangerouslySkipPermissions: false,
        },
      },
    },
  },
  codex: {
    name: "Codex",
    commands: ["codex"],
    launch: {
      adapter: "@agentclientprotocol/codex-acp/dist/index.js",
      executableEnv: "CODEX_PATH",
    },
    signIn: "codex login",
    readOnlyMode: "read-only",
  },
  cursor: {
    name: "Cursor",
    // Its installer adds `agent` too, but Homebrew's has only this name,
    // and `agent` alone could be anything.
    commands: ["cursor-agent"],
    installDirs: [".local/bin"],
    launch: { args: ["acp"] },
    signIn: "cursor-agent login",
    // Ask mode answers without editing or running commands.
    readOnlyMode: "ask",
  },
  opencode: {
    name: "OpenCode",
    commands: ["opencode"],
    installDirs: [".opencode/bin"],
    launch: { args: ["acp"] },
    signIn: "opencode auth login",
    // Every OpenCode agent may edit and run commands without asking; its
    // plan agent only stops edits. These permissions, over the user's own
    // config, refuse edits and ask before commands in any of them. Its
    // build agent then answers as usual, where plan's would plan.
    readOnlyMode: "build",
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        permission: { edit: "deny", bash: "ask", webfetch: "ask" },
      }),
    },
  },
  pi: {
    name: "Pi",
    commands: ["pi"],
    launch: {
      adapter: "pi-acp/dist/index.js",
      executableEnv: "PI_ACP_PI_COMMAND",
    },
    // Pi signs in from its own prompt, with /login.
    signIn: "pi",
    // Pi never asks before it edits or runs a command, and has no mode that
    // stops it.
  },
};

export interface AskAgentStatus {
  id: AskAgentId;
  name: string;
  available: boolean;
}

/** An Ask agent process, connected as the given ACP client. */
export interface AskAgentProcess {
  connect(client: ClientApp): ClientConnection;
  /** Recent stderr, for explaining a failed start. */
  diagnostics(): string;
  stop(): void;
}

export type AskAgentLauncher = (
  agent: AskAgentId,
  cwd: string,
) => Promise<AskAgentProcess>;

/** Desktop inherits the login shell's PATH, so this sees what a terminal sees.
 * Package-manager bin directories are skipped: the adapters' own dependencies
 * put `codex` there, and that is not the user's install. */
export async function findExecutable(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (!directory || directory.split(path.sep).includes("node_modules"))
      continue;
    const candidate = path.join(directory, command);

    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);

      return candidate;
    } catch {
      /* Not in this directory. */
    }
  }

  return undefined;
}

/** The user's install of an agent's CLI: on PATH, else where its installer
 * puts it. */
async function findAgent(
  spec: AskAgentSpec,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const installed = (spec.installDirs ?? []).map((directory) =>
    path.join(homedir(), directory),
  );

  for (const command of spec.commands) {
    const found =
      (await findExecutable(command, env)) ??
      (await findExecutable(command, { PATH: installed.join(path.delimiter) }));

    if (found) return found;
  }

  return undefined;
}

export async function detectAskAgents(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AskAgentStatus[]> {
  return Promise.all(
    askAgentIds.map(async (id) => ({
      id,
      name: askAgents[id].name,
      available: (await findAgent(askAgents[id], env)) !== undefined,
    })),
  );
}

const STDERR_LIMIT = 8_000;

/** Runs an adapter with this server's runtime, Desktop's being Electron, or
 * the user's CLI itself. */
export const launchAskAgent: AskAgentLauncher = async (agent, cwd) => {
  const spec = askAgents[agent];
  const executable = await findAgent(spec);

  if (!executable) throw new Error(`${spec.name} is not installed.`);

  const env: NodeJS.ProcessEnv = { ...process.env, ...spec.env };
  // A server started from inside a Claude Code session must not look nested.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const { launch } = spec;

  let command = executable;
  let args: string[];

  if ("adapter" in launch) {
    env[launch.executableEnv] = executable;

    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    command = process.execPath;
    args = [createRequire(import.meta.url).resolve(launch.adapter)];
  } else args = launch.args;

  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_LIMIT);
  });

  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin),
    // SAFETY: stdout has no encoding set, so it yields Buffers (Uint8Arrays).
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );

  return {
    connect: (client) => {
      const connection = client.connect(stream);
      child.once("exit", () => connection.close());

      return connection;
    },
    diagnostics: () => stderr,
    stop: () => {
      if (child.exitCode === null) child.kill();
    },
  };
};
