/** `verify-clean`: what remains, found by name and tag, never through state.json. */
import { liveInstances, requireAwsSession } from "./aws-hosts.mjs";
import { aws, docker } from "./exec.mjs";
import { runDirOf, runIds } from "./run-state.mjs";
import { sshProcesses } from "./ssh.mjs";

export async function leftovers() {
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
