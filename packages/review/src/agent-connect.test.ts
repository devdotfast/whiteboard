import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type ConnectRun,
  connectAgent,
  detectConnectAgents,
} from "./agent-connect";

let homeDir: string;

let binDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(path.join(tmpdir(), "agent-connect-"));
  binDir = path.join(homeDir, "bin");
  await mkdir(binDir);
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

async function installCli(name: string) {
  const file = path.join(binDir, name);

  await writeFile(file, "#!/bin/sh\n");
  await chmod(file, 0o755);

  return file;
}

/** Records each command and answers from a script of results. */
function recorder(results: Array<{ code: number; output: string }>) {
  const calls: Array<{ file: string; args: string[] }> = [];

  const run: ConnectRun = async (file, args) => {
    calls.push({ file, args });

    return results.shift() ?? { code: 0, output: "" };
  };

  return { calls, run };
}

const env = () => ({ PATH: binDir });

describe("detectConnectAgents", () => {
  it("finds CLIs on PATH and app harnesses by their home directory", async () => {
    await installCli("codex");
    await mkdir(path.join(homeDir, ".cursor"));

    const agents = await detectConnectAgents({
      homeDir,
      env: env(),
      platform: "linux",
    });

    const found = agents.filter((agent) => agent.found).map((a) => a.target);

    expect(found.sort()).toEqual(["codex", "cursor"]);
    expect(agents).toHaveLength(7);
  });
});

describe("connectAgent", () => {
  it("adds the marketplace and installs the Claude plugin for the user", async () => {
    const claude = await installCli("claude");
    const { calls, run } = recorder([]);

    const result = await connectAgent("claude", {
      homeDir,
      env: env(),
      platform: "darwin",
      hasShim: true,
      run,
    });

    expect(result.state).toBe("connected");
    expect(calls).toEqual([
      {
        file: claude,
        args: ["plugin", "marketplace", "add", "devdotfast/whiteboard"],
      },
      {
        file: claude,
        args: ["plugin", "install", "whiteboard@devfast", "--scope", "user"],
      },
    ]);
  });

  it("installs the plugin when the marketplace is already known by another source", async () => {
    await installCli("claude");

    const { run } = recorder([
      {
        code: 1,
        output:
          'Cannot add marketplace "devfast": its source doesn\'t match its extraKnownMarketplaces entry',
      },
      { code: 0, output: 'Plugin "whiteboard@devfast" is already installed' },
    ]);

    const result = await connectAgent("claude", {
      homeDir,
      env: env(),
      platform: "darwin",
      hasShim: true,
      run,
    });

    expect(result.state).toBe("connected");
  });

  it("treats a step that was already done as done", async () => {
    await installCli("codex");

    const { run } = recorder([
      { code: 0, output: "" },
      { code: 1, output: "Plugin whiteboard@devfast is already installed" },
    ]);

    const result = await connectAgent("codex", {
      homeDir,
      env: env(),
      hasShim: true,
      run,
    });

    expect(result.state).toBe("connected");
  });

  it("fails with every step's output when the install fails", async () => {
    await installCli("copilot");

    const { calls, run } = recorder([
      { code: 2, output: "network down" },
      { code: 1, output: "Unknown plugin whiteboard@devfast" },
    ]);

    const result = await connectAgent("copilot", {
      homeDir,
      env: env(),
      platform: "linux",
      hasShim: true,
      run,
    });

    expect(result).toEqual({
      target: "copilot",
      state: "failed",
      output: "network down\nUnknown plugin whiteboard@devfast",
    });
    expect(calls).toHaveLength(2);
  });

  it("fails without running anything when the harness is missing", async () => {
    const { calls, run } = recorder([]);

    const result = await connectAgent("opencode", {
      homeDir,
      env: env(),
      hasShim: true,
      run,
    });

    expect(result.state).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("registers Claude's server directly on Windows, where the plugin cannot start", async () => {
    await installCli("claude");
    const { calls, run } = recorder([]);

    await connectAgent("claude", {
      homeDir,
      env: env(),
      platform: "win32",
      hasShim: true,
      run,
    });

    expect(calls.map((call) => call.args)).toEqual([
      [
        "mcp",
        "add",
        "-s",
        "user",
        "whiteboard",
        "--",
        "cmd",
        "/d",
        "/c",
        "whiteboard",
        "mcp",
      ],
    ]);
  });

  it("opens Cursor's install link and waits for the user to approve it", async () => {
    const { calls, run } = recorder([]);

    const result = await connectAgent("cursor", {
      homeDir,
      platform: "darwin",
      hasShim: true,
      run,
    });

    expect(result.state).toBe("approve");
    expect(calls[0]?.file).toBe("open");
    expect(calls[0]?.args.at(-1)).toMatch(
      /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/,
    );
  });

  it("does not ask Cursor again when it already has the server", async () => {
    await mkdir(path.join(homeDir, ".cursor"));
    await writeFile(
      path.join(homeDir, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { whiteboard: { command: "sh" } } }),
    );

    const { calls, run } = recorder([]);

    const result = await connectAgent("cursor", {
      homeDir,
      platform: "darwin",
      hasShim: true,
      run,
    });

    expect(result.state).toBe("connected");
    expect(calls).toEqual([]);
  });

  it("merges the server into oh-my-pi's config, keeping the servers already there", async () => {
    const file = path.join(homeDir, ".omp", "agent", "mcp.json");

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        mcpServers: { other: { command: "x" } },
        theme: "dark",
      }),
    );

    const result = await connectAgent("omp", {
      homeDir,
      platform: "linux",
      hasShim: true,
    });

    expect(result.state).toBe("connected");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      theme: "dark",
      mcpServers: {
        other: { command: "x" },
        whiteboard: {
          command: "sh",
          args: ["-c", 'exec "$HOME/.local/bin/whiteboard" mcp'],
        },
      },
    });
  });
});
