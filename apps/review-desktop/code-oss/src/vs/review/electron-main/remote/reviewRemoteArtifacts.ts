/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

import type { IWhiteboardRemoteProduct } from "../../../base/common/product.js";
import type { ReviewRemoteTarget } from "./reviewRemoteProbe.js";

export interface ReviewRemoteArtifact {
	name: string;
	url: string;
	sha256?: string;
	integrity?: string;
}

export interface ReviewRemoteArtifactsOptions {
	readonly pin: IWhiteboardRemoteProduct | undefined;
	readonly checkout?: string;
	/** The dev Desktop's version, stamped into the package packed from its checkout. */
	readonly devVersion?: string;
	readonly cacheDirectory: string;
	readonly nodeDist?: string;
}

export const REVIEW_REMOTE_ARTIFACT_TIMEOUTS = {
	download: 10 * 60_000,
	pack: 5 * 60_000,
	git: 30_000,
};

export const reviewRemoteCacheDirectory = (userDataPath: string) => join(userDataPath, "whiteboard-remote-cache");

const REGISTRY = "https://registry.npmjs.org";
const NODE_DIST = "https://nodejs.org/dist";

export async function remoteArtifacts(
	target: ReviewRemoteTarget,
	options: ReviewRemoteArtifactsOptions,
): Promise<{ package: ReviewRemoteArtifact; node: ReviewRemoteArtifact }> {
	const { pin } = options;
	if (pin) {
		const { name, version, integrity } = pin.package;
		const node = pin.node[target];
		return {
			package: { name: tarballName(name, version), url: `${REGISTRY}/${name}/-/${name.split("/").at(-1)}-${version}.tgz`, integrity },
			node: { name: node.url.split("/").at(-1)!, url: node.url, sha256: node.sha256 },
		};
	}
	if (!options.checkout) throw new Error("This build has no pinned remote package and no checkout to pack one from.");
	await mkdir(options.cacheDirectory, { recursive: true });
	return {
		package: await packCheckout(options.checkout, options.cacheDirectory, options.devVersion),
		node: await developmentNode(target, options.checkout, options.cacheDirectory, options.nodeDist ?? NODE_DIST),
	};
}

export async function remotePackageIntegrity(options: ReviewRemoteArtifactsOptions): Promise<string> {
	if (options.pin) return options.pin.package.integrity;
	if (!options.checkout) throw new Error("This build has no pinned remote package and no checkout to pack one from.");
	await mkdir(options.cacheDirectory, { recursive: true });
	const { integrity } = await packCheckout(options.checkout, options.cacheDirectory, options.devVersion);
	return integrity!;
}

