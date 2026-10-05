import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_REMOTE_RUNTIME,
  REMOTE_BUILTIN_EXTENSIONS,
} from "./build-remote-runtime.mjs";
import {
  curatedExtensions,
  openVsxUrl,
  remoteExtensionIds,
  remoteTargets,
  targetKeyFor,
} from "./curated-extensions.manifest.mjs";

const DEFAULT_CACHE = path.join(
  path.dirname(DEFAULT_REMOTE_RUNTIME),
  "remote-server-cache",
);

const npmTarball = (name, version) =>
  `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;

export const REMOTE_SERVER_DOWNLOADS = [
  {
    url: npmTarball("@vscode/ripgrep-universal", "1.18.0"),
    sha256: "76a03f429dc13a90f53b60995211a54308ab4f67b2521bac00f9c4be953dff52",
    copy: {
      "bin/linux-x64/rg": "out/vs/workbench/api/bin/linux-x64/rg",
      "bin/linux-arm64/rg": "out/vs/workbench/api/bin/linux-arm64/rg",
      LICENSE: "out/vs/workbench/api/bin/LICENSE",
    },
  },
  ...[
    [
      "@parcel/watcher",
      "2.5.6",
      "8daa7285bee7e10bebce179007afcf07108c1b8ce9dbe5081f3db319d5453648",
    ],
    [
      "@parcel/watcher-linux-x64-glibc",
      "2.5.6",
      "43eed2f56c7b33d32172cf79513e807b4588ecc4e05d53a306d78fc6c356a42e",
    ],
    [
      "@parcel/watcher-linux-arm64-glibc",
      "2.5.6",
      "084d8a2dbea9c6a4c1b49d680abed344294f413a86a2184b7e013c1b395b30a0",
    ],
    [
      "detect-libc",
      "2.1.2",
      "270dec0fc06cff86481da8af2dd8f18dee6b602790b14ef0e1c2c18d7da39427",
    ],
    [
      "is-glob",
      "4.0.3",
      "3fe453fb193bb58f6f0505dfb1151230935380b5b55e1f9864261c2aafc1bec6",
    ],
    [
      "is-extglob",
      "2.1.1",
      "8c5d4286146ad62fc1096981700ce1c22a167708926fca01f9ca74f9bb50bc19",
    ],
    [
      "picomatch",
      "4.0.4",
      "515b5ab666558ed9a117483a310892aede54a68dd78f2d8db6604513e578571c",
    ],
  ].map(([name, version, sha256]) => ({
    url: npmTarball(name, version),
    sha256,
    copy: { ".": `node_modules/${name}` },
  })),
];

const sha256Of = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function cached(cacheDir, { url, sha256 }) {
  const file = path.join(cacheDir, `${sha256}-${path.basename(url)}`);

  if (!fs.existsSync(file)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });

    if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);

    fs.writeFileSync(`${file}.part`, Buffer.from(await response.arrayBuffer()));
    fs.renameSync(`${file}.part`, file);
  }

  const actual = sha256Of(file);

  if (actual !== sha256) {
    fs.rmSync(file, { force: true });
    throw new Error(
      `${url} checksum mismatch\n  expected ${sha256}\n  actual   ${actual}`,
    );
  }

  return file;
}

export function remoteCuratedExtensions() {
  return {
    extensions: remoteExtensionIds.map((id) => {
      const extension = curatedExtensions.find((e) => e.id === id);

      return {
        id,
        version: extension.version,
        tier: extension.tier,
        group: extension.group,
        executables: extension.executables,
        stripExtensionPack: extension.stripExtensionPack,
        addActivationEvents: extension.addActivationEvents ?? [],
        targets: Object.fromEntries(
          remoteTargets.map((target) => {
            const key = targetKeyFor(extension, target);
            const pin = extension.targets[key];

            if (!pin?.size)
              throw new Error(`${id} pins no size for ${target}`);

            return [
              target,
              {
                universal: key === "universal",
                url:
                  pin.url ??
                  openVsxUrl({
                    namespace: extension.namespace,
                    name: extension.name,
                    version: extension.version,
                    target: key === "universal" ? undefined : key,
                  }),
                sha256: pin.sha256,
                size: pin.size,
              },
            ];
          }),
        ),
      };
    }),
  };
}

export async function stageVscodeServer(
  packageRoot,
  {
    commit,
    runtime = DEFAULT_REMOTE_RUNTIME,
    cacheDir = DEFAULT_CACHE,
    downloads = REMOTE_SERVER_DOWNLOADS,
  } = {},
) {
  const productPath = path.join(runtime, "product.json");

  if (!fs.existsSync(productPath))
    throw new Error(
      `${productPath} is missing. Build it first: node apps/review-desktop/scripts/build-remote-runtime.mjs`,
    );

  const product = JSON.parse(fs.readFileSync(productPath, "utf8"));

  if (!/^[0-9a-f]{40}$/.test(product.commit ?? ""))
    throw new Error(`${productPath} has no commit`);

  if (commit && product.commit !== commit)
    throw new Error(
      `the remote runtime was built from ${product.commit}, not ${commit}; rebuild it with BUILD_SOURCEVERSION=${commit}`,
    );

  for (const name of REMOTE_BUILTIN_EXTENSIONS)
    if (!fs.existsSync(path.join(runtime, "extensions", name, "package.json")))
      throw new Error(`the remote runtime has no built-in ${name}`);

  const destination = path.join(packageRoot, "vscode-server");
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(runtime, destination, { recursive: true });

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wb-vscode-server-"));

  try {
    for (const download of downloads) {
      const unpacked = fs.mkdtempSync(path.join(scratch, "npm-"));
      execFileSync("tar", ["-xzf", await cached(cacheDir, download), "-C", unpacked]);

      for (const [from, to] of Object.entries(download.copy)) {
        fs.cpSync(
          path.join(unpacked, "package", from),
          path.join(destination, to),
          { recursive: true },
        );
      }
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  fs.writeFileSync(
    path.join(destination, "curated.json"),
    `${JSON.stringify(remoteCuratedExtensions(), null, 2)}\n`,
  );

  return destination;
}
