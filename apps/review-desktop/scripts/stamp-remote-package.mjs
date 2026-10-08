
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const APP_DIR = path.resolve(import.meta.dirname, "..");

const PRODUCT = path.join(APP_DIR, "code-oss", "product.json");

const NVMRC = path.join(APP_DIR, "code-oss", ".nvmrc");

const TARGETS = ["linux-x64", "linux-arm64"];

const nodeUrl = (version, file) => `https://nodejs.org/dist/v${version}/${file}`;

export function nodeVersionOf(nvmrc = NVMRC) {
  const version = readFileSync(nvmrc, "utf8").trim();

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${nvmrc} holds ${JSON.stringify(version)}, not an exact Node version`);
  }

  return version;
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });

  if (!response.ok) throw new Error(`${url} answered ${response.status}`);

  return response.text();
}

export async function remotePin({ tarball, nodeVersion = nodeVersionOf(), fetchText: get = fetchText }) {
  const manifest = JSON.parse(
    execFileSync("tar", ["-xzOf", tarball, "package/package.json"], { encoding: "utf8" }),
  );

  const shasums = await get(nodeUrl(nodeVersion, "SHASUMS256.txt"));
  const node = { version: nodeVersion };

  for (const target of TARGETS) {
    const file = `node-v${nodeVersion}-${target}.tar.xz`;
    const line = shasums.split("\n").find((entry) => entry.trim().split(/\s+/)[1] === file);

    if (!line) throw new Error(`SHASUMS256.txt for Node ${nodeVersion} has no line for ${file}`);
    node[target] = { url: nodeUrl(nodeVersion, file), sha256: line.trim().split(/\s+/)[0] };
  }

  const pin = {
    package: {
      name: manifest.name,
      version: manifest.version,
      integrity: `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`,
    },
    node,
  };

  checkPin(pin);

  return pin;
}

function checkPin(pin) {
  const fail = (what) => {
    throw new Error(`the remote pin's ${what} is malformed`);
  };

  if (pin?.package?.name !== "@dev.fast/whiteboard") fail("package name");

  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pin.package.version ?? "")) fail("package version");

  if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(pin.package.integrity ?? "")) fail("package integrity");
  const version = pin.node?.version ?? "";

  if (!/^\d+\.\d+\.\d+$/.test(version)) fail("Node version");

  for (const target of TARGETS) {
    const entry = pin.node[target];

    if (entry?.url !== nodeUrl(version, `node-v${version}-${target}.tar.xz`)) fail(`${target} URL`);

    if (!/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) fail(`${target} checksum`);
  }
}

export function writePin(productPath, json) {
  let pin;

  try {
    pin = JSON.parse(json);
  } catch {
    throw new Error("the remote pin is not JSON");
  }

  checkPin(pin);
  const product = JSON.parse(readFileSync(productPath, "utf8"));
  product.whiteboardRemote = pin;
  writeFileSync(productPath, `${JSON.stringify(product, null, "\t")}\n`);
}

export async function stampRemotePackage({ productPath = PRODUCT, ...options }) {
  const pin = await remotePin(options);
  writePin(productPath, JSON.stringify(pin));

  return pin;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      product: { type: "string", default: PRODUCT },
      "node-version": { type: "string" },
      pinned: { type: "string" },
    },
  });

  if (values.pinned !== undefined) {
    writePin(values.product, values.pinned);

    return;
  }

  if (positionals.length !== 1) {
    console.error(
      "usage: stamp-remote-package.mjs <tarball> [--product <path>] [--node-version <x.y.z>]\n" +
        "       stamp-remote-package.mjs --pinned <json> [--product <path>]",
    );
    process.exit(2);
  }

  const pin = await stampRemotePackage({
    tarball: positionals[0],
    productPath: values.product,
    nodeVersion: values["node-version"] ?? nodeVersionOf(),
  });

  console.log(JSON.stringify(pin));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