const tarballName = (name: string, version: string) => `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;

function cachePath(cacheDirectory: string, artifact: ReviewRemoteArtifact): string {
	if (artifact.integrity) {
		const match = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(artifact.integrity);
		if (!match) throw new Error(`${artifact.name} has a malformed integrity.`);
		return join(cacheDirectory, `sha512-${Buffer.from(match[1], "base64").toString("hex")}`);
	}
	if (artifact.sha256 && /^[0-9a-f]{64}$/.test(artifact.sha256)) return join(cacheDirectory, `sha256-${artifact.sha256}`);
	throw new Error(`${artifact.name} has no checksum to verify it by.`);
}

async function digest(file: string, algorithm: "sha256" | "sha512", encoding: "hex" | "base64"): Promise<string> {
	const hash = createHash(algorithm);
	for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
	return hash.digest(encoding);
}

async function matches(file: string, artifact: ReviewRemoteArtifact): Promise<boolean> {
	if (artifact.integrity && `sha512-${await digest(file, "sha512", "base64")}` !== artifact.integrity) return false;
	if (artifact.sha256 && (await digest(file, "sha256", "hex")) !== artifact.sha256) return false;
	return true;
}

async function exists(file: string): Promise<boolean> {
	return stat(file).then(
		() => true,
		() => false,
	);
}

async function verify(file: string, artifact: ReviewRemoteArtifact): Promise<void> {
	if (await matches(file, artifact)) return;
	await rm(file, { force: true });
	throw new Error(`${artifact.name} does not match its pinned checksum; the file was deleted.`);
}

export async function fetchToLaptopCache(artifact: ReviewRemoteArtifact, options: { cacheDirectory: string }): Promise<string> {
	const file = cachePath(options.cacheDirectory, artifact);
	if (await exists(file)) {
		await verify(file, artifact);
		return file;
	}
	if (!/^https?:/.test(artifact.url)) throw new Error(`${artifact.name} is not in the laptop cache.`);
	await mkdir(options.cacheDirectory, { recursive: true });
	const part = `${file}.${randomBytes(4).toString("hex")}.part`;
	try {
		const response = await fetch(artifact.url, { signal: AbortSignal.timeout(REVIEW_REMOTE_ARTIFACT_TIMEOUTS.download) });
		if (!response.ok || !response.body) throw new Error(`Downloading ${artifact.name} failed: ${artifact.url} answered ${response.status}.`);
		await pipeline(response.body, createWriteStream(part));
		await verify(part, artifact);
		await rename(part, file);
	} finally {
		await rm(part, { force: true });
	}
	return file;
}

function run(command: string, args: string[], cwd: string, timeout: number, data: (chunk: Buffer) => void = () => {}): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout, killSignal: "SIGKILL" });
		let stderr = "";
		child.stdout.on("data", data);
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-2000)));
		child.once("error", reject);
		child.once("close", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`${command} ${args.join(" ")} ${signal ? `was stopped (${signal})` : `exited with ${code}`}: ${stderr.trim()}`));
		});
	});
}

async function checkoutState(checkout: string): Promise<string> {
	const hash = createHash("sha256");
	const feed = (chunk: Buffer) => hash.update(chunk);
	const git = (...args: string[]) => run("git", args, checkout, REVIEW_REMOTE_ARTIFACT_TIMEOUTS.git, feed);
	await git("rev-parse", "HEAD");
	await git("status", "--porcelain=v1", "-z", "--untracked-files=all");
	await git("diff", "HEAD", "--binary");
	return hash.digest("hex").slice(0, 40);
}

async function packCheckout(checkout: string, cacheDirectory: string, devVersion: string | undefined): Promise<ReviewRemoteArtifact> {
	const state = await checkoutState(checkout);
	const record = join(cacheDirectory, `dev-pack-${state}${devVersion ? `-${devVersion}` : ""}.json`);
	const previous = await readFile(record, "utf8").then(
		(text) => JSON.parse(text) as ReviewRemoteArtifact,
		() => undefined,
	);
	if (previous && (await exists(cachePath(cacheDirectory, previous)))) return previous;

	const directory = join(checkout, "packages", "review");
	const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { name: string; version: string };
	const version = devVersion ?? manifest.version;
	const scratch = await mkdtemp(join(cacheDirectory, "dev-pack-"));
	try {
		await run("node", ["scripts/pack-review-cli.mjs", "--dev", state, scratch, ...(devVersion ? [devVersion] : [])], checkout, REVIEW_REMOTE_ARTIFACT_TIMEOUTS.pack);
		const [packed] = (await readdir(scratch)).filter((name) => name.endsWith(".tgz"));
		if (!packed) throw new Error(`Packing ${directory} wrote no tarball.`);
		const integrity = `sha512-${await digest(join(scratch, packed), "sha512", "base64")}`;
		const file = cachePath(cacheDirectory, { name: packed, url: "", integrity });
		await rename(join(scratch, packed), file);
		const artifact = { name: tarballName(manifest.name, version), url: pathToFileURL(file).href, integrity };
		await writeFile(record, JSON.stringify(artifact));
		return artifact;
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

async function developmentNode(target: ReviewRemoteTarget, checkout: string, cacheDirectory: string, dist: string): Promise<ReviewRemoteArtifact> {
	const nvmrc = join(checkout, "apps", "review-desktop", "code-oss", ".nvmrc");
	const version = (await readFile(nvmrc, "utf8")).trim();
	if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${nvmrc} does not hold an exact Node version.`);
	const sums = join(cacheDirectory, `node-v${version}-SHASUMS256.txt`);
	let text = await readFile(sums, "utf8").catch(() => undefined);
	if (text === undefined) {
		const url = `${dist}/v${version}/SHASUMS256.txt`;
		const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
		if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
		text = await response.text();
		await writeFile(sums, text);
	}
	const name = `node-v${version}-${target}.tar.xz`;
	const sha256 = text
		.split("\n")
		.map((line) => line.trim().split(/\s+/))
		.find(([, file]) => file === name)?.[0];
	if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`SHASUMS256.txt for Node ${version} has no line for ${name}.`);
	return { name, url: `${dist}/v${version}/${name}`, sha256 };
}
