#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  downloadPinned,
  sha256File,
} from "../../../packages/review/src/pinned-download.ts";
import { buildRemoteRuntime } from "./build-remote-runtime.mjs";
import { stageReviewDocs } from "./stage-review-runtime.mjs";
import {
  pruneVscodeServerArch,
  stageVscodeServer,
} from "./stage-vscode-server.mjs";
import { installTypeScriptNative } from "./typescript-native.mjs";

export const REMOTE_TARGETS = ["linux-x64", "linux-arm64"];

export const REMOTE_TARBALL_MAX_BYTES = 80 * 1024 * 1024;

export const remoteTarballName = (version, target) =>
  `whiteboard-remote-${version}-${target}.tar.xz`;

const appDirectory = path.resolve(import.meta.dirname, "..");

const codeOss = path.join(appDirectory, "code-oss");

const monorepoRoot = path.resolve(appDirectory, "..", "..");

const reviewPackage = path.join(monorepoRoot, "packages", "review");

const DEFAULT_CACHE = path.join(codeOss, ".build", "remote-tarball-cache");

const ADAPTERS = [
  "@agentclientprotocol/claude-agent-acp",
  "@agentclientprotocol/codex-acp",
  "pi-acp",
];

const SIDECAR = ["sharp", "@img/sharp-wasm32", "@parcel/watcher"];

const PACKAGE_DATA = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "onboarding.md",
  "instructions",
  "remote",
];

const reviewRequire = createRequire(path.join(reviewPackage, "package.json"));

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

function installedPackage(name) {
  for (const directory of reviewRequire.resolve.paths(name) ?? []) {
    const root = path.join(directory, name);

    if (existsSync(path.join(root, "package.json"))) return root;
  }

  throw new Error(`${name} is not installed for packages/review`);
}

export async function pinnedNode(
  target,
  { cacheDir, dist = "https://nodejs.org/dist" },
) {
  const nvmrc = path.join(codeOss, ".nvmrc");
  const version = (await readFile(nvmrc, "utf8")).trim();

  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`${nvmrc} does not hold an exact Node version.`);

  const sums = path.join(cacheDir, `node-v${version}-SHASUMS256.txt`);
  let text = await readFile(sums, "utf8").catch(() => undefined);

  if (text === undefined) {
    const url = `${dist}/v${version}/SHASUMS256.txt`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });

    if (!response.ok) throw new Error(`${url} answered ${response.status}.`);

    text = await response.text();
    await mkdir(cacheDir, { recursive: true });
    await writeFile(sums, text);
  }

  const name = `node-v${version}-${target}.tar.xz`;

  const sha256 = text
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, file]) => file === name)?.[0];

  if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256))
    throw new Error(
      `SHASUMS256.txt for Node ${version} has no line for ${name}.`,
    );

  return { url: `${dist}/v${version}/${name}`, sha256, version };
}

async function bundleCli(stage) {
  const esbuild = createRequire(path.join(codeOss, "build/package.json"))(
    "esbuild",
  );

  const options = {
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: {
      js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
    },
    logLevel: "warning",
  };

  await esbuild.build({
    ...options,
    entryPoints: [path.join(reviewPackage, "dist", "cli.js")],
    outfile: path.join(stage, "dist", "cli.js"),
    external: ["sharp", "@parcel/watcher", "@dev.fast/diffr", ...ADAPTERS],
  });
  await cp(
    path.join(reviewPackage, "dist", "build-info.json"),
    path.join(stage, "dist", "build-info.json"),
  );

  for (const name of ADAPTERS) {
    const source = installedPackage(name);
    const destination = path.join(stage, "node_modules", name);

    await esbuild.build({
      ...options,
      entryPoints: [path.join(source, "dist", "index.js")],
      outfile: path.join(destination, "dist", "index.js"),
    });

    const { version } = await readJson(path.join(source, "package.json"));
    await writeFile(
      path.join(destination, "package.json"),
      `${JSON.stringify({ name, version, type: "module" }, null, 2)}\n`,
    );
  }
}

