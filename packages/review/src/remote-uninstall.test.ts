import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { REVIEW_REMOTE_WRAPPER_MARK } from "@dev.fast/review-protocol";
import { processStartIdentity } from "@dev.fast/trace-core";
import { runReviewCli } from "@review/cli-runner.js";
import { remoteServerPaths } from "@review/remote-extensions.js";
import { remoteUninstall, takeInstallLock } from "@review/remote-uninstall.js";
import { reviewServerDiscoveryPath } from "@review/server-discovery.js";
import { afterEach, beforeEach, expect, it } from "vitest";

let root: string;

let home: string;

let stateDir: string;

let env: NodeJS.ProcessEnv;

let install: string;

let wrapper: string;

const children: ChildProcess[] = [];

const groups: number[] = [];

const servers: Server[] = [];

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "wb-uninstall-")));
  home = path.join(root, "home");
  stateDir = path.join(home, ".dev");
  env = { DEV_REVIEW_HOME: stateDir };
  install = path.join(stateDir, "whiteboard-remote");
  wrapper = path.join(home, ".local", "bin", "whiteboard");

  const version = path.join(install, "versions", "0.1.6");
  await mkdir(path.join(version, "node_modules"), { recursive: true });
  await writeFile(path.join(version, ".whiteboard-install.json"), "{}\n");
  await mkdir(path.join(install, "node", "v24.18.0", "bin"), {
    recursive: true,
  });
  await mkdir(path.dirname(wrapper), { recursive: true });
  await writeFile(
    wrapper,
    `#!/bin/sh\n${REVIEW_REMOTE_WRAPPER_MARK}\nexec '${version}/whiteboard' "$@"\n`,
    { mode: 0o755 },
  );

  for (const name of [
    "review-api.db",
    "review-api.db-wal",
    "review-api.db-shm",
    "review-api.db.workspaces",
  ])
    await writeFile(path.join(stateDir, name), "reviews");
  await mkdir(path.join(stateDir, "review-tools"), { recursive: true });
  await writeFile(path.join(stateDir, "review-tools", "keep"), "");
});

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");

  for (const leader of groups.splice(0))
    try {
      process.kill(-leader, "SIGKILL");
    } catch {}

  for (const server of servers.splice(0)) server.close();
  await rm(root, { recursive: true, force: true });
});

const homeEntries = async () => (await readdir(stateDir)).sort();

async function runningFrom(cli: string) {
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)", cli],
    { stdio: "ignore" },
  );

  children.push(child);
  await once(child, "spawn");

  return child;
}

async function groupFrom(file: string, child?: string) {
  const forever = "setInterval(() => {}, 1000)";

  const leader = spawn(
    process.execPath,
    [
      "-e",
      child
        ? `require("child_process").spawn(process.execPath, ["-e", ${JSON.stringify(forever)}, ${JSON.stringify(child)}], { stdio: "ignore" }); ${forever}`
        : forever,
      file,
    ],
    { stdio: "ignore", detached: true },
  );

  groups.push(leader.pid!);
  await once(leader, "spawn");

  return leader.pid!;
}

const runningWith = (text: string) =>
  spawnSync("pgrep", ["-f", text]).status === 0;

async function languageServerRecords(server: number, ensure?: number) {
  const { serverDataDir } = remoteServerPaths(env);
  await mkdir(serverDataDir, { recursive: true });
  await writeFile(
    path.join(serverDataDir, "server.json"),
    JSON.stringify({
      pid: server,
      started: processStartIdentity(server),
      port: 1,
    }),
  );

  if (ensure !== undefined)
    await writeFile(
      path.join(serverDataDir, "install.json"),
      JSON.stringify({ pid: ensure, started: processStartIdentity(ensure) }),
    );
}

async function serverRecord(
  pid: number,
  startedBy: "user" | "cli" | "desktop",
) {
  const instanceId = randomUUID();
  const token = "token";

  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      request.headers["x-review-token"] === token
        ? JSON.stringify({
            ok: true,
            instanceId,
            serverPid: pid,
            version: "0.1.6",
          })
        : "{}",
    );
  });

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  await mkdir(path.dirname(reviewServerDiscoveryPath(stateDir)), {
    recursive: true,
  });
  await writeFile(
    reviewServerDiscoveryPath(stateDir),
    JSON.stringify({
      version: 1,
      instanceId,
      url: `http://127.0.0.1:${port}`,
      serverPid: pid,
      token,
      startedBy,
    }),
  );
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

