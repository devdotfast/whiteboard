/** Disposable SSH remotes for live checks, in Docker or on AWS; see ../TESTING.md. */
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, openSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { connect, createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const exec = promisify(execFile);

const imageDir = path.join(import.meta.dirname, "image");

const packageDir = path.resolve(
  import.meta.dirname,
  "../../../../../packages/review",
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const maxInstances = 2;

const instanceTypes = { x64: "t3.small", arm64: "t4g.small" };

const ubuntuImage = (arch) =>
  `/aws/service/canonical/ubuntu/server/22.04/stable/current/${arch === "x64" ? "amd64" : arch}/hvm/ebs-gp2/ami-id`;

const liveStates = "pending,running,shutting-down,stopping,stopped";

async function run(command, args, options = {}) {
  const { stdout } = await exec(command, args, {
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });

  return stdout.trim();
}

const docker = (...args) => run("docker", args);

/** Runs a command on this terminal; resolves to its exit code. */
const inherit = (command, args) =>
  new Promise((resolve) =>
    spawn(command, args, { stdio: "inherit" }).once("exit", (code) =>
      resolve(code ?? 1),
    ),
  );

const aws = async (...args) =>
  JSON.parse((await run("aws", [...args, "--output", "json"])) || "null");

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

// Runs

const runDirOf = (id) => `/tmp/wbt.${id}`;

async function runIds() {
  return (await readdir("/tmp"))
    .filter((f) => f.startsWith("wbt."))
    .map((f) => f.slice(4));
}

/** The run named by WB_TEST_RUN, else the only one; `create` makes one when neither applies. */
async function openRun(create, id = process.env.WB_TEST_RUN) {
  if (!id) {
    const ids = await runIds();

    if (ids.length === 1) id = ids[0];
    else if (create)
      id = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
    else
      throw new Error(
        ids.length
          ? `several runs exist (${ids.join(", ")}); set WB_TEST_RUN`
          : "no run exists; start one with up or aws-up",
      );
  }

  const dir = runDirOf(id);

  if (!existsSync(dir)) {
    if (!create) throw new Error(`no run directory ${dir}`);

    await mkdir(dir);
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
    await writeFile(`${dir}/password`, randomBytes(12).toString("base64url"));
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

const addOnce = (list, item) => list.includes(item) || list.push(item);

function hostOf(runState, name) {
  const host = runState.state.hosts[name];

  if (!host) throw new Error(`no host ${name} in run ${runState.id}`);

  return host;
}

const sshArgs = (runState, host) => [
  "-F",
  `${runState.dir}/ssh_config`,
  host.alias,
];

/** Retries `command` on the host until it succeeds. */
async function waitForSsh(runState, host, attempts, command = "true") {
  for (let i = 0; ; i++) {
    try {
      return await run("ssh", [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        ...sshArgs(runState, host),
        command,
      ]);
    } catch (error) {
      if (i >= attempts) throw error;

      await sleep(2000);
    }
  }
}

// Docker

async function buildImage(runState, { platform, image, node, shell }) {
  const hash = createHash("sha256");

  for (const file of ["Dockerfile", "setup.sh", "start.sh"])
    hash.update(await readFile(path.join(imageDir, file)));

  hash.update(JSON.stringify([platform, image, node, shell]));

  const tag = `wb-test-image:${hash.digest("hex").slice(0, 12)}`;

  addOnce(runState.state.images, tag);
  await runState.save();
  await docker(
    "build",
    "-q",
    ...(platform ? ["--platform", platform] : []),
    "--build-arg",
    `BASE=${image}`,
    "--build-arg",
    `NODE=${node}`,
    "--build-arg",
    `LOGIN_SHELL=${shell}`,
    "-t",
    tag,
    imageDir,
  );

  return tag;
}

/** Runs one root command in a throwaway container with NET_ADMIN, in `network`'s namespace. */
const netAdmin = (image, network, script) =>
  docker(
    "run",
    "--rm",
    "--network",
    network,
    "--cap-add",
    "NET_ADMIN",
    "--entrypoint",
    "sh",
    image,
    "-c",
    script,
  );

async function up(runState, name, options) {
  const { state } = runState;

  if (state.hosts[name]) throw new Error(`host ${name} already exists`);

  const jump = options.jump && hostOf(runState, options.jump);
  const auth = options.auth ?? "key";

  if (!["key", "password"].includes(auth)) throw new Error(`--auth ${auth}`);

  const image = await buildImage(runState, {
    platform: options.platform,
    image: options.image ?? "ubuntu:22.04",
    node: options.node ?? "24",
    shell: options.shell ?? "bash",
  });

  const network = `wb-test-${runState.id}`;

  if (!state.networks.includes(network)) {
    state.networks.push(network);
    await runState.save();
    await docker(
      "network",
      "create",
      "--label",
      `wb-test-run=${runState.id}`,
      network,
    );
  }

  const alias = `wb-test-${name}`;
  const container = `wb-test-${runState.id}-${name}`;
  const host = { kind: "docker", alias, container, user: "dev" };

  state.hosts[name] = host;
  addOnce(state.containers, container);
  await runState.save();

  const env = {
    WB_PUBLIC_KEY:
      auth === "key"
        ? await readFile(`${runState.dir}/id_ed25519.pub`, "utf8")
        : "",
    WB_PASSWORD:
      auth === "password"
        ? await readFile(`${runState.dir}/password`, "utf8")
        : "",
    WB_BANNER: options.banner ? "1" : "0",
    WB_FORWARDING: options["no-forwarding"] ? "0" : "1",
  };

  // Values pass through the environment, so a password never shows in `ps`.
  await run(
    "docker",
    [
      "run",
      "-d",
      "--name",
      container,
      "--hostname",
      alias,
      "--network",
      network,
      "--network-alias",
      alias,
      "--label",
      `wb-test-run=${runState.id}`,
      ...(options.platform ? ["--platform", options.platform] : []),
      ...(jump ? [] : ["-p", "127.0.0.1::22"]),
      ...Object.keys(env).flatMap((key) => ["-e", key]),
      image,
    ],
    { env: { ...process.env, ...env } },
  );

  if (options.sealed) {
    await netAdmin(image, `container:${container}`, "ip route del default");

    const reached = await docker(
      "exec",
      container,
      "curl",
      "-sS",
      "-m",
      "5",
      "-o",
      "/dev/null",
      "https://example.com",
    ).then(
      () => true,
      () => false,
    );

    if (reached) throw new Error(`${alias} still reaches the internet`);
  }

  const delay = Number(options["delay-ms"] ?? 0);

  if (delay) {
    // netem only delays egress: the container's for replies, and its host-side veth for requests.
    const link = await docker(
      "exec",
      container,
      "cat",
      "/sys/class/net/eth0/iflink",
    );

    await netAdmin(
      image,
      `container:${container}`,
      `tc qdisc add dev eth0 root netem delay ${delay}ms`,
    );
    await netAdmin(
      image,
      "host",
      `for d in /sys/class/net/*; do [ "$(cat $d/ifindex 2>/dev/null)" = ${link} ] && exec tc qdisc add dev \${d##*/} root netem delay ${delay}ms; done; exit 1`,
    );
  }

  if (jump)
    Object.assign(host, { hostName: alias, port: 22, jump: jump.alias });
  else {
    const published = await docker("port", container, "22/tcp");

    Object.assign(host, {
      hostName: "127.0.0.1",
      port: Number(published.split("\n")[0].split(":").pop()),
    });
  }

  await runState.save();

  // sshd logs to stderr, which `docker logs` keeps as stderr.
  const sshdLog = () =>
    exec("docker", ["logs", container]).then(
      ({ stderr }) => stderr,
      () => "",
    );

  for (let i = 0; !(await sshdLog()).includes("Server listening"); i++) {
    if (i > 40) throw new Error(`sshd did not start in ${container}`);

    await sleep(250);
  }

  if (auth === "key") await waitForSsh(runState, host, 15);

  console.log(alias);
}

function containerOf(runState, name) {
  const host = hostOf(runState, name);

  if (host.kind !== "docker") throw new Error(`${name} is not a container`);

  return host.container;
}

async function install(runState, name, version) {
  const container = containerOf(runState, name);
  const scratch = await mkdtemp(`${runState.dir}/pack-`);

  try {
    await run("pnpm", [
      "--dir",
      packageDir,
      "pack",
      "--pack-destination",
      scratch,
    ]);

    const [packed] = (await readdir(scratch)).filter((f) => f.endsWith(".tgz"));
    let tarball = path.join(scratch, packed);

    await run("tar", ["-xzf", tarball, "-C", scratch]);

    const manifestPath = path.join(scratch, "package/package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    if (version) {
      manifest.version = version;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      tarball = path.join(scratch, "stamped.tgz");
      await run("tar", ["-czf", tarball, "-C", scratch, "package"]);
    }

    await docker("cp", tarball, `${container}:/tmp/wb-test-package.tgz`);
    await docker(
      "exec",
      container,
      "npm",
      "install",
      "-g",
      "--no-audit",
      "--no-fund",
      "/tmp/wb-test-package.tgz",
    );
    await docker("exec", container, "rm", "/tmp/wb-test-package.tgz");
    console.log(`${manifest.name}@${manifest.version}`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

// Tunnels

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

async function forward(runState, name, remotePort) {
  const host = hostOf(runState, name);
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
async function sshProcesses(match) {
  return (await run("ps", ["-axo", "pid=,args="]))
    .split("\n")
    .map((line) => line.trim().match(/^(\d+) (\S+)(.*)$/))
    .filter((m) => m && path.basename(m[2]) === "ssh" && match(m[2] + m[3]))
    .map((m) => [Number(m[1]), m[2] + m[3]]);
}

async function stopTunnels(runState, name) {
  const { state } = runState;

  for (const [pid, args] of await sshProcesses((args) =>
    args.includes(`${runState.dir}/`),
  ))
    if (
      !name ||
      args.endsWith(` ${state.hosts[name].alias}`) ||
      args.includes(` ${state.hosts[name].alias} `)
    )
      process.kill(pid, "SIGTERM");

  state.forwards = state.forwards.filter((f) => name && f.host !== name);
  await runState.save();
}

// AWS

async function requireAwsSession() {
  try {
    await aws("sts", "get-caller-identity");
  } catch {
    throw new Error("the AWS session is not valid: run `aws sso login`");
  }
}

const awsTags = (runState, name) => [
  { Key: "wb-test", Value: "1" },
  { Key: "wb-test-run", Value: runState.id },
  { Key: "Name", Value: name },
];

const tagged = (resourceType, runState, name) =>
  JSON.stringify([
    { ResourceType: resourceType, Tags: awsTags(runState, name) },
  ]);

async function liveInstances(filter) {
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

async function securityGroup(runState, sealed) {
  const { aws: awsState } = runState.state;
  const name = `wb-test-${runState.id}${sealed ? "-sealed" : ""}`;

  if (awsState.securityGroups[name]) return awsState.securityGroups[name];

  const address = (
    await (await fetch("https://checkip.amazonaws.com")).text()
  ).trim();

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

  awsState.securityGroups[name] = GroupId;
  await runState.save();
  await aws(
    "ec2",
    "authorize-security-group-ingress",
    "--group-id",
    GroupId,
    "--protocol",
    "tcp",
    "--port",
    "22",
    "--cidr",
    `${address}/32`,
  );

  if (sealed)
    await aws(
      "ec2",
      "revoke-security-group-egress",
      "--group-id",
      GroupId,
      "--ip-permissions",
      JSON.stringify([
        { IpProtocol: "-1", IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
      ]),
    );

  return GroupId;
}

async function awsUp(runState, name, options) {
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
  console.log(alias);
}

/** Terminates `names`, or with `all` every instance tagged with the run, also those a crash left out of state.json. */
async function removeInstances(runState, names, all) {
  const { state } = runState;
  const ids = names.map((n) => state.hosts[n].instanceId);

  if (!ids.length && !state.aws.keyPair) return;

  await requireAwsSession();

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

async function removeAwsRunResources(runState) {
  const { aws: awsState } = runState.state;

  if (awsState.keyPair) {
    await aws("ec2", "delete-key-pair", "--key-name", awsState.keyPair);
    delete awsState.keyPair;
    await runState.save();
  }

  for (const [name, groupId] of Object.entries(awsState.securityGroups)) {
    // A terminated instance's interface can hold the group for a little while.
    for (let i = 0; ; i++) {
      try {
        await aws("ec2", "delete-security-group", "--group-id", groupId);
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

// Removal

async function removeContainers(runState, names) {
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

async function down(runState, name) {
  const { state } = runState;

  if (name) hostOf(runState, name);

  const names = name ? [name] : Object.keys(state.hosts);
  const dockerNames = names.filter((n) => state.hosts[n].kind === "docker");
  const awsNames = names.filter((n) => state.hosts[n].kind === "aws");

  await stopTunnels(runState, name);

  if (name) {
    await (dockerNames.length
      ? removeContainers(runState, dockerNames)
      : removeInstances(runState, awsNames, false));

    return;
  }

  const hasDocker =
    state.containers.length ||
    state.networks.length ||
    state.images.length ||
    dockerNames.length;

  if (hasDocker) {
    await removeContainers(runState, []);

    for (const network of state.networks) {
      await docker("network", "rm", network).catch((error) => {
        if (!/not found/.test(error.stderr)) throw error;
      });
      state.networks = state.networks.filter((n) => n !== network);
      await runState.save();
    }

    for (const image of state.images) {
      await docker("rmi", image).catch((error) => {
        if (!/No such image/.test(error.stderr)) throw error;
      });
      state.images = state.images.filter((i) => i !== image);
      await runState.save();
    }
  }

  await removeInstances(runState, awsNames, true);

  if (state.aws.keyPair || Object.keys(state.aws.securityGroups).length)
    await removeAwsRunResources(runState);

  await rm(runState.dir, { recursive: true, force: true });
  console.log(`run ${runState.id}: removed`);
}

async function downAll() {
  const ids = process.env.WB_TEST_RUN
    ? [process.env.WB_TEST_RUN]
    : await runIds();

  let failed = false;

  for (const id of ids) {
    if (!existsSync(runDirOf(id))) continue;

    try {
      await down(await openRun(false, id));
    } catch (error) {
      failed = true;
      console.error(`run ${id}: ${error.message}`);
    }
  }

  if (!ids.length) console.log("nothing to remove");

  return failed ? 1 : 0;
}

// Verification

async function leftovers() {
  const found = [];

  for (const id of await runIds()) found.push(`run directory ${runDirOf(id)}`);

  for (const [pid, args] of await sshProcesses((args) =>
    /\/tmp\/wbt\.|wb-test-/.test(args),
  ))
    found.push(`ssh process ${pid}: ${args}`);

  try {
    const lists = [
      [
        "container",
        ["ps", "-a", "--filter", "name=wb-test", "--format", "{{.Names}}"],
      ],
      [
        "image",
        [
          "images",
          "--filter",
          "reference=wb-test*",
          "--format",
          "{{.Repository}}:{{.Tag}}",
        ],
      ],
      [
        "network",
        ["network", "ls", "--filter", "name=wb-test", "--format", "{{.Name}}"],
      ],
    ];

    for (const [kind, args] of lists)
      for (const item of (await docker(...args)).split("\n"))
        if (item) found.push(`${kind} ${item}`);
  } catch (error) {
    found.push(`Docker could not be checked: ${error.message.split("\n")[0]}`);
  }

  try {
    await requireAwsSession();

    const isOurs = (name, tags = []) =>
      name?.startsWith("wb-test-") ||
      tags.some((t) => t.Key === "wb-test" && t.Value === "1");

    for (const id of await liveInstances("Name=tag:wb-test,Values=1"))
      found.push(`AWS instance ${id}`);

    for (const k of (await aws("ec2", "describe-key-pairs")).KeyPairs)
      if (isOurs(k.KeyName, k.Tags)) found.push(`AWS key pair ${k.KeyName}`);

    for (const g of (await aws("ec2", "describe-security-groups"))
      .SecurityGroups)
      if (isOurs(g.GroupName, g.Tags))
        found.push(`AWS security group ${g.GroupName} (${g.GroupId})`);
  } catch (error) {
    found.push(`AWS could not be checked: ${error.message}`);
  }

  return found;
}

// Commands

const usage = `usage: remote.mjs <command>
  up <name> [--platform linux/amd64|linux/arm64] [--image <image>] [--node 24|20|none]
            [--auth key|password] [--banner] [--shell bash|fish] [--jump <name>]
            [--sealed] [--delay-ms <n>] [--no-forwarding]
  install <name> [--version <v>]
  ssh <name> -- <command...>
  forward <name> <remote port>
  pause <name> | resume <name> | logs <name>
  aws-up <name> [--arch x64|arm64] [--sealed]
  down <name> | down --all
  verify-clean`;

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
      version: { type: "string" },
      arch: { type: "string" },
      all: { type: "boolean" },
    },
  });

  const [command, name, arg] = positionals;

  switch (command) {
    case "up":
      return up(await openRun(true), name, values);
    case "aws-up":
      return awsUp(await openRun(true), name, values);
    case "install":
      return install(await openRun(false), name, values.version);
    case "ssh": {
      const runState = await openRun(false);

      return inherit("ssh", [
        ...sshArgs(runState, hostOf(runState, name)),
        ...remoteCommand,
      ]);
    }

    case "forward":
      return forward(await openRun(false), name, Number(arg));
    case "pause":
    case "resume": {
      const runState = await openRun(false);

      await docker(
        command === "pause" ? "pause" : "unpause",
        containerOf(runState, name),
      );

      return 0;
    }

    case "logs": {
      const runState = await openRun(false);

      return inherit("docker", ["logs", containerOf(runState, name)]);
    }

    case "down":
      if (values.all) return downAll();

      if (!name) throw new Error("down needs a name or --all");

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
