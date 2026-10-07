/** Hosts on AWS: `aws-up`, and removing a run's instances, key pair and security groups. */
import { addOnce, aws, run, sleep } from "./exec.mjs";
import { installFakeAgent, waitForSsh } from "./ssh.mjs";

const maxInstances = 2;

const instanceTypes = { x64: "t3.small", arm64: "t4g.small" };

const ubuntuImage = (arch) =>
  `/aws/service/canonical/ubuntu/server/22.04/stable/current/${arch === "x64" ? "amd64" : arch}/hvm/ebs-gp2/ami-id`;

const liveStates = "pending,running,shutting-down,stopping,stopped";

export async function requireAwsSession() {
  try {
    await aws("sts", "get-caller-identity");
  } catch {
    throw new Error("the AWS session is not valid: run `aws sso login`");
  }
}

const tagged = (resourceType, runState, name) =>
  JSON.stringify([
    {
      ResourceType: resourceType,
      Tags: [
        { Key: "wb-test", Value: "1" },
        { Key: "wb-test-run", Value: runState.id },
        { Key: "Name", Value: name },
      ],
    },
  ]);

/** Ids of instances matching `filter` that are not terminated. Unknown ids in a filter match nothing, unlike `--instance-ids`. */
export async function liveInstances(filter) {
  return aws(
    "ec2",
    "describe-instances",
    "--filters",
    filter,
    `Name=instance-state-name,Values=${liveStates}`,
    "--query",
    "Reservations[].Instances[].InstanceId",
  );
}

const describeGroup = async (groupId) =>
  (await aws("ec2", "describe-security-groups", "--group-ids", groupId))
    .SecurityGroups[0];

/** The run's group, recorded as ready only once its rules are in place: SSH from this laptop, and no egress when sealed. */
async function securityGroup(runState, sealed) {
  const groups = runState.state.aws.securityGroups;
  const name = `wb-test-${runState.id}${sealed ? "-sealed" : ""}`;

  if (groups[name]?.ready) return groups[name].id;

  if (!groups[name]) {
    const { GroupId } = await aws(
      "ec2",
      "create-security-group",
      "--group-name",
      name,
      "--description",
      "wb-test: SSH from the laptop only",
      "--tag-specifications",
      tagged("security-group", runState, name),
    );

    groups[name] = { id: GroupId, ready: false };
    await runState.save();
  }

  const group = groups[name];

  const address = (
    await (await fetch("https://checkip.amazonaws.com")).text()
  ).trim();

  await aws(
    "ec2",
    "authorize-security-group-ingress",
    "--group-id",
    group.id,
    "--protocol",
    "tcp",
    "--port",
    "22",
    "--cidr",
    `${address}/32`,
  ).catch((error) => {
    if (!/InvalidPermission\.Duplicate/.test(error.stderr)) throw error;
  });

  if (sealed) {
    const egress = (await describeGroup(group.id)).IpPermissionsEgress;

    if (egress.length)
      await aws(
        "ec2",
        "revoke-security-group-egress",
        "--group-id",
        group.id,
        "--ip-permissions",
        JSON.stringify(egress),
      );

    const left = (await describeGroup(group.id)).IpPermissionsEgress;

    if (left.length)
      throw new Error(`${name} still allows egress: ${JSON.stringify(left)}`);
  }

  group.ready = true;
  await runState.save();

  return group.id;
}

