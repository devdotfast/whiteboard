/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { IWhiteboardRemoteProduct } from "../../../base/common/product.js";
import { fetchToLaptopCache, remoteArtifacts, remotePackageIntegrity } from "./reviewRemoteArtifacts.js";

const roots: string[] = [];
const servers: Server[] = [];

after(async () => {
	for (const server of servers) server.close();
	await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function temporary(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

async function serve(files: Record<string, Buffer | string>) {
	const requests: string[] = [];
	const server = createServer((request, response) => {
		requests.push(request.url ?? "");
		const body = files[request.url ?? ""];
		response.writeHead(body === undefined ? 404 : 200);
		response.end(body);
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

test("a download is verified before it is cached, and verified again on each use", async () => {
	const cacheDirectory = await temporary("wb-artifacts-cache-");
	const body = Buffer.from("node tarball bytes");
	const { base, requests } = await serve({ "/node.tar.xz": body });
	const artifact = { name: "node.tar.xz", url: `${base}/node.tar.xz`, sha256: sha256(body) };

	const first = await fetchToLaptopCache(artifact, { cacheDirectory });
	const second = await fetchToLaptopCache(artifact, { cacheDirectory });

	assert.equal(first, second);
	assert.ok(first.startsWith(cacheDirectory));
	assert.deepEqual(await readFile(first), body);
	assert.deepEqual(requests, ["/node.tar.xz"]);

	await writeFile(first, "tampered");
	await assert.rejects(fetchToLaptopCache(artifact, { cacheDirectory }), /checksum/);
	assert.deepEqual(await readdir(cacheDirectory), []);
});

test("a file whose checksum is wrong is refused and not kept", async () => {
	const cacheDirectory = await temporary("wb-artifacts-cache-");
	const { base } = await serve({ "/package.tgz": "not the pinned bytes" });

	await assert.rejects(
		fetchToLaptopCache({ name: "package.tgz", url: `${base}/package.tgz`, integrity: `sha512-${createHash("sha512").update("pinned").digest("base64")}` }, { cacheDirectory }),
		/checksum/,
	);
	await assert.rejects(fetchToLaptopCache({ name: "x", url: `${base}/missing` , sha256: sha256("x") }, { cacheDirectory }), /404/);
	await assert.rejects(fetchToLaptopCache({ name: "x", url: `${base}/package.tgz` }, { cacheDirectory }), /no checksum/);
	assert.deepEqual(await readdir(cacheDirectory), []);
});

const PIN: IWhiteboardRemoteProduct = {
	package: { name: "@dev.fast/whiteboard", version: "0.1.6", integrity: `sha512-${"A".repeat(86)}==` },
	node: {
		version: "24.18.0",
		"linux-x64": { url: "https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz", sha256: "a".repeat(64) },
		"linux-arm64": { url: "https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-arm64.tar.xz", sha256: "b".repeat(64) },
	},
};

test("a release build installs what it pinned", async () => {
	const cacheDirectory = await temporary("wb-artifacts-cache-");

	assert.deepEqual(await remoteArtifacts("linux-arm64", { pin: PIN, cacheDirectory }), {
		package: {
			name: "dev.fast-whiteboard-0.1.6.tgz",
			url: "https://registry.npmjs.org/@dev.fast/whiteboard/-/whiteboard-0.1.6.tgz",
			integrity: PIN.package.integrity,
		},
		node: { name: "node-v24.18.0-linux-arm64.tar.xz", url: PIN.node["linux-arm64"].url, sha256: "b".repeat(64) },
	});
	await assert.rejects(remoteArtifacts("linux-x64", { pin: undefined, cacheDirectory }), /no pinned remote package/);
	assert.equal(await remotePackageIntegrity({ pin: PIN, cacheDirectory }), PIN.package.integrity);
});

async function checkout(counter: string) {
	const root = await temporary("wb-artifacts-checkout-");
	const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
	await mkdir(join(root, "packages/review"), { recursive: true });
	await mkdir(join(root, "apps/review-desktop/code-oss"), { recursive: true });
	await writeFile(join(root, "apps/review-desktop/code-oss/.nvmrc"), "24.18.0\n");
	await writeFile(
		join(root, "packages/review/package.json"),
		JSON.stringify({ name: "@dev.fast/whiteboard", version: "0.0.1", files: ["index.js"] }),
	);
	await mkdir(join(root, "scripts"), { recursive: true });
	await writeFile(
		join(root, "scripts/pack-review-cli.mjs"),
		`import { appendFileSync } from "node:fs"; import { execFileSync } from "node:child_process";
const [, , flag, commit, output] = process.argv;
appendFileSync(${JSON.stringify(counter)}, \`\${flag} \${commit}\\n\`);
execFileSync("pnpm", ["--dir", "packages/review", "pack", "--pack-destination", output]);`,
	);
	await writeFile(join(root, "packages/review/index.js"), "export {};\n");
	run("init", "-b", "main");
	run("add", ".");
	run("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-m", "fixture");
	return root;
}

test("a development build packs its checkout once per state and fetches Node's checksums once", async () => {
	const counter = join(await temporary("wb-artifacts-packs-"), "packs.txt");
	const root = await checkout(counter);
	const cacheDirectory = await temporary("wb-artifacts-cache-");
	const shasums = [`${"c".repeat(64)}  node-v24.18.0-linux-x64.tar.xz`, `${"d".repeat(64)}  node-v24.18.0-linux-arm64.tar.xz`, ""].join("\n");
	const { base, requests } = await serve({ "/dist/v24.18.0/SHASUMS256.txt": shasums });
	const options = { pin: undefined, checkout: root, cacheDirectory, nodeDist: `${base}/dist` };
	const calls = async () => (await readFile(counter, "utf8")).split("\n").filter(Boolean);
	const packs = async () => (await calls()).length;

	const first = await remoteArtifacts("linux-x64", options);
	const again = await remoteArtifacts("linux-x64", options);

	assert.deepEqual(again, first);
	assert.equal(await remotePackageIntegrity(options), first.package.integrity);
	assert.equal(await packs(), 1);
	assert.equal(first.package.name, "dev.fast-whiteboard-0.0.1.tgz");
	const packed = await fetchToLaptopCache(first.package, { cacheDirectory });
	assert.equal(first.package.integrity, `sha512-${createHash("sha512").update(await readFile(packed)).digest("base64")}`);
	assert.deepEqual(first.node, { name: "node-v24.18.0-linux-x64.tar.xz", url: `${base}/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz`, sha256: "c".repeat(64) });
	assert.equal((await remoteArtifacts("linux-arm64", options)).node.sha256, "d".repeat(64));
	assert.deepEqual(requests, ["/dist/v24.18.0/SHASUMS256.txt"]);

	await writeFile(join(root, "packages/review/index.js"), "export const changed = 1;\n");
	const edited = await remoteArtifacts("linux-x64", options);

	assert.equal(await packs(), 2);
	assert.notEqual(edited.package.integrity, first.package.integrity);
	const [before, after] = await calls();
	assert.match(before, /^--dev [0-9a-f]{40}$/);
	assert.notEqual(after, before);
});