it("with --keep-reviews removes the install and Desktop's script, and leaves the review store", async () => {
  const result = await remoteUninstall({
    env,
    home,
    stateDir,
    deleteReviews: false,
  });

  expect(result).toEqual({
    event: "remote.uninstall",
    ok: true,
    removed: [install, wrapper],
    keptReviews: true,
  });
  expect(existsSync(install)).toBe(false);
  expect(existsSync(wrapper)).toBe(false);
  expect(await homeEntries()).toEqual([
    "review-api.db",
    "review-api.db-shm",
    "review-api.db-wal",
    "review-api.db.workspaces",
    "review-tools",
  ]);
});

it("with --delete-reviews also removes the review store and nothing else in the review home", async () => {
  const result = await remoteUninstall({
    env,
    home,
    stateDir,
    deleteReviews: true,
  });

  expect(result).toMatchObject({
    ok: true,
    keptReviews: false,
    removed: [
      install,
      wrapper,
      path.join(stateDir, "review-api.db"),
      path.join(stateDir, "review-api.db-wal"),
      path.join(stateDir, "review-api.db-shm"),
      path.join(stateDir, "review-api.db.workspaces"),
    ],
  });
  expect(await homeEntries()).toEqual(["review-tools"]);
});

it("leaves a ~/.local/bin/whiteboard that Desktop did not write", async () => {
  await writeFile(wrapper, "#!/bin/sh\necho mine\n");

  const result = await remoteUninstall({
    env,
    home,
    stateDir,
    deleteReviews: false,
  });

  expect(result).toMatchObject({ ok: true, removed: [install] });
  expect(await readFile(wrapper, "utf8")).toBe("#!/bin/sh\necho mine\n");
});

it("stops a server Desktop started and reports it", async () => {
  const server = await runningFrom(
    path.join(install, "versions", "0.1.6", "cli.js"),
  );

  await serverRecord(server.pid!, "desktop");

  const result = await remoteUninstall({
    env,
    home,
    stateDir,
    deleteReviews: false,
  });

  expect(result).toMatchObject({
    ok: true,
    stoppedServer: { pid: server.pid, version: "0.1.6" },
  });
  expect(alive(server.pid!)).toBe(false);
  expect(existsSync(install)).toBe(false);
});

it("refuses while a server the user started runs from the install, and removes nothing", async () => {
  const server = await runningFrom(
    path.join(install, "versions", "0.1.6", "cli.js"),
  );

  await serverRecord(server.pid!, "user");

  const result = await remoteUninstall({
    env,
    home,
    stateDir,
    deleteReviews: false,
  });

  expect(result).toEqual({
    event: "remote.uninstall",
    ok: false,
    reason: expect.stringContaining(`process ${server.pid}`),
  });
  expect(alive(server.pid!)).toBe(true);
  expect(existsSync(install)).toBe(true);
  expect(existsSync(wrapper)).toBe(true);
  expect(existsSync(path.join(install, "install.lock"))).toBe(false);
});

it("refuses while any other process runs from the install, naming it, and stops nothing", async () => {
  const desktopServer = await runningFrom(
    path.join(install, "versions", "0.1.6", "cli.js"),
  );

  await serverRecord(desktopServer.pid!, "desktop");

  const mcp = await runningFrom(
    path.join(install, "versions", "0.1.6", "cli.js mcp"),
  );

  const result = await remoteUninstall({
    env,
    home,
    stateDir,
    deleteReviews: false,
  });

  expect(result).toEqual({
    event: "remote.uninstall",
    ok: false,
    reason: `Process ${mcp.pid} runs from ${install}. Stop it, then run whiteboard remote uninstall again.`,
  });
  expect(alive(mcp.pid!)).toBe(true);
  expect(alive(desktopServer.pid!)).toBe(true);
  expect(existsSync(install)).toBe(true);
});

