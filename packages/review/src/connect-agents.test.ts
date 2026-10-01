import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { connectAgents, detectAgents } from "./connect-agents";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

async function fakeHome(): Promise<{
  homeDir: string;
  bin: string;
  env: NodeJS.ProcessEnv;
}> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "wb-agents-"));
  homes.push(homeDir);
  const bin = path.join(homeDir, "bin");
  await mkdir(bin);

  return {
    homeDir,
    bin,
    env: { HOME: homeDir, PATH: `${bin}:/usr/bin:/bin`, XDG_CONFIG_HOME: "" },
  };
}

/** A harness CLI that logs its argv, and runs `body` (sh) after. */
async function fakeCli(bin: string, name: string, body = ""): Promise<void> {
  const file = path.join(bin, name);
  await writeFile(
    file,
    `#!/bin/sh\necho "${name} $*" >> "$HOME/calls.log"\n${body}\n`,
  );
  await chmod(file, 0o755);
}

const write = async (file: string, text: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
};

describe("detectAgents", () => {
  it("lists only the harnesses whose configuration directory exists", async () => {
    const { homeDir, bin, env } = await fakeHome();
    await mkdir(path.join(homeDir, ".codex"));
    await fakeCli(bin, "codex");

    expect(await detectAgents({ homeDir, env })).toEqual([
      { id: "codex", name: "Codex", present: true, connected: false },
    ]);
  });

  it("reads each harness's own record of the plugin or package", async () => {
    const { homeDir, bin, env } = await fakeHome();

    for (const cli of ["claude", "codex", "opencode", "pi"])
      await fakeCli(bin, cli);
    await write(
      path.join(homeDir, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: { "whiteboard@devfast": [{ scope: "user" }] },
      }),
    );
    await write(
      path.join(homeDir, ".codex", "config.toml"),
      'model = "x"\n\n[plugins."whiteboard@devfast"]\nenabled = true\n',
    );
    await write(
      path.join(homeDir, ".config", "opencode", "opencode.jsonc"),
      '{\n  // mine\n  "plugin": [\n    "@dev.fast/opencode-whiteboard@0.1.0"\n  ]\n}\n',
    );
    await write(
      path.join(homeDir, ".pi", "agent", "settings.json"),
      JSON.stringify({ packages: [{ source: "npm:@dev.fast/pi-whiteboard" }] }),
    );

    expect(
      (await detectAgents({ homeDir, env })).map(({ id, connected }) => [
        id,
        connected,
      ]),
    ).toEqual([
      ["claude", true],
      ["codex", true],
      ["opencode", true],
      ["pi", true],
    ]);
  });

  it("is not connected by a disabled or other plugin, and a harness without its CLI on PATH is manual", async () => {
    const { homeDir, env } = await fakeHome();
    await write(
      path.join(homeDir, ".codex", "config.toml"),
      '[plugins."whiteboard@devfast"]\nenabled = false\n[plugins."other@devfast"]\nenabled = true\n',
    );
    await write(
      path.join(homeDir, ".pi", "agent", "settings.json"),
      JSON.stringify({ packages: ["npm:@dev.fast/pi-whiteboard-extra"] }),
    );

    expect(await detectAgents({ homeDir, env })).toEqual([
      {
        id: "codex",
        name: "Codex",
        present: true,
        connected: false,
        manual: true,
      },
      { id: "pi", name: "Pi", present: true, connected: false, manual: true },
    ]);
  });

  it("reads unreadable records as not connected", async () => {
    const { homeDir, bin, env } = await fakeHome();
    await fakeCli(bin, "claude");
    await write(
      path.join(homeDir, ".claude", "plugins", "installed_plugins.json"),
      "{not json",
    );

    expect(await detectAgents({ homeDir, env })).toEqual([
      { id: "claude", name: "Claude Code", present: true, connected: false },
    ]);
  });
});

