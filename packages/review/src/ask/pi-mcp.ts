import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { McpServer } from "@agentclientprotocol/sdk";
import { devReviewHome } from "@dev.fast/trace-core";

/**
 * pi-acp keeps the MCP servers a session is given without passing them to
 * Pi. Pi 0.99.0 and later take them from an extension, so Ask starts Pi
 * through a wrapper that loads one, registering the servers for that session
 * only. Older Pi, and Windows, which would need a different wrapper, answer
 * without them.
 */

/** The first Pi with `pi.registerMcpServer()`. */
const PI_MCP_VERSION = [0, 99, 0] as const;

/** How long a version read is trusted: a session's first prompt and its
 * launch ask moments apart, and an update during a review is seen soon. */
const VERSION_TTL_MS = 30_000;

const SERVERS_ENV = "WHITEBOARD_ASK_MCP";

const PI_ENV = "WHITEBOARD_ASK_PI";

const EXTENSION_ENV = "WHITEBOARD_ASK_PI_EXTENSION";

const EXTENSION = `// Managed by Whiteboard: gives a Pi session that Ask starts the MCP servers
// Whiteboard hands it. Do not edit.
export default function (pi: {
  registerMcpServer(name: string, config: object): void;
}) {
  const servers = JSON.parse(process.env.${SERVERS_ENV} ?? "{}");

  for (const [name, config] of Object.entries(servers))
    pi.registerMcpServer(name, config as object);
}
`;

const WRAPPER = `#!/bin/sh
# Managed by Whiteboard: starts Pi for Ask with Whiteboard's extension.
exec "$${PI_ENV}" -e "$${EXTENSION_ENV}" "$@"
`;

const versions = new Map<
  string,
  { read: number; version: Promise<number[] | undefined> }
>();

function piVersion(executable: string) {
  const cached = versions.get(executable);

  if (cached && Date.now() - cached.read < VERSION_TTL_MS)
    return cached.version;

  const version = promisify(execFile)(executable, ["--version"], {
    timeout: 5_000,
  })
    .then(({ stdout }) =>
      /(\d+)\.(\d+)\.(\d+)/u.exec(stdout)?.slice(1).map(Number),
    )
    .catch(() => undefined);

  versions.set(executable, { read: Date.now(), version });

  return version;
}

/** Whether this Pi can be given MCP servers. */
export async function piTakesMcp(executable: string): Promise<boolean> {
  if (process.platform === "win32") return false;
  const version = await piVersion(executable);

  if (!version) return false;

  for (const [index, least] of PI_MCP_VERSION.entries()) {
    const part = version[index] ?? 0;

    if (part !== least) return part > least;
  }

  return true;
}

/** Writes a file only when it changed, replacing it whole, since another
 * Ask session may be running it. */
async function keep(file: string, content: string, mode: number) {
  const current = await readFile(file, "utf8").catch(() => undefined);

  if (current === content) return;
  const staged = `${file}.${process.pid}.tmp`;

  await writeFile(staged, content, { mode });
  await chmod(staged, mode);
  await rename(staged, file);
}

/** Pi's shape for each server, under its name; it reaches every tool
 * without searching for it. */
/** A server as Pi's `mcp.json` has it. */
type PiMcpServer = { exposure: "direct" } & (
  | { command: string; args: string[]; env: Record<string, string> }
  | { url: string; headers: Record<string, string> }
);

function piServers(servers: McpServer[]) {
  const piServers: Record<string, PiMcpServer> = {};

  const record = (pairs: { name: string; value: string }[]) =>
    Object.fromEntries(pairs.map(({ name, value }) => [name, value]));

  for (const server of servers) {
    if ("command" in server)
      piServers[server.name] = {
        command: server.command,
        args: server.args,
        env: record(server.env),
        exposure: "direct",
      };
    // Pi speaks neither SSE nor MCP over ACP.
    else if (server.type === "http")
      piServers[server.name] = {
        url: server.url,
        headers: record(server.headers),
        exposure: "direct",
      };
  }

  return piServers;
}

/** The command pi-acp runs in place of Pi: Pi with the extension that
 * registers `servers`, which go to it in `env`. */
export async function piWithMcp(
  executable: string,
  servers: McpServer[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const directory = path.join(devReviewHome(), "ask", "pi");
  const extension = path.join(directory, "whiteboard-mcp.ts");
  const wrapper = path.join(directory, "pi");

  await mkdir(directory, { recursive: true });
  await keep(extension, EXTENSION, 0o644);
  await keep(wrapper, WRAPPER, 0o755);

  env[PI_ENV] = executable;
  env[EXTENSION_ENV] = extension;
  env[SERVERS_ENV] = JSON.stringify(piServers(servers));

  return wrapper;
}
