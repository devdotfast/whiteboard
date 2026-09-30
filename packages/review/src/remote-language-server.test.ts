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

import { afterEach, beforeEach, expect, it } from "vitest";

import { remoteServerPaths } from "./remote-extensions.js";
import {
  ensureRemoteLanguageServer,
  remoteLanguageServerFiles,
  stopRemoteLanguageServer,
} from "./remote-language-server.js";
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
  await stopRemoteLanguageServer(env);
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
  });
  const { port, connectionToken } = first.languageServer!;
  expect(await text(port, "/version")).toBe(COMMIT);
  expect(await text(port, "/token")).toBe(connectionToken);

  const { tokenFile, logFile } = remoteLanguageServerFiles(env);
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
  });
  expect(
    await stat(remoteLanguageServerFiles(env).runningFile).catch(() => null),
  ).toBeNull();
});

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
