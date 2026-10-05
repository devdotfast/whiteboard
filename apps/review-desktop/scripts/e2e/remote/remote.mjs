/** Disposable SSH remotes for live checks, in Docker or on AWS; see ../TESTING.md. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { awsUp } from "./aws-hosts.mjs";
import { containerOf, install, packStaged, up } from "./docker-hosts.mjs";
import { docker, inherit } from "./exec.mjs";
import { down, downEveryRun, downRun } from "./removal.mjs";
import { checkName, hostOf, openRun } from "./run-state.mjs";
import { forward, sshArgs } from "./ssh.mjs";
import { leftovers } from "./verify.mjs";

const usage = `usage: remote.mjs <command>
  up <name> [--platform linux/amd64|linux/arm64] [--image <image>] [--node 24|20|none]
            [--auth key|password] [--banner] [--shell bash|fish] [--jump <name>]
            [--sealed] [--delay-ms <n>] [--no-forwarding] [--port <n>]
  install <name> [--version <v>] [--runtime <remote runtime dir>]
  pack --out <file.tgz> [--version <v>] [--runtime <remote runtime dir>]
  ssh <name> -- <command...>
  forward <name> <remote port>
  pause <name> | resume <name> | logs <name>
  aws-up <name> [--arch x64|arm64] [--sealed]
  down <name> | down --all | down --every-run
  verify-clean

The run is WB_TEST_RUN, else the only one in /tmp/wbt.*.`;

const commandsWithoutName = new Set(["verify-clean", "down", "pack"]);

async function main(argv) {
  const split = argv.indexOf("--");
  const remoteCommand = split < 0 ? [] : argv.slice(split + 1);

  const { values, positionals } = parseArgs({
    args: split < 0 ? argv : argv.slice(0, split),
    allowPositionals: true,
    options: {
      platform: { type: "string" },
      image: { type: "string" },
      node: { type: "string" },
      auth: { type: "string" },
      banner: { type: "boolean" },
      shell: { type: "string" },
      jump: { type: "string" },
      sealed: { type: "boolean" },
      "delay-ms": { type: "string" },
      "no-forwarding": { type: "boolean" },
      port: { type: "string" },
      version: { type: "string" },
      runtime: { type: "string" },
      out: { type: "string" },
      arch: { type: "string" },
      all: { type: "boolean" },
      "every-run": { type: "boolean" },
    },
  });

  const [command, name, arg] = positionals;

  if (process.env.WB_TEST_RUN)
    checkName("WB_TEST_RUN", process.env.WB_TEST_RUN);

  if (name !== undefined || (command && !commandsWithoutName.has(command)))
    checkName("host name", name);

  if (values.jump !== undefined) checkName("--jump", values.jump);

  switch (command) {
    case "up":
      return up(await openRun(true), name, values);
    case "aws-up":
      return awsUp(await openRun(true), name, values);
    case "install":
      return install(await openRun(false), name, {
        version: values.version,
        runtime: values.runtime && path.resolve(values.runtime),
      });
    case "pack":
      if (!values.out) throw new Error("pack needs --out <file.tgz>");

      return console.log(
        await packStaged(path.resolve(values.out), {
          version: values.version,
          runtime: values.runtime && path.resolve(values.runtime),
        }),
      );
    case "ssh": {
      const runState = await openRun(false);

      return inherit("ssh", [
        ...sshArgs(runState, hostOf(runState, name)),
        ...remoteCommand,
      ]);
    }

    case "forward": {
      const runState = await openRun(false);

      return forward(runState, hostOf(runState, name), name, Number(arg));
    }

    case "pause":
    case "resume": {
      const runState = await openRun(false);

      await docker(
        command === "pause" ? "pause" : "unpause",
        containerOf(runState, name).container,
      );

      return 0;
    }

    case "logs": {
      const runState = await openRun(false);

      return inherit("docker", ["logs", containerOf(runState, name).container]);
    }

    case "down":
      if (values["every-run"]) return downEveryRun();

      if (values.all) return downRun();

      if (!name) throw new Error("down needs a name, --all or --every-run");

      return down(await openRun(false), name);
    case "verify-clean": {
      const found = await leftovers();

      for (const item of found) console.log(item);

      if (!found.length)
        console.log("clean: nothing named or tagged wb-test remains");

      return found.length ? 1 : 0;
    }

    default:
      console.error(usage);

      return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  try {
    const code = await main(process.argv.slice(2));

    process.exitCode = Number.isInteger(code) ? code : 0;
  } catch (error) {
    console.error(`remote.mjs: ${error.stderr?.trim() || error.message}`);
    process.exitCode = 1;
  }