async function installSidecar(stage, target, stdio) {
  const sidecar = path.join(stage, ".sidecar");
  const modules = path.join(stage, "node_modules");
  const arch = target.replace("linux-", "");

  const { version: diffr } = await readJson(
    path.join(monorepoRoot, "diffr", "diffr-ts", "package.json"),
  );

  const dependencies = {
    ...Object.fromEntries(
      await Promise.all(
        SIDECAR.map(async (name) => [
          name,
          (await readJson(path.join(installedPackage(name), "package.json")))
            .version,
        ]),
      ),
    ),
    "@dev.fast/diffr": diffr,
  };

  await mkdir(sidecar, { recursive: true });
  await writeFile(
    path.join(sidecar, "package.json"),
    `${JSON.stringify({ private: true, dependencies }, null, 2)}\n`,
  );

  execFileSync(
    "npm",
    [
      "install",
      "--os",
      "linux",
      "--cpu",
      arch,
      "--libc",
      "glibc",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--loglevel=error",
    ],
    {
      cwd: sidecar,
      stdio,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !/^npm_config_/i.test(key),
        ),
      ),
    },
  );

  const installed = path.join(sidecar, "node_modules");

  for (const entry of await readdir(installed)) {
    if (entry.startsWith(".")) continue;

    const names = entry.startsWith("@")
      ? (await readdir(path.join(installed, entry))).map((n) => `${entry}/${n}`)
      : [entry];

    for (const name of names) {
      if (/^@img\/sharp-(linux|libvips)-/.test(name)) continue;

      await mkdir(path.dirname(path.join(modules, name)), { recursive: true });
      await rename(path.join(installed, name), path.join(modules, name));
    }
  }

  await rm(sidecar, { recursive: true, force: true });

  for (const binary of [
    `@dev.fast/diffr-${target}/diffr`,
    `@parcel/watcher-${target}-glibc/watcher.node`,
  ])
    if (!existsSync(path.join(modules, binary)))
      throw new Error(`the ${target} sidecar install has no ${binary}`);

  const { version } = await readJson(
    path.join(modules, "@dev.fast/diffr/package.json"),
  );

  if (version !== diffr)
    throw new Error(
      `npm installed @dev.fast/diffr ${version}, not diffr-ts ${diffr}`,
    );
}

async function stageNode(stage, target, cacheDir) {
  const pin = await pinnedNode(target, { cacheDir });
  const name = path.basename(pin.url);
  const file = path.join(cacheDir, name);

  await downloadPinned(pin, file);

  const bin = path.join(stage, "bin");
  await mkdir(bin, { recursive: true });
  const top = name.replace(/\.tar\.xz$/, "");
  execFileSync("tar", [
    "-xJf",
    file,
    "-C",
    bin,
    "--strip-components=1",
    `${top}/bin/node`,
    `${top}/LICENSE`,
  ]);
  await rename(path.join(bin, "bin", "node"), path.join(bin, "node"));
  await rm(path.join(bin, "bin"), { recursive: true });
  await rename(path.join(bin, "LICENSE"), path.join(bin, "NODE-LICENSE"));
  await chmod(path.join(bin, "node"), 0o755);
}

async function stagePackageData(stage) {
  for (const name of PACKAGE_DATA)
    await cp(path.join(reviewPackage, name), path.join(stage, name), {
      recursive: true,
    });

  await stageReviewDocs(stage);
}

function packTar(file, stageRoot, compression) {
  const gnu = execFileSync("tar", ["--version"], { encoding: "utf8" }).includes(
    "GNU",
  );

  const flags = gnu
    ? ["--owner=0", "--group=0", "--numeric-owner"]
    : [
        "--uid=0",
        "--gid=0",
        "--uname=",
        "--gname=",
        "--no-xattrs",
        "--no-mac-metadata",
        "--options=xz:threads=0",
      ];

  execFileSync(
    "tar",
    ["-cJf", file, ...flags, "-C", stageRoot, "whiteboard-remote"],
    {
      env: {
        ...process.env,
        XZ_OPT: `-${compression} -T0`,
        COPYFILE_DISABLE: "1",
      },
    },
  );
}