it("takes over a stale install lock", async () => {
  await mkdir(path.join(install, "install.lock"));
  await writeFile(
    path.join(install, "install.lock", "started"),
    `${Math.floor(Date.now() / 1000) - 16 * 60}\n`,
  );

  const result = await remoteUninstall({
    env,
    home,
    stateDir,
    deleteReviews: false,
  });

  expect(result).toMatchObject({ ok: true, removed: [install, wrapper] });
});

async function installLock(token: string, ago: number) {
  const lock = path.join(install, "install.lock");

  await mkdir(lock, { recursive: true });
  await writeFile(path.join(lock, "token"), `${token}\n`);
  await writeFile(path.join(lock, "owner"), "laptop\n");
  await writeFile(
    path.join(lock, "started"),
    `${Math.floor(Date.now() / 1000) - ago}\n`,
  );

  return lock;
}

const lockEntries = async () =>
  (await readdir(install)).filter((name) => name.startsWith("install.lock"));

it("leaves a stale lock its holder refreshes during the check, and refuses", async () => {
  const lock = await installLock("installer", 16 * 60);

  const taken = await takeInstallLock(install, {
    beforeMove: () =>
      writeFile(
        path.join(lock, "started"),
        `${Math.floor(Date.now() / 1000)}\n`,
      ),
  });

  expect(taken).toEqual({ holder: "laptop" });
  expect(await readFile(path.join(lock, "token"), "utf8")).toBe("installer\n");
  expect(await lockEntries()).toEqual(["install.lock"]);
});

it("leaves a lock another install took over during the check", async () => {
  const lock = await installLock("installer", 16 * 60);

  const taken = await takeInstallLock(install, {
    beforeMove: async () => {
      await rm(lock, { recursive: true });
      await installLock("winner", 0);
    },
  });

  expect(taken).toEqual({ holder: "laptop" });
  expect(await readFile(path.join(lock, "token"), "utf8")).toBe("winner\n");
  expect(await lockEntries()).toEqual(["install.lock"]);
});

it("releases the lock when writing it fails", async () => {
  await expect(
    takeInstallLock(install, {
      afterMkdir: () => mkdir(path.join(install, "install.lock", "token")),
    }),
  ).rejects.toThrow(/EISDIR/);
  expect(await lockEntries()).toEqual([]);
});

it("removes nothing without an absolute home", async () => {
  for (const relative of ["", ".dev"]) {
    const result = await remoteUninstall({
      env,
      home: relative,
      stateDir,
      deleteReviews: true,
    });

    expect(result).toMatchObject({ ok: false });
  }

  expect(
    await remoteUninstall({
      env,
      home,
      stateDir: ".dev",
      deleteReviews: true,
    }),
  ).toMatchObject({ ok: false });
  expect(existsSync(install)).toBe(true);
  expect(await homeEntries()).toContain("review-api.db");
});

it("refuses while an install holds the lock", async () => {
  await mkdir(path.join(install, "install.lock"));
  await writeFile(path.join(install, "install.lock", "owner"), "laptop\n");
  await writeFile(
    path.join(install, "install.lock", "started"),
    `${Math.floor(Date.now() / 1000)}\n`,
  );

  const result = await remoteUninstall({
    env,
    home,
    stateDir,
    deleteReviews: false,
  });

  expect(result).toMatchObject({
    ok: false,
    reason: expect.stringContaining("laptop"),
  });
  expect(existsSync(path.join(install, "versions"))).toBe(true);
});

async function cli(argv: string[], change: NodeJS.ProcessEnv = {}) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk) => (out += String(chunk)));
  stderr.on("data", (chunk) => (err += String(chunk)));

  const code = await runReviewCli({
    argv,
    stdout,
    stderr,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      DEV_REVIEW_HOME: stateDir,
      DEV_FAST_REVIEW_TELEMETRY_DISABLED: "1",
      DEV_FAST_REVIEW_CLI_NO_DELEGATE: "1",
      ...change,
    },
  });

  return { code, stdout: out, stderr: err };
}

it("in --json mode with neither flag refuses and removes nothing", async () => {
  const result = await cli(["remote", "uninstall", "--json"]);

  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toEqual({
    event: "remote.uninstall",
    ok: false,
    reason: expect.stringContaining("--keep-reviews or --delete-reviews"),
  });
  expect(existsSync(install)).toBe(true);
  expect(existsSync(wrapper)).toBe(true);
});

