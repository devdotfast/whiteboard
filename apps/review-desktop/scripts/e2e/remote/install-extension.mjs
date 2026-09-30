/** Installs a plain-JS extension folder on a remote for the guard live check. */
import { readdir } from "node:fs/promises";
import path from "node:path";

import { containerOf } from "./docker-hosts.mjs";
import { docker, run } from "./exec.mjs";
import { sshArgs } from "./ssh.mjs";

/**
 * Puts a local extension folder on the remote and registers it as a bundled
 * curated extension, so `remote attach`'s `extensions ensure` re-lists it
 * (instead of dropping it) on every connect:
 *  - the folder is copied under `~/.dev/whiteboard-remote/extensions`;
 *  - a `.curated.json` stamp records the extension.js checksum;
 *  - the installed package's `curated.json` gains a bundled entry with that
 *    checksum and no executables, which `ensure` finds up to date, so it never
 *    downloads and never removes it. `ensure` regenerates `extensions.json`
 *    from the curated list, so the entry appears there too.
 * The package is root-owned, so the registration runs as root over
 * `docker exec`; this helper is for the Docker live check.
 */
export async function installExtension(runState, name, localDir) {
  const host = containerOf(runState, name);

  const manifest = JSON.parse(
    await run("cat", [path.join(localDir, "package.json")]),
  );

  const id = `${manifest.publisher}.${manifest.name}`;
  const folder = `${id}-${manifest.version}`;

  const home = (
    await run("ssh", [...sshArgs(runState, host), 'printf %s "$HOME"'])
  ).trim();

  const directory = `${home}/.dev/whiteboard-remote/extensions/${folder}`;

  await run("ssh", [...sshArgs(runState, host), `mkdir -p ${directory}`]);
  const files = await readdir(localDir);
  await run("scp", [
    "-F",
    `${runState.dir}/ssh_config`,
    ...files.map((file) => path.join(localDir, file)),
    `${host.alias}:${directory}/`,
  ]);

  const script = remoteScript({
    directory,
    serverDataDir: `${home}/.dev/whiteboard-remote/server`,
    folder,
    id,
    version: manifest.version,
  });

  const encoded = Buffer.from(script, "utf8").toString("base64");

  // Root, so it can write the package's curated.json; base64, so the shell expands nothing.
  const out = await docker(
    "exec",
    "-u",
    "root",
    host.container,
    "sh",
    "-c",
    `echo ${encoded} | base64 -d | node -`,
  );

  console.log(out.trim());
}

/** The node program run as root on the remote, where the paths and package live. */
function remoteScript(values) {
  const v = (name) => JSON.stringify(values[name]);

  return [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const crypto = require('node:crypto');",
    "const cp = require('node:child_process');",
    `const directory = ${v("directory")};`,
    `const serverData = ${v("serverDataDir")};`,
    `const folder = ${v("folder")};`,
    `const id = ${v("id")};`,
    `const version = ${v("version")};`,
    "const arch = process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';",
    // A checksum the stamp and the curated entry share, so `ensure` sees a match and skips the download.
    "const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, 'extension.js'))).digest('hex');",
    "fs.writeFileSync(path.join(directory, '.curated.json'), JSON.stringify({ id, version, target: arch, sha256, installedTimestamp: Date.now() }));",
    "const curatedFile = cp.execFileSync('sh', ['-c', 'find \"$(npm root -g)\" -name curated.json -path \"*vscode-server*\" | head -1'], { encoding: 'utf8' }).trim();",
    "if (!curatedFile) throw new Error('curated.json not found under the global package');",
    "const curated = JSON.parse(fs.readFileSync(curatedFile, 'utf8'));",
    "const download = { universal: true, url: 'about:blank', sha256, size: 0 };",
    "const probe = { id, version, tier: 'bundled', group: 'probe', executables: [], stripExtensionPack: false, addActivationEvents: [], targets: { 'linux-x64': download, 'linux-arm64': download } };",
    "curated.extensions = [...curated.extensions.filter((e) => e.id !== id), probe];",
    "fs.writeFileSync(curatedFile, JSON.stringify(curated));",
    // `ensure` regenerates extensions.json from the curated list; a stale cache would hide the change.
    "fs.rmSync(path.join(serverData, 'data', 'CachedProfilesData'), { recursive: true, force: true });",
    "console.log('installed ' + id + ' (' + arch + ', ' + curated.extensions.length + ' curated)');",
  ].join(" ");
}
