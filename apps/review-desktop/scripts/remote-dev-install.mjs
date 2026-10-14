#!/usr/bin/env node
/** Installs this checkout's remote tarball on an SSH host by hand, as Settings' hand-install lines do; see docs/remote-hosts.md. */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  REMOTE_TARGETS,
  buildDevRemoteTarball,
} from "./build-remote-tarball.mjs";

const ROOT = "~/.dev/whiteboard-remote";

const INSTALL_SCRIPT = fileURLToPath(
  new URL("../../../packages/review/remote/install.sh", import.meta.url),
);

const BUCKET = "dev-fast-desktop-artifacts";

const RELEASES = "https://install.dev.fast/releases";

const TARGETS = { x86_64: "linux-x64", aarch64: "linux-arm64" };

const sshArgs = (sshConfig) => [
  ...(sshConfig ? ["-F", sshConfig] : []),
  "-o",
  "BatchMode=yes",
];

const ssh = (alias, sshConfig, command) =>
  execFileSync("ssh", [...sshArgs(sshConfig), alias, command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();

function hostTarget(alias, { sshConfig } = {}) {
  const machine = ssh(alias, sshConfig, "uname -m");
  const target = TARGETS[machine];

  if (!target)
    throw new Error(
      `${alias} runs ${machine}; Whiteboard needs x86_64 or aarch64.`,
    );

  return target;
}

/** Installs this checkout's tarball with packages/review/remote/install.sh, as Desktop does, and returns its `whiteboard version --json`; `commit` rewrites its VS Code server's commit. */
export async function remoteDevInstall(
  alias,
  { target, sshConfig, version, commit, stdio = "inherit" } = {},
) {
  target ??= hostTarget(alias, { sshConfig });

  const built = await buildDevRemoteTarball({ target, version, stdio });
  const copy = `/tmp/whiteboard-remote-${randomBytes(4).toString("hex")}.tar.xz`;
  const installed = `${ROOT}/versions/${built.version}`;

  try {
    execFileSync(
      "scp",
      [...sshArgs(sshConfig), "-q", built.file, `${alias}:${copy}`],
      { stdio: ["ignore", "inherit", "inherit"] },
    );

    const args = ["install", "--version", built.version, "--sha256", built.sha256, "--file", copy];

    const said = execFileSync("ssh", [...sshArgs(sshConfig), alias, "sh", "-s"], {
      encoding: "utf8",
      input: `set -- ${args.map((arg) => `'${arg}'`).join(" ")}\n${await readFile(INSTALL_SCRIPT, "utf8")}`,
      stdio: ["pipe", "pipe", "inherit"],
    });

    if (!/^WHITEBOARD-INSTALL DONE /m.test(said))
      throw new Error(`install.sh did not install on ${alias}:\n${said.trim()}`);

    return ssh(
      alias,
      sshConfig,
      [
        "set -e",
        ...(commit
          ? [
              `sed -i 's/"commit": "[0-9a-f]*"/"commit": "${commit}"/' ${installed}/vscode-server/product.json`,
            ]
          : []),
        `${installed}/whiteboard version --json`,
      ].join("\n"),
    );
  } finally {
    try {
      ssh(alias, sshConfig, `rm -f ${copy}`);
    } catch {}
  }
}

/** Puts a tarball and its .sha256 at releases/dev/<checkout state>/remote/ on install.dev.fast, unless the same .sha256 is there. */
async function publishRemoteTarball({ file, sha256, state }) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (!account || !token)
    throw new Error(
      "DEV_FAST_REVIEW_REMOTE_PUBLISH=1 needs CLOUDFLARE_ACCOUNT_ID (the hex host of R2_ENDPOINT_URL) and CLOUDFLARE_API_TOKEN.",
    );

  const name = path.basename(file);
  const segments = ["releases", "dev", state, "remote"];

  const url = (key) =>
    `${RELEASES}/${[...segments.slice(1), key].map(encodeURIComponent).join("/")}`;

  const sum = `${sha256}  ${name}\n`;

  const published = await fetch(url(`${name}.sha256`)).then((response) =>
    response.ok ? response.text() : undefined,
  );

  if (published === sum) return false;

  for (const [key, body, type] of [
    [name, await readFile(file), "application/x-xz"],
    [`${name}.sha256`, sum, "text/plain"],
  ]) {
    const object = [...segments, key].map(encodeURIComponent).join("/");

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${BUCKET}/objects/${object}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": type },
        body,
      },
    );

    if (!response.ok)
      throw new Error(
        `Publishing ${key} answered ${response.status}: ${(await response.text()).slice(0, 500)}`,
      );
  }

  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      target: { type: "string" },
      "ssh-config": { type: "string" },
    },
  });

  const [alias] = positionals;
  const publish = process.env.DEV_FAST_REVIEW_REMOTE_PUBLISH === "1";
  const sshConfig = values["ssh-config"];

  if ((!alias && !publish) || positionals.length > 1)
    throw new Error(
      "usage: remote-dev-install.mjs <ssh-alias> [--target linux-x64|linux-arm64] [--ssh-config <file>]\n       DEV_FAST_REVIEW_REMOTE_PUBLISH=1 remote-dev-install.mjs [<ssh-alias>] ...",
    );

  if (values.target && !REMOTE_TARGETS.includes(values.target))
    throw new Error(`--target must be one of ${REMOTE_TARGETS.join(", ")}`);

  const stdio = ["ignore", process.stderr, process.stderr];

  let state;

  // Both targets, so the printed releases URL serves either arch.
  if (publish)
    for (const each of REMOTE_TARGETS) {
      const built = await buildDevRemoteTarball({ target: each, stdio });

      state = built.state;
      console.error(
        `${path.basename(built.file)}: ${(await publishRemoteTarball(built)) ? "published" : "already published"}`,
      );
    }

  if (alias)
    console.log(
      await remoteDevInstall(alias, {
        target: values.target,
        sshConfig,
        stdio,
      }),
    );

  if (publish)
    console.log(
      `export DEV_FAST_REVIEW_REMOTE_RELEASES=${RELEASES}/dev/${state}/remote/`,
    );
}