describe("connectAgents", () => {
  it("runs one harness's prompt commands, and changes no other harness", async () => {
    const { homeDir, bin, env } = await fakeHome();
    await mkdir(path.join(homeDir, ".codex"));
    const codexConfig = path.join(homeDir, ".codex", "config.toml");
    await writeFile(codexConfig, 'model = "x"\n');
    await fakeCli(bin, "codex");
    await fakeCli(
      bin,
      "pi",
      `mkdir -p "$HOME/.pi/agent" && printf '{"packages":["%s"]}' "$2" > "$HOME/.pi/agent/settings.json"`,
    );
    await mkdir(path.join(homeDir, ".pi"));

    const results = await connectAgents({ agents: ["pi"], homeDir, env });

    expect(results).toEqual([
      expect.objectContaining({ id: "pi", connected: true }),
    ]);
    expect(await readFile(path.join(homeDir, "calls.log"), "utf8")).toBe(
      "pi install npm:@dev.fast/pi-whiteboard\n",
    );
    expect(await readFile(codexConfig, "utf8")).toBe('model = "x"\n');
  });

  /** A `claude` whose `mcp remove` drops a hand-made registration file, and whose install `exits`. */
  async function claudeHome(installExit: number) {
    const home = await fakeHome();
    const registration = path.join(home.homeDir, ".claude.json");
    await mkdir(path.join(home.homeDir, ".claude"));
    await writeFile(registration, '{"mcpServers":{"whiteboard":{}}}');
    await fakeCli(
      home.bin,
      "claude",
      `case "$2" in
install) [ ${installExit} = 0 ] || { echo "network down" >&2; exit ${installExit}; }
  mkdir -p "$HOME/.claude/plugins" && echo '{"version":2,"plugins":{"whiteboard@devfast":[{"scope":"user"}]}}' > "$HOME/.claude/plugins/installed_plugins.json" ;;
remove) rm "$HOME/.claude.json"; echo "Removed" ;;
esac`,
    );

    return { ...home, registration };
  }

  it("replaces an old registration only once the plugin is installed", async () => {
    const { homeDir, env, registration } = await claudeHome(0);

    const [result] = await connectAgents({ agents: ["claude"], homeDir, env });

    expect(result).toMatchObject({ id: "claude", connected: true });
    await expect(readFile(registration, "utf8")).rejects.toThrow("ENOENT");
  });

  it("stops at a failed install, and keeps the old registration", async () => {
    const { homeDir, env, registration } = await claudeHome(1);

    const [result] = await connectAgents({ agents: ["claude"], homeDir, env });

    expect(result).toMatchObject({ id: "claude", connected: false });
    expect(result?.output).toContain("network down");
    expect(result?.output).toContain(
      "Stopped: claude plugin install whiteboard@devfast --scope user failed.",
    );
    expect(await readFile(registration, "utf8")).toContain("whiteboard");
    expect(
      await readFile(path.join(homeDir, "calls.log"), "utf8"),
    ).not.toContain("mcp remove");
  });

  it("tolerates a cleanup that finds nothing to remove", async () => {
    const { homeDir, bin, env } = await fakeHome();
    await mkdir(path.join(homeDir, ".codex"));
    await fakeCli(
      bin,
      "codex",
      `case "$1 $2" in
"plugin add") printf '[plugins."whiteboard@devfast"]\nenabled = true\n' > "$HOME/.codex/config.toml" ;;
"mcp remove") echo "No MCP server named whiteboard" >&2; exit 1 ;;
esac`,
    );

    const [result] = await connectAgents({ agents: ["codex"], homeDir, env });

    expect(result).toMatchObject({ id: "codex", connected: true });
    expect(result?.output).not.toContain("Stopped");
  });

  it("judges by the harness's record afterwards, and reports a failure with its output", async () => {
    const { homeDir, bin, env } = await fakeHome();
    await mkdir(path.join(homeDir, ".codex"));
    await fakeCli(bin, "codex", 'echo "network down" >&2; exit 2');

    const [result] = await connectAgents({ agents: ["codex"], homeDir, env });

    expect(result).toMatchObject({ id: "codex", connected: false });
    expect(result?.output).toContain("network down");
  });

  it("ends a command that outlives the bound", async () => {
    const { homeDir, bin, env } = await fakeHome();
    await mkdir(path.join(homeDir, ".pi"));
    await fakeCli(bin, "pi", "sleep 30");

    const [result] = await connectAgents({
      agents: ["pi"],
      homeDir,
      env,
      timeoutMs: 200,
    });

    expect(result).toMatchObject({ id: "pi", connected: false });
    expect(result?.output).toContain("did not finish within");
  });
});
