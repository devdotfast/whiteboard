import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { withFileLock } from "@dev.fast/trace-core";
import { afterEach, beforeEach, expect, it } from "vitest";

import { remoteServerPaths } from "./remote-extensions.js";
import { ensureRemoteLanguageServer } from "./remote-language-server.js";
import {
  isolatedEnv,
  stopServersUnder,
} from "./server/background-server-test-utils.js";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

let root: string;

let packageRoot: string;

let env: NodeJS.ProcessEnv;

const noExtensions = async () => ({ failed: [] });

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "wb-ls-")));
  packageRoot = path.join(root, "package");
  env = isolatedEnv(root);
  await standInServer(COMMIT);
});

afterEach(async () => {
  await stopServersUnder(root);
  await rm(root, { recursive: true, force: true });
});

it("starts the server on loopback with a private token, and a second call reports the same port", async () => {
  const first = await ensureRemoteLanguageServer({
    env,
    packageRoot,
    ensure: noExtensions,
  });

  expect(first).toEqual({
    languageServer: {
      port: expect.any(Number),
      connectionToken: expect.stringMatching(/^[0-9a-f]{64}$/),
      commit: COMMIT,
    },
    languageGroups: [],
  });
  const { port, connectionToken } = first.languageServer!;
  expect(await text(port, "/version")).toBe(COMMIT);
  expect(await text(port, "/token")).toBe(connectionToken);

  const { tokenFile, logFile } = serverFiles();
  expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
  expect(await readFile(logFile, "utf8")).not.toContain(connectionToken);
  expect(
    spawnSync("ps", ["-eo", "args"], { encoding: "utf8" }).stdout,
  ).not.toContain(connectionToken);

  const pid = await text(port, "/pid");

  const second = await ensureRemoteLanguageServer({
    env,
    packageRoot,
    ensure: noExtensions,
  });

  expect(second).toEqual(first);
  expect(await text(port, "/pid")).toBe(pid);
}, 30_000);

it("starts a new server when the running one stopped answering", async () => {
  const first = await ensureRemoteLanguageServer({
    env,
    packageRoot,
    ensure: noExtensions,
  });

  const pid = Number(await text(first.languageServer!.port, "/pid"));
  process.kill(pid, "SIGKILL");

  const second = await ensureRemoteLanguageServer({
    env,
    packageRoot,
    ensure: noExtensions,
  });

  expect(second.languageServer?.port).not.toBe(first.languageServer?.port);
  expect(second.languageServer?.connectionToken).not.toBe(
    first.languageServer?.connectionToken,
  );
  expect(await text(second.languageServer!.port, "/version")).toBe(COMMIT);
}, 30_000);

it("replaces a running server of another commit once the package is reinstalled", async () => {
  const first = await ensureRemoteLanguageServer({
    env,
    packageRoot,
    ensure: noExtensions,
  });

  const other = "f".repeat(40);
  await standInServer(other);

  const second = await ensureRemoteLanguageServer({
    env,
    packageRoot,
    ensure: noExtensions,
  });

  expect(second.languageServer?.commit).toBe(other);
  expect(await text(second.languageServer!.port, "/version")).toBe(other);
  await expect(text(first.languageServer!.port, "/version")).rejects.toThrow(
    "fetch failed",
  );
}, 30_000);

it("runs extensions ensure first, with the groups, and starts nothing when it fails", async () => {
  const calls: unknown[] = [];

  const result = await ensureRemoteLanguageServer({
    env,
    packageRoot,
    groups: ["go"],
    ensure: async (input) => {
      calls.push(input.groups);

      return {
        failed: [
          {
            id: "astral-sh.ty",
            error: "Network error reaching open-vsx.org: ENETUNREACH",
          },
        ],
      };
    },
  });

  expect(calls).toEqual([["go"]]);
  expect(result).toEqual({
    languageServer: null,
    languageServerDetail:
      "Could not install the language extensions: astral-sh.ty: Network error reaching open-vsx.org: ENETUNREACH",
    languageGroups: [{ group: "go", installed: false }],
  });
  expect(await stat(serverFiles().runningFile).catch(() => null)).toBeNull();
});

