/** Run directories: /tmp/wbt.<run id>/ with the key pair, ssh_config, known_hosts and state.json. */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";

import { run } from "./exec.mjs";
import { sshConfigBlock } from "./ssh.mjs";

const safeName = /^[a-z0-9-]+$/;

/** Run ids and host names reach `rm -r`, AWS filters and ssh_config, so they are refused unless plain. */
export function checkName(kind, value) {
  if (!safeName.test(value ?? ""))
    throw new Error(
      `${kind} must match [a-z0-9-]+, got ${JSON.stringify(value)}`,
    );

  return value;
}

export const runDirOf = (id) => `/tmp/wbt.${checkName("run id", id)}`;

export async function runIds() {
  return (await readdir("/tmp"))
    .filter((f) => f.startsWith("wbt.") && safeName.test(f.slice(4)))
    .map((f) => f.slice(4));
}

/**
 * The run WB_TEST_RUN names, else the only one there is. Several runs and no
 * WB_TEST_RUN is an error unless `create`, which then starts a new run.
 */
export async function selectRun(create) {
  const named = process.env.WB_TEST_RUN;

  if (named) return checkName("WB_TEST_RUN", named);

  const ids = await runIds();

  if (ids.length === 1) {
    console.error(`using run ${ids[0]}`);

    return ids[0];
  }

  if (ids.length > 1 && !create)
    throw new Error(`several runs exist (${ids.join(", ")}); set WB_TEST_RUN`);
}

/** Opens the selected run, or `id`; `create` starts a new one when none is selected. */
export async function openRun(create, id) {
  id ??= await selectRun(create);

  if (!id) {
    if (!create) throw new Error("no run exists; start one with up or aws-up");

    id = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  }

  const dir = runDirOf(id);

  if (!existsSync(dir)) {
    if (!create) throw new Error(`no run directory ${dir}`);

    await mkdir(dir, { mode: 0o700 });
    await run("ssh-keygen", [
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      `wb-test-${id}`,
      "-f",
      `${dir}/id_ed25519`,
    ]);
    await writeFile(`${dir}/password`, randomBytes(12).toString("base64url"), {
      mode: 0o600,
    });
    console.error(`run ${id}: export WB_TEST_RUN=${id} to share it`);
  }

  const text = await readFile(`${dir}/state.json`, "utf8").catch(() => "");

  const state = {
    hosts: {},
    forwards: [],
    containers: [],
    networks: [],
    images: [],
    aws: { securityGroups: {} },
  };

  if (text.trim()) Object.assign(state, JSON.parse(text));

  const save = async () => {
    await writeFile(
      `${dir}/state.json.tmp`,
      `${JSON.stringify(state, null, 2)}\n`,
    );
    await rename(`${dir}/state.json.tmp`, `${dir}/state.json`);
    await writeFile(
      `${dir}/ssh_config`,
      Object.values(state.hosts)
        .filter((h) => h.hostName)
        .map((h) => sshConfigBlock(dir, h))
        .join(""),
    );
  };

  return { id, dir, state, save };
}

export function hostOf(runState, name) {
  const host = runState.state.hosts[name];

  if (!host) throw new Error(`no host ${name} in run ${runState.id}`);

  return host;
}
