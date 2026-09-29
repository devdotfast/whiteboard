/** `down`: removes what a run made, found through state.json and the run's label and tag. */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

import {
  removeAwsRunResources,
  removeInstances,
  usesAws,
} from "./aws-hosts.mjs";
import { addOnce, docker } from "./exec.mjs";
import { hostOf, openRun, runDirOf, runIds, selectRun } from "./run-state.mjs";
import { stopTunnels } from "./ssh.mjs";

/** Removes `names`' containers, or with none given every container of the run. */
async function removeContainers(runState, names = []) {
  const { state } = runState;
  const containers = names.map((n) => state.hosts[n].container);

  if (!names.length) {
    containers.push(...state.containers);

    for (const c of (
      await docker(
        "ps",
        "-a",
        "--filter",
        `label=wb-test-run=${runState.id}`,
        "--format",
        "{{.Names}}",
      )
    ).split("\n"))
      if (c) addOnce(containers, c);
  }

  if (containers.length) await docker("rm", "-f", ...containers);

  state.containers = state.containers.filter((c) => !containers.includes(c));

  for (const name of names) delete state.hosts[name];

  await runState.save();
}

async function removeEach(runState, key, command, missing) {
  const { state } = runState;

  for (const item of state[key]) {
    await docker(...command, item).catch((error) => {
      if (!missing.test(error.stderr)) throw error;
    });
    state[key] = state[key].filter((i) => i !== item);
    await runState.save();
  }
}

/** Removes one host, or the whole run. Every step runs even when another fails; instances go first because they cost money. */
export async function down(runState, name) {
  const { state } = runState;

  if (name) {
    const host = hostOf(runState, name);

    await stopTunnels(runState, name);
    await (host.kind === "docker"
      ? removeContainers(runState, [name])
      : removeInstances(runState, [name], false));

    return;
  }

  const errors = [];

  const step = (label, action) =>
    action().catch((error) =>
      errors.push(`${label}: ${error.stderr?.trim() || error.message}`),
    );

  const awsNames = Object.keys(state.hosts).filter(
    (n) => state.hosts[n].kind === "aws",
  );

  await step("tunnels", () => stopTunnels(runState));

  if (usesAws(runState))
    await step("instances", () => removeInstances(runState, awsNames, true));

  const usesDocker =
    state.containers.length || state.networks.length || state.images.length;

  if (usesDocker) {
    await step("containers", () => removeContainers(runState));
    await step("networks", () =>
      removeEach(runState, "networks", ["network", "rm"], /not found/),
    );
    await step("images", () =>
      removeEach(runState, "images", ["rmi"], /No such image/),
    );
  }

  if (state.aws.keyPair || Object.keys(state.aws.securityGroups).length)
    await step("AWS key pair and security groups", () =>
      removeAwsRunResources(runState),
    );

  if (errors.length)
    throw new Error(
      `kept ${runState.dir} after errors:\n  ${errors.join("\n  ")}`,
    );

  await rm(runState.dir, { recursive: true, force: true });
  console.log(`run ${runState.id}: removed`);
}

/** `down --all`: the selected run. */
export async function downRun() {
  const id = await selectRun(false);

  if (!id || !existsSync(runDirOf(id))) {
    console.log("nothing to remove");

    return 0;
  }

  await down(await openRun(false, id));

  return 0;
}

/** `down --every-run`: every run directory, for recovery after a crash. */
export async function downEveryRun() {
  const ids = await runIds();
  let failed = false;

  for (const id of ids)
    try {
      await down(await openRun(false, id));
    } catch (error) {
      failed = true;
      console.error(`run ${id}: ${error.message}`);
    }

  if (!ids.length) console.log("nothing to remove");

  return failed ? 1 : 0;
}