export async function awsUp(runState, name, options) {
  const { state } = runState;
  const arch = options.arch ?? "x64";

  if (!instanceTypes[arch]) throw new Error(`--arch ${arch}`);

  if (state.hosts[name]) throw new Error(`host ${name} already exists`);

  await requireAwsSession();

  const live = await liveInstances("Name=tag:wb-test,Values=1");

  if (live.length >= maxInstances)
    throw new Error(
      `${live.length} wb-test instances already exist: ${live.join(", ")}`,
    );

  const keyPair = `wb-test-${runState.id}`;

  if (!state.aws.keyPair) {
    state.aws.keyPair = keyPair;
    await runState.save();
    await aws(
      "ec2",
      "import-key-pair",
      "--key-name",
      keyPair,
      "--public-key-material",
      `fileb://${runState.dir}/id_ed25519.pub`,
      "--tag-specifications",
      tagged("key-pair", runState, keyPair),
    );
  }

  const groupId = await securityGroup(runState, options.sealed);

  const imageId = await run("aws", [
    "ssm",
    "get-parameter",
    "--name",
    ubuntuImage(arch),
    "--query",
    "Parameter.Value",
    "--output",
    "text",
  ]);

  const alias = `wb-test-${name}`;

  const reservation = await aws(
    "ec2",
    "run-instances",
    "--image-id",
    imageId,
    "--instance-type",
    instanceTypes[arch],
    "--key-name",
    keyPair,
    "--security-group-ids",
    groupId,
    "--instance-initiated-shutdown-behavior",
    "terminate",
    "--user-data",
    "#!/bin/sh\nshutdown -h +180\n",
    "--tag-specifications",
    tagged("instance", runState, alias),
  );

  const host = {
    kind: "aws",
    alias,
    instanceId: reservation.Instances[0].InstanceId,
    user: "ubuntu",
    port: 22,
  };

  state.hosts[name] = host;
  await runState.save();
  await run("aws", [
    "ec2",
    "wait",
    "instance-running",
    "--instance-ids",
    host.instanceId,
  ]);
  host.hostName = await run("aws", [
    "ec2",
    "describe-instances",
    "--instance-ids",
    host.instanceId,
    "--query",
    "Reservations[0].Instances[0].PublicIpAddress",
    "--output",
    "text",
  ]);
  await runState.save();
  await waitForSsh(runState, host, 90);
  // The start-up script runs after sshd starts; wait until it has scheduled the shutdown.
  await waitForSsh(
    runState,
    host,
    60,
    "test -f /run/systemd/shutdown/scheduled",
  );

  if (options["fake-agent"]) await installFakeAgent(runState, host);

  console.log(alias);
}

export const usesAws = ({ state }) =>
  Boolean(
    state.aws.keyPair ||
    Object.keys(state.aws.securityGroups).length ||
    Object.values(state.hosts).some((h) => h.kind === "aws"),
  );

/**
 * Terminates the instances of `names` that still exist and, with `all`, every
 * instance tagged with the run, also those a crash left out of state.json.
 */
export async function removeInstances(runState, names, all) {
  const { state } = runState;
  const recorded = names.map((n) => state.hosts[n].instanceId).filter(Boolean);

  await requireAwsSession();

  const ids = recorded.length
    ? await liveInstances(`Name=instance-id,Values=${recorded.join(",")}`)
    : [];

  if (all)
    for (const id of await liveInstances(
      `Name=tag:wb-test-run,Values=${runState.id}`,
    ))
      addOnce(ids, id);

  if (ids.length) {
    await aws("ec2", "terminate-instances", "--instance-ids", ...ids);
    await run("aws", [
      "ec2",
      "wait",
      "instance-terminated",
      "--instance-ids",
      ...ids,
    ]);
  }

  for (const name of names) delete state.hosts[name];

  await runState.save();
}

export async function removeAwsRunResources(runState) {
  const { aws: awsState } = runState.state;

  if (awsState.keyPair) {
    await aws("ec2", "delete-key-pair", "--key-name", awsState.keyPair);
    delete awsState.keyPair;
    await runState.save();
  }

  for (const [name, { id }] of Object.entries(awsState.securityGroups)) {
    // A terminated instance's interface can hold the group for a little while.
    for (let i = 0; ; i++) {
      try {
        await aws("ec2", "delete-security-group", "--group-id", id);
        break;
      } catch (error) {
        if (/InvalidGroup\.NotFound/.test(error.stderr)) break;

        if (i >= 20) throw error;

        await sleep(5000);
      }
    }

    delete awsState.securityGroups[name];
    await runState.save();
  }
}
