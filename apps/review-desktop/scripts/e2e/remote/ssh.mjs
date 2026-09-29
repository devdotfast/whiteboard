/** The run's ssh_config, and `ssh -L` tunnels. */
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import path from "node:path";

import { run, sleep } from "./exec.mjs";

/** One `Host` block of the run's ssh_config. */
export function sshConfigBlock(runDir, host) {
  return [
    `Host ${host.alias}`,
    `  HostName ${host.hostName}`,
    `  Port ${host.port}`,
    `  User ${host.user}`,
    `  IdentityFile ${runDir}/id_ed25519`,
    "  IdentitiesOnly yes",
    "  IdentityAgent none",
    `  UserKnownHostsFile ${runDir}/known_hosts`,
    "  GlobalKnownHostsFile /dev/null",
    "  StrictHostKeyChecking accept-new",
    ...(host.jump ? [`  ProxyJump ${host.jump}`] : []),
    "",
  ].join("\n");
}

export const sshArgs = (runState, host) => [
  "-F",
  `${runState.dir}/ssh_config`,
  host.alias,
];

/** Retries `command` on the host until it succeeds. */
export async function waitForSsh(
  runState,
  host,
  attempts,
  command = "true",
  options = [],
) {
  for (let i = 0; ; i++) {
    try {
      return await run("ssh", [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        ...options,
        ...sshArgs(runState, host),
        command,
      ]);
    } catch (error) {
      if (i >= attempts) throw error;

      await sleep(2000);
    }
  }
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();

      server.close(() => resolve(port));
    });
  });

const accepts = (port) =>
  new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");

    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

export async function forward(runState, host, name, remotePort) {
  const localPort = await freePort();
  const log = `${runState.dir}/forward-${localPort}.log`;

  const child = spawn(
    "ssh",
    [
      "-N",
      "-o",
      "ExitOnForwardFailure=yes",
      "-L",
      `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
      ...sshArgs(runState, host),
    ],
    { detached: true, stdio: ["ignore", "ignore", openSync(log, "a")] },
  );

  let exited = false;

  child.once("exit", () => (exited = true));
  runState.state.forwards.push({
    host: name,
    pid: child.pid,
    localPort,
    remotePort,
  });
  await runState.save();

  for (let i = 0; !(await accepts(localPort)); i++) {
    if (exited || i > 60)
      throw new Error(
        `forward to ${host.alias}:${remotePort} failed: ${await readFile(log, "utf8")}`,
      );

    await sleep(250);
  }

  child.unref();
  console.log(localPort);
}

/** `ssh` processes whose command line matches, as `[pid, args]`. */
export async function sshProcesses(match) {
  return (await run("ps", ["-axo", "pid=,args="]))
    .split("\n")
    .map((line) => line.trim().match(/^(\d+) (\S+)(.*)$/))
    .filter((m) => m && path.basename(m[2]) === "ssh" && match(m[2] + m[3]))
    .map((m) => [Number(m[1]), m[2] + m[3]]);
}

/** Ends the run's `ssh` processes: all of them, or only those for `name`. */
export async function stopTunnels(runState, name) {
  const { state } = runState;
  const alias = name && state.hosts[name].alias;

  for (const [pid, args] of await sshProcesses((args) =>
    args.includes(`${runState.dir}/`),
  ))
    if (!alias || args.endsWith(` ${alias}`) || args.includes(` ${alias} `))
      process.kill(pid, "SIGTERM");

  state.forwards = state.forwards.filter((f) => name && f.host !== name);
  await runState.save();
}