it("hands downloads that outlast the attach to one detached install, and reports pending until it is done", async () => {
  // Stands in for the CLI: records its arguments and runs a while.
  const cli = path.join(root, "cli.mjs");
  const runs = path.join(root, "runs");
  await writeFile(
    cli,
    `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(runs)}, process.argv.slice(2).join(" ") + "\\n");\nsetTimeout(() => {}, 30_000);\n`,
  );
  let ensured = 0;

  const stalled = async ({ signal }: { signal?: AbortSignal }) => {
    ensured++;
    await new Promise((resolve) => signal?.addEventListener("abort", resolve));

    // As ensureRemoteExtensions reports a download the cap stopped.
    const error =
      "Network error reaching open-vsx.org: This operation was aborted";

    return {
      failed: [{ id: "golang.go", error }],
      groups: [
        { group: "go", installed: false, detail: `golang.go: ${error}` },
      ],
    };
  };

  const attach = () =>
    ensureRemoteLanguageServer({
      env,
      packageRoot,
      groups: ["go"],
      ensure: stalled,
      installTimeoutMs: 200,
      cli: [process.execPath, cli],
    });

  const pending = {
    languageServer: null,
    languageServerDetail:
      "Installing the language extensions on this host; they will be available on the next connection.",
    languageServerPending: true,
    languageGroups: [{ group: "go", installed: false }],
  };

  expect(await attach()).toEqual(pending);
  await expect
    .poll(() => readFile(runs, "utf8").catch(() => ""))
    .toBe("remote extensions ensure --json --groups go\n");

  // While it runs, an attach neither downloads nor starts another.
  expect(await attach()).toEqual(pending);
  expect(ensured).toBe(1);
  expect(await readFile(runs, "utf8")).toBe(
    "remote extensions ensure --json --groups go\n",
  );

  const { installLog } = serverFiles();
  expect((await stat(installLog)).mode & 0o777).toBe(0o600);

  await stopServersUnder(root);

  const done = await ensureRemoteLanguageServer({
    env,
    packageRoot,
    ensure: noExtensions,
  });

  expect(done.languageServer?.commit).toBe(COMMIT);
}, 30_000);

it("reports the download failure, not pending, when the detached install's lock cannot be had", async () => {
  const error =
    "Network error reaching open-vsx.org: This operation was aborted";

  const stalled = async ({ signal }: { signal?: AbortSignal }) => {
    await new Promise((resolve) => signal?.addEventListener("abort", resolve));

    return {
      failed: [{ id: "golang.go", error }],
      groups: [
        { group: "go", installed: false, detail: `golang.go: ${error}` },
      ],
    };
  };

  // Another attach holds the install lock for longer than one waits for it.
  const held = await withFileLock(
    serverFiles().installLock,
    { retryMs: 100, staleMs: 60_000, timeoutMs: 1_000 },
    () =>
      ensureRemoteLanguageServer({
        env,
        packageRoot,
        groups: ["go"],
        ensure: stalled,
        installTimeoutMs: 200,
        cli: [process.execPath, "-e", "process.exit(9)"],
      }),
  );

  expect(held.result).toEqual({
    languageServer: null,
    languageServerDetail: `Could not install the language extensions: golang.go: ${error}`,
    languageGroups: [
      { group: "go", installed: false, detail: `golang.go: ${error}` },
    ],
  });
}, 30_000);

it("reports a package without a VS Code server", async () => {
  const result = await ensureRemoteLanguageServer({
    env,
    packageRoot: path.join(root, "empty"),
    ensure: noExtensions,
  });

  expect(result.languageServer).toBeNull();
  expect(result.languageServerDetail).toMatch(/has no VS Code server/);
});

it("reports a server that exits at start with the end of its log", async () => {
  await writeFile(
    path.join(packageRoot, "vscode-server", "out", "server-main.js"),
    'console.error("cannot start"); process.exit(3);\n',
  );

  const result = await ensureRemoteLanguageServer({
    env,
    packageRoot,
    ensure: noExtensions,
  });

  expect(result.languageServer).toBeNull();
  expect(result.languageServerDetail).toMatch(
    /did not start\. The end of .*server\.log:\ncannot start/,
  );
});

/** The files the module keeps in the server's data directory. */
function serverFiles() {
  const file = (name: string) =>
    path.join(remoteServerPaths(env).serverDataDir, name);

  return {
    tokenFile: file("connection-token"),
    logFile: file("server.log"),
    runningFile: file("server.json"),
    installLog: file("install.log"),
    installLock: file("install.lock"),
  };
}

/**
 * Stands in for server-main: reads the token file it is given, answers
 * /version with product.json's commit, and prints upstream's listening line.
 * /token and /pid let the test see what it read and who it is.
 */
async function standInServer(commit: string) {
  const server = path.join(packageRoot, "vscode-server");
  await mkdir(path.join(server, "out"), { recursive: true });
  await writeFile(
    path.join(server, "product.json"),
    JSON.stringify({ commit }),
  );
  await writeFile(
    path.join(server, "out", "server-main.js"),
    [
      'import { readFileSync } from "node:fs";',
      'import http from "node:http";',
      "const arg = (name) => process.argv[process.argv.indexOf(name) + 1];",
      "const expected = new Map([",
      `  ["--server-data-dir", ${JSON.stringify(remoteServerPaths(env).serverDataDir)}],`,
      `  ["--extensions-dir", ${JSON.stringify(remoteServerPaths(env).extensionsDir)}],`,
      '  ["--host", "127.0.0.1"],',
      "]);",
      "for (const [name, value] of expected) if (arg(name) !== value) process.exit(2);",
      'const token = readFileSync(arg("--connection-token-file"), "utf8");',
      `const commit = ${JSON.stringify(commit)};`,
      "const server = http.createServer((request, response) => response.end(",
      '  request.url === "/version" ? commit : request.url === "/token" ? token : String(process.pid)));',
      'server.listen(Number(arg("--port")), arg("--host"), () =>',
      "  console.log(`Extension host agent listening on ${server.address().port}`));",
      "",
    ].join("\n"),
  );
}

async function text(port: number, route: string) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`);

  return response.text();
}