it("with HOME empty refuses and removes nothing", async () => {
  const result = await cli(
    ["remote", "uninstall", "--keep-reviews", "--json"],
    {
      HOME: "",
    },
  );

  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toEqual({
    event: "remote.uninstall",
    ok: false,
    reason:
      "HOME is not set; Whiteboard removes nothing without an absolute home.",
  });
  expect(existsSync(install)).toBe(true);
});

it("prints one JSON line on success", async () => {
  const result = await cli(["remote", "uninstall", "--keep-reviews", "--json"]);

  expect(result).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(result.stdout)).toEqual({
    event: "remote.uninstall",
    ok: true,
    removed: [install, wrapper],
    keptReviews: true,
  });
});

it("with DEV_REVIEW_HOME elsewhere removes the install there, with the VS Code server's data, and leaves ~/.dev alone", async () => {
  const moved = path.join(root, "moved");
  const movedInstall = path.join(moved, "whiteboard-remote");
  const { serverDataDir } = remoteServerPaths({ DEV_REVIEW_HOME: moved });
  await mkdir(path.join(movedInstall, "versions", "0.1.6"), {
    recursive: true,
  });
  await mkdir(serverDataDir, { recursive: true });
  await writeFile(path.join(serverDataDir, "connection-token"), "token");

  const result = await cli(
    ["remote", "uninstall", "--keep-reviews", "--json"],
    {
      DEV_REVIEW_HOME: moved,
    },
  );

  expect(result).toMatchObject({ code: 0, stderr: "" });
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: true,
    removed: [movedInstall, wrapper],
  });
  expect(existsSync(serverDataDir)).toBe(false);
  expect(existsSync(install)).toBe(true);
});

it("stops the VS Code server with its extension host, and a detached extension install, then removes the install", async () => {
  const pkg = path.join(
    install,
    "versions",
    "0.1.6",
    "node_modules",
    "@dev.fast",
    "whiteboard",
  );

  const extensionHost = path.join(
    install,
    "extensions",
    "ms-python.python",
    "server.js",
  );

  const server = await groupFrom(
    path.join(pkg, "vscode-server", "out", "server-main.js"),
    extensionHost,
  );

  const ensure = await groupFrom(path.join(pkg, "dist", "cli.js"));
  await languageServerRecords(server, ensure);

  for (let i = 0; i < 100 && !runningWith(extensionHost); i++)
    await new Promise((resolve) => setTimeout(resolve, 50));

  const result = await remoteUninstall({
    env,
    home,
    stateDir,
    deleteReviews: false,
  });

  expect(result).toMatchObject({ ok: true, removed: [install, wrapper] });
  expect(runningWith(`${install}/`)).toBe(false);
});

it("refuses a server the user started before it stops anything, naming only that server", async () => {
  const server = await groupFrom(
    path.join(
      install,
      "versions",
      "0.1.6",
      "vscode-server",
      "out",
      "server-main.js",
    ),
    path.join(install, "extensions", "ms-python.python", "server.js"),
  );

  await languageServerRecords(server);

  const user = await runningFrom(
    path.join(install, "versions", "0.1.6", "cli.js"),
  );

  await serverRecord(user.pid!, "user");

  const result = await remoteUninstall({
    env,
    home,
    stateDir,
    deleteReviews: false,
  });

  expect(result).toMatchObject({
    ok: false,
    reason: expect.stringContaining(
      `A Whiteboard server you started (process ${user.pid})`,
    ),
  });
  expect((result as { reason: string }).reason).not.toContain(`${server}`);
  expect(alive(user.pid!)).toBe(true);
  expect(alive(server)).toBe(true);
  expect(existsSync(path.join(install, "versions"))).toBe(true);
});

it("removes nothing under a DEV_REVIEW_HOME it cannot normalise, as the probe refuses it", async () => {
  for (const moved of [
    "relative/home",
    `${root}/a/../b`,
    `${root}//b`,
    `//${root}`,
    `${root}/a\nb`,
    `${root}/a\u001bb`,
  ]) {
    const result = await remoteUninstall({
      env: { DEV_REVIEW_HOME: moved },
      home,
      stateDir,
      deleteReviews: false,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not an absolute, normalised path"),
    });
  }

  expect(existsSync(install)).toBe(true);
});