export async function buildRemoteTarball({
  target,
  out,
  version,
  commit,
  cacheDir = DEFAULT_CACHE,
  compression = 6,
  stdio = "inherit",
  // Another target in this process already built the shared packages and runtime.
  prebuilt = false,
}) {
  if (!REMOTE_TARGETS.includes(target))
    throw new Error(`${target} is not one of ${REMOTE_TARGETS.join(", ")}`);

  const output = path.resolve(out);
  const stageRoot = path.join(output, `.stage-${target}`);
  const stage = path.join(stageRoot, "whiteboard-remote");
  const name = remoteTarballName(version, target);
  const file = path.join(output, name);

  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });

  try {
    if (!prebuilt)
      execFileSync("pnpm", ["--filter", "@dev.fast/whiteboard", "build"], {
        cwd: monorepoRoot,
        stdio,
      });

    await bundleCli(stage);
    await installSidecar(stage, target, stdio);

    if (!prebuilt) await buildRemoteRuntime({ commit });
    await stageVscodeServer(stage, { commit });
    await pruneVscodeServerArch(stage, target);
    await installTypeScriptNative({
      target,
      extensionDir: path.join(
        stage,
        "vscode-server/extensions/typescript-native",
      ),
    });

    await stageNode(stage, target, cacheDir);
    await stagePackageData(stage);

    await writeFile(
      path.join(stage, "package.json"),
      `${JSON.stringify(
        {
          name: "@dev.fast/whiteboard",
          version,
          type: "module",
          bin: { whiteboard: "./dist/cli.js" },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      path.join(stage, "whiteboard"),
      [
        "#!/bin/sh",
        'f=$(readlink -f -- "$0" 2>/dev/null || printf \'%s\' "$0")',
        'd=$(CDPATH= cd -- "$(dirname -- "$f")" && pwd)',
        'exec "$d/bin/node" "$d/dist/cli.js" "$@"',
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    await rm(file, { force: true });
    packTar(file, stageRoot, compression);

    const { size } = await stat(file);

    if (size > REMOTE_TARBALL_MAX_BYTES) {
      await rm(file, { force: true });
      throw new Error(
        `${name} is ${size} bytes, over the ${REMOTE_TARBALL_MAX_BYTES}-byte limit`,
      );
    }

    const sha256 = await sha256File(file);
    await writeFile(`${file}.sha256`, `${sha256}  ${name}\n`);

    return { file, sha256, version, target };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

const checkoutState = () => {
  const hash = createHash("sha256");

  for (const args of [
    ["rev-parse", "HEAD"],
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ["diff", "HEAD", "--binary"],
  ])
    hash.update(
      execFileSync("git", ["-C", monorepoRoot, ...args], {
        maxBuffer: 256 * 1024 * 1024,
      }),
    );

  return hash.digest("hex").slice(0, 32);
};

/** This checkout's tarball, built once per checkout state, version and target. */
export async function buildDevRemoteTarball({
  target,
  version,
  stdio = "inherit",
}) {
  version ??= (await readJson(path.join(reviewPackage, "package.json")))
    .version;

  const dev = path.join(DEFAULT_CACHE, "dev");
  const state = checkoutState();
  const out = path.join(dev, state);
  const file = path.join(out, remoteTarballName(version, target));

  const sha256 = await readFile(`${file}.sha256`, "utf8").then(
    (text) => text.split(" ")[0],
    () => undefined,
  );

  if (sha256 && existsSync(file))
    return { file, sha256, version, target, state };

  for (const entry of await readdir(dev).catch(() => []))
    if (entry !== state) await rm(path.join(dev, entry), { recursive: true });

  const built = await buildRemoteTarball({
    target,
    out,
    version,
    commit: execFileSync("git", ["-C", monorepoRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    compression: 0,
    stdio,
  });

  return { ...built, state };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      target: { type: "string", multiple: true },
      out: { type: "string" },
      version: { type: "string" },
      commit: { type: "string" },
      cache: { type: "string" },
    },
  });

  const { version, commit } = values;

  if (!values.target || !values.out || !version || !commit)
    throw new Error(
      "usage: build-remote-tarball.mjs --target <linux-x64|linux-arm64>... --out <dir> --version <v> --commit <sha> [--cache <dir>]",
    );

  const cache = process.env.REVIEW_REMOTE_BUILD_CACHE || values.cache;

  for (const [index, target] of values.target.entries()) {
    const result = await buildRemoteTarball({
      target,
      out: values.out,
      version,
      commit,
      cacheDir: cache ? path.resolve(cache) : undefined,
      stdio: ["ignore", process.stderr, process.stderr],
      prebuilt: index > 0,
    });

    console.log(JSON.stringify(result));
  }
}
