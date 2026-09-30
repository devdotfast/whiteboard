import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
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

interface AskAgentSpec {
  name: string;
  /** The user's own CLI, which the adapter drives with the user's login. */
  command: string;
  /** The ACP adapter's executable entry, run with this server's Node. */
  adapter: string;
  /** How the adapter is told to use the user's CLI instead of a bundled one. */
  executableEnv: string;
  /** The session mode Whiteboard starts the agent in: one that asks
   * before it runs anything that could change the checkout. */
  readOnlyMode: string;
  /** Adapter-specific session settings, sent as the session's `_meta`. */
  sessionMeta?: NewSessionRequest["_meta"];
  /** Signs the user's CLI in again, run in a terminal. */
  signIn: string;
}

export const askAgents: Record<AskAgentId, AskAgentSpec> = {
  claude: {
    name: "Claude Code",
    command: "claude",
    adapter: "@agentclientprotocol/claude-agent-acp/dist/index.js",
    executableEnv: "CLAUDE_CODE_EXECUTABLE",
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
    command: "codex",
    adapter: "@agentclientprotocol/codex-acp/dist/index.js",
    executableEnv: "CODEX_PATH",
    signIn: "codex login",
    readOnlyMode: "read-only",
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

export async function detectAskAgents(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AskAgentStatus[]> {
  return Promise.all(
    askAgentIds.map(async (id) => ({
      id,
      name: askAgents[id].name,
      available:
        (await findExecutable(askAgents[id].command, env)) !== undefined,
    })),
  );
}

const STDERR_LIMIT = 8_000;

/** Runs the adapter with this server's runtime; Desktop's is Electron. */
export const launchAskAgent: AskAgentLauncher = async (agent, cwd) => {
  const spec = askAgents[agent];
  const executable = await findExecutable(spec.command);

  if (!executable) throw new Error(`${spec.name} is not installed.`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [spec.executableEnv]: executable,
  };

  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  // A server started from inside a Claude Code session must not look nested.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const child = spawn(
    process.execPath,
    [createRequire(import.meta.url).resolve(spec.adapter)],
    { cwd, env, stdio: ["pipe", "pipe", "pipe"] },
  );

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
