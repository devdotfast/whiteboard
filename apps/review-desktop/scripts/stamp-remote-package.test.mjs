import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { remotePin, stampRemotePackage, writePin } from "./stamp-remote-package.mjs";

const roots = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

const X64 = "a".repeat(64);

const ARM64 = "b".repeat(64);

function shasums(version, lines = ["linux-x64", "linux-arm64"]) {
  const sums = { "linux-x64": X64, "linux-arm64": ARM64 };

  return [
    `${"c".repeat(64)}  node-v${version}-darwin-arm64.tar.xz`,
    `${"d".repeat(64)}  node-v${version}-linux-x64.tar.gz`,
    ...lines.map((target) => `${sums[target]}  node-v${version}-${target}.tar.xz`),
    "",
  ].join("\n");
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wb-stamp-remote-"));
  roots.push(root);
  await mkdir(path.join(root, "package"));
  await writeFile(
    path.join(root, "package", "package.json"),
    '{"name":"@dev.fast/whiteboard","version":"0.1.6"}\n',
  );
  const tarball = path.join(root, "dev.fast-whiteboard-0.1.6.tgz");
  execFileSync("tar", ["-czf", tarball, "-C", root, "package"]);
  const productPath = path.join(root, "product.json");
  await writeFile(
    productPath,
    `${JSON.stringify({ nameShort: "Whiteboard", quality: "stable" }, null, "\t")}\n`,
  );

  return { root, tarball, productPath };
}

test("pins the tarball's integrity and Node's checksums into product.json", async () => {
  const { tarball, productPath } = await fixture();
  const fetched = [];

  const pin = await stampRemotePackage({
    tarball,
    productPath,
    nodeVersion: "24.18.0",
    fetchText: async (url) => {
      fetched.push(url);

      return shasums("24.18.0");
    },
  });

  const expected = `sha512-${createHash("sha512").update(await readFile(tarball)).digest("base64")}`;
  const product = JSON.parse(await readFile(productPath, "utf8"));
  assert.deepEqual(fetched, [
    "https://nodejs.org/dist/v24.18.0/SHASUMS256.txt",
  ]);
  assert.deepEqual(product.whiteboardRemote, {
    package: {
      name: "@dev.fast/whiteboard",
      version: "0.1.6",
      integrity: expected,
    },
    node: {
      version: "24.18.0",
      "linux-x64": {
        url: "https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz",
        sha256: X64,
      },
      "linux-arm64": {
        url: "https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-arm64.tar.xz",
        sha256: ARM64,
      },
    },
  });
  assert.deepEqual(pin, product.whiteboardRemote);
  assert.equal(product.nameShort, "Whiteboard");
});

test("fails when SHASUMS256.txt has no line for a target, and leaves product.json alone", async () => {
  const { tarball, productPath } = await fixture();
  const before = await readFile(productPath, "utf8");

  await assert.rejects(
    stampRemotePackage({
      tarball,
      productPath,
      nodeVersion: "24.18.0",
      fetchText: async () => shasums("24.18.0", ["linux-x64"]),
    }),
    /node-v24\.18\.0-linux-arm64\.tar\.xz/,
  );
  assert.equal(await readFile(productPath, "utf8"), before);
});

test("a pin from earlier in the run is written as it is, and a malformed one is refused", async () => {
  const { tarball, productPath } = await fixture();

  const pin = await remotePin({
    tarball,
    nodeVersion: "24.18.0",
    fetchText: async () => shasums("24.18.0"),
  });

  writePin(productPath, JSON.stringify(pin));
  assert.deepEqual(
    JSON.parse(await readFile(productPath, "utf8")).whiteboardRemote,
    pin,
  );

  const broken = { ...pin, package: { ...pin.package, integrity: "sha1-abc" } };
  assert.throws(() => writePin(productPath, JSON.stringify(broken)), /integrity/);
  assert.throws(() => writePin(productPath, ""), /JSON/);
});
