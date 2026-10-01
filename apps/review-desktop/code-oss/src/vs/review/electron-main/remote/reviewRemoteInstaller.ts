/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

import { fetchToLaptopCache, type ReviewRemoteArtifact } from "./reviewRemoteArtifacts.js";
import { runSsh, type RunResult, type SpawnSsh, type SshChildProcess } from "./reviewRemoteHost.js";
import {
	cleanupScript,
	completeScript,
	diffrScript,
	downloadScript,
	finishScript,
	lockScript,
	nodePlaceScript,
	nodeTarball,
	packageInstallScript,
	packageTarball,
	partScript,
	prepareScript,
	refreshScript,
	releaseScript,
	REVIEW_REMOTE_INSTALL_SAY,
	REVIEW_REMOTE_LOCK_STALE_SECONDS,
	REVIEW_REMOTE_VERSION,
	REVIEW_REMOTE_WRAPPER_MARK,
	reviewRemoteNodeDir,
	reviewRemoteVersionDir,
	shellQuote,
	verifyScript,
	type ReviewRemoteInstallContext,
} from "./reviewRemoteInstallScript.js";
import type { ReviewRemoteProbe, ReviewRemoteTarget } from "./reviewRemoteProbe.js";
import { startRegistryRelay, type ReviewRegistryRelay } from "./reviewRemoteRegistryRelay.js";
import { uploadFile } from "./reviewRemoteUpload.js";
import { sshExecArgs, sshRemoteForwardArgs, type ReviewSshSession } from "./reviewSshCommand.js";

export type ReviewRemoteInstallProgress =
	| { step: "waiting-for-lock" }
	| { step: "node"; via: "remote-download" | "upload" }
	| { step: "package"; via: "remote-download" | "upload" }
	| { step: "verifying" }
	| { step: "done"; cliPath: string };

export const REVIEW_REMOTE_INSTALL_TIMEOUTS = {
	/** One short script: lock, prepare, verify, finish. */
	step: 30_000,
	/** A download on the remote. */
	download: 15 * 60_000,
	/** npm installing the package and its dependencies. */
	npm: 10 * 60_000,
	/** The package's diffr fetch; it bounds itself at 15 s. */
	diffr: 60_000,
	/** Waiting for another install's lock. */
	lockWait: REVIEW_REMOTE_LOCK_STALE_SECONDS * 1000,
	/** A lock not refreshed for this long is taken over; uploads refresh it every fifth of this. */
	lockStale: REVIEW_REMOTE_LOCK_STALE_SECONDS * 1000,
	lockPoll: 2_000,
	/** Releasing the lock, also after an abort. */
	release: 15_000,
};

export interface ReviewRemoteInstallInput {
	readonly session: ReviewSshSession;
	readonly probe: ReviewRemoteProbe;
	readonly target: ReviewRemoteTarget;
	/** The package's version: the pin's, or a development pack's own. */
	readonly version: string;
	onProgress(progress: ReviewRemoteInstallProgress): void;
	readonly signal: AbortSignal;
	/** From `remoteArtifacts`. */
	readonly artifacts: { readonly package: ReviewRemoteArtifact; readonly node: ReviewRemoteArtifact };
	/** A release build's package is on the registry, so the remote may fetch it; a development pack is always uploaded. */
	readonly published: boolean;
	readonly cacheDirectory: string;
	readonly spawn: SpawnSsh;
	readonly env: NodeJS.ProcessEnv;
	/** Shown to another install that finds the lock taken. */
	readonly owner?: string;
	readonly timeouts?: Partial<typeof REVIEW_REMOTE_INSTALL_TIMEOUTS>;
}

export interface ReviewRemoteInstallResult {
	/** The package's CLI entry, run with `nodePath`. */
	readonly cliPath: string;
	readonly nodePath: string;
	/** `versions/<v>/whiteboard`, which runs the CLI with its Node. */
	readonly launcher: string;
	/** Whether diffr is present; its absence only turns structural diff off. */
	readonly diffr: boolean;
}

const BIN = /^[\w.-]+(\/[\w.-]+)*$/;

/**
 * Puts one complete, verified version on the remote, or leaves it as it was
 * apart from `.part` directories, which the next install removes. See
 * `reviewRemoteInstallScript.ts` for the steps on the remote.
 */
export async function installRemote(input: ReviewRemoteInstallInput): Promise<ReviewRemoteInstallResult> {
	const { session, probe, signal } = input;
	const timeouts = { ...REVIEW_REMOTE_INSTALL_TIMEOUTS, ...input.timeouts };
	const alias = session.alias;
	signal.throwIfAborted();
	// The marker is JSON read back with sed: no quote or backslash in any path it holds.
	for (const path of [probe.home, probe.node?.path, probe.npm]) {
		if (path && /['"\\]/.test(path)) throw new Error(`Whiteboard cannot install on ${alias}: ${JSON.stringify(path)} holds a quote or backslash.`);
	}
	if (!REVIEW_REMOTE_VERSION.test(input.version)) throw new Error(`${JSON.stringify(input.version)} is not a version.`);
	const { integrity, sha512, nodeVersion, nodeSha256 } = pinned(input.artifacts);
	if (!input.artifacts.node.name.endsWith(`-${input.target}.tar.xz`)) throw new Error(`${input.artifacts.node.name} is not the Node for ${input.target}.`);

	const context: ReviewRemoteInstallContext = { home: probe.home, token: randomBytes(8).toString("hex") };
	const owner = (input.owner ?? hostname()).replace(/[^\w.-]/g, "-").slice(0, 64) || "unknown";

	// Every ssh child of this install, so an abort can end the one running.
	const children = new Set<SshChildProcess>();
	const tracked: SpawnSsh = (args, options) => {
		const child = input.spawn(args, options);
		children.add(child);
		child.once("close", () => children.delete(child));
		return child;
	};
	// Closing its pipes too: whatever still writes into them sees them gone.
	const onAbort = () => {
		for (const child of children) {
			child.kill("SIGKILL");
			child.stdout?.destroy();
			child.stderr?.destroy();
		}
	};
	signal.addEventListener("abort", onAbort, { once: true });

	const run = async (what: string, script: string, timeout = timeouts.step): Promise<Answer> => {
		signal.throwIfAborted();
		const result = await runSsh(tracked, input.env, sshExecArgs(session, input.env), timeout, script);
		signal.throwIfAborted();
		return answer(alias, what, result, timeout);
	};

	let relay: { server: ReviewRegistryRelay; forwarded: boolean } | undefined;
	let locking = false;
	try {
		const complete = await alreadyComplete();
		if (complete) return complete;
		locking = true;
		await takeLock();
		return await install();
	} finally {
		signal.removeEventListener("abort", onAbort);
		if (relay) await closeRelay(relay);
		// Also when taking it failed: a lock script ended midway may have taken it. It releases only this install's lock.
		if (locking) await runSsh(input.spawn, input.env, sshExecArgs(session, input.env), timeouts.release, releaseScript(context));
	}

	/** The version already complete, read and its diffr ensured in one script, without the lock. */
	async function alreadyComplete(): Promise<ReviewRemoteInstallResult | undefined> {
		const checked = await run("checking the installed version", completeScript(context, { version: input.version, integrity }), timeouts.diffr).catch((error: unknown) => {
			if (signal.aborted) throw error;
			return undefined;
		});
		const marker = checked?.has("COMPLETE") ? readMarker(checked.get("MARKER")) : undefined;
		if (!marker) return undefined;
		const launcher = `${reviewRemoteVersionDir(probe.home, input.version)}/whiteboard`;
		input.onProgress({ step: "done", cliPath: marker.cli });
		return { nodePath: marker.node, cliPath: marker.cli, launcher, diffr: diffrReady(checked!.lines) };
	}

	async function takeLock(): Promise<void> {
		const deadline = Date.now() + timeouts.lockWait;
		let told = false;
		for (;;) {
			const says = await run("taking the install lock", lockScript(context, owner, Math.ceil(timeouts.lockStale / 1000)));
			if (says.has("LOCKED")) return;
			const holder = says.get("BUSY");
			if (holder === undefined) throw says.failure();
			if (Date.now() >= deadline) {
				throw new Error(`Another install on ${alias} (${holder || "unknown"}) held the lock for ${timeouts.lockWait / 60_000} minutes.`);
			}
			if (!told) input.onProgress({ step: "waiting-for-lock" });
			told = true;
			await delay(timeouts.lockPoll, signal);
		}
	}

	async function install(): Promise<ReviewRemoteInstallResult> {
		const prepared = await run("preparing", prepareScript(context, { version: input.version, integrity, nodeVersion }));
		if (!prepared.has("PREPARED")) throw prepared.failure();

		if (prepared.has("COMPLETE")) {
			const marker = readMarker(prepared.get("MARKER"));
			if (marker) return finish({ nodePath: marker.node, cliPath: marker.cli, launcher: `${reviewRemoteVersionDir(probe.home, input.version)}/whiteboard` });
		}

		const { node, npm } = await ensureNode(prepared.has("MANAGED-NODE"));
		await placePackage(node, npm);
		if (relay) await closeRelay(relay);
		relay = undefined;

		input.onProgress({ step: "verifying" });
		const verified = await run("verifying", verifyScript(context, { version: input.version, node }));
		const bin = verified.get("BIN");
		if (bin === undefined || !BIN.test(bin) || bin.split("/").includes("..")) throw verified.failure();
		const reported = parseVersion(verified.get("VERSION"));
		if (reported !== input.version) {
			throw new Error(`The package installed on ${alias} reports version ${reported ?? "nothing"}, not ${input.version}.`);
		}

		const dir = reviewRemoteVersionDir(probe.home, input.version);
		const cliPath = `${dir}/node_modules/@dev.fast/whiteboard/${bin}`;
		const launcher = `${dir}/whiteboard`;
		const newest = [input.version, ...prepared.all("HAVE").filter((name) => REVIEW_REMOTE_VERSION.test(name))].sort(compareVersions).at(-1);
		const finished = await run(
			"finishing",
			finishScript(context, {
				version: input.version,
				launcher: `#!/bin/sh\nexec ${shellQuote(node)} ${shellQuote(cliPath)} "$@"\n`,
				marker: JSON.stringify({ version: input.version, integrity, node, cli: cliPath, installedAt: Math.floor(Date.now() / 1000) }),
				wrapper: newest === input.version ? `#!/bin/sh\n${REVIEW_REMOTE_WRAPPER_MARK}\nexec ${shellQuote(launcher)} "$@"\n` : undefined,
			}),
		);
		if (!finished.has("COMPLETE")) throw finished.failure();
		await cleanup(prepared.all("HAVE"), newest);
		return finish({ nodePath: node, cliPath, launcher });
	}

	/** Keeps this version, the newest and one more, preferring one a process runs from; the version is installed whatever happens here. */
	async function cleanup(have: string[], newest: string | undefined): Promise<void> {
		const keep = new Set([input.version, newest]);
		const candidates = have.filter((name) => REVIEW_REMOTE_VERSION.test(name) && !keep.has(name)).sort(compareVersions).reverse();
		if (!candidates.length) return;
		await run("removing old versions", cleanupScript(context, { candidates, room: 2 - keep.size })).catch((error: unknown) => {
			if (signal.aborted) throw error;
		});
	}

	async function finish(paths: Omit<ReviewRemoteInstallResult, "diffr">): Promise<ReviewRemoteInstallResult> {
		const fetched = await run("fetching diffr", diffrScript(context, { launcher: paths.launcher }), timeouts.diffr).catch((error: unknown) => {
			if (signal.aborted) throw error;
			return undefined;
		});
		const diffr = diffrReady(fetched?.lines ?? []);
		input.onProgress({ step: "done", cliPath: paths.cliPath });
		return { ...paths, diffr };
	}

	/** The probe's Node 24 with its npm, else the pinned Node under `node/`, installed if missing. */
	async function ensureNode(managed: boolean): Promise<{ node: string; npm: string }> {
		if (probe.node && probe.npm) return { node: probe.node.path, npm: probe.npm };
		const bin = `${reviewRemoteNodeDir(probe.home, nodeVersion)}/bin`;
		const paths = { node: `${bin}/node`, npm: `${bin}/npm` };
		if (managed) return paths;

		const missing = (["tar", "xz", "sha256sum"] as const).filter((tool) => !probe.tools.includes(tool));
		if (missing.length) throw new Error(`${alias} has no Node 24, and Whiteboard needs ${missing.join(", ")} there to install one.`);
		await fetchOnRemote("node", { node: nodeVersion }, input.artifacts.node, nodeTarball(context, nodeVersion), true);
		const placed = await run("unpacking Node", nodePlaceScript(context, { nodeVersion: nodeVersion, sha256: nodeSha256 }), timeouts.npm);
		if (placed.has("MISMATCH")) throw new Error(`The Node tarball on ${alias} does not match its pinned checksum; it was removed.`);
		if (!placed.has("NODE-OK")) throw placed.failure();
		return paths;
	}

	async function placePackage(node: string, npm: string): Promise<void> {
		if (!probe.tools.includes("sha512sum") && !probe.tools.includes("openssl")) {
			throw new Error(`Whiteboard needs sha512sum or openssl on ${alias} to check the package.`);
		}
		await fetchOnRemote("package", { package: input.version }, input.artifacts.package, packageTarball(context, input.version), input.published);
		const registry = probe.registryReachable ? undefined : await startRelay();
		const installed = await run(
			"installing the package",
			packageInstallScript(context, {
				version: input.version,
				sha512,
				node,
				npm,
				registry,
			}),
			timeouts.npm,
		);
		if (installed.has("MISMATCH")) throw new Error(`The package on ${alias} does not match its pinned integrity; it was removed.`);
		if (!installed.has("INSTALLED")) throw installed.failure();
	}

	/**
	 * Puts `artifact` at `file` in a fresh work directory: fetched by the
	 * remote when it can reach the internet, else, or when that fails,
	 * uploaded from the laptop's cache. The next script checks it.
	 */
	async function fetchOnRemote(
		step: "node" | "package",
		part: { node: string } | { package: string },
		artifact: ReviewRemoteArtifact,
		file: string,
		remoteMayFetch: boolean,
	): Promise<void> {
		const ready = await run("creating a work directory", partScript(context, part));
		if (!ready.has("READY")) throw ready.failure();
		if (remoteMayFetch && probe.downloader && probe.registryReachable && /^https?:/.test(artifact.url)) {
			input.onProgress({ step, via: "remote-download" });
			const downloaded = await run(`downloading ${artifact.name}`, downloadScript(context, { url: artifact.url, file, downloader: probe.downloader }), timeouts.download);
			if (downloaded.has("DOWNLOADED")) return;
		}
		input.onProgress({ step, via: "upload" });
		// An abort stops waiting; the download itself finishes into the cache, verified, for next time.
		const local = await abortable(fetchToLaptopCache(artifact, { cacheDirectory: input.cacheDirectory }), signal);
		// The upload runs no script of ours, so the lock is refreshed beside it.
		const refresh = setInterval(() => void runSsh(tracked, input.env, sshExecArgs(session, input.env), timeouts.step, refreshScript(context)), timeouts.lockStale / 5);
		try {
			await uploadFile(session, local, file, { spawn: tracked, env: input.env });
		} catch (error) {
			signal.throwIfAborted();
			throw error;
		} finally {
			clearInterval(refresh);
		}
	}

	/** The relay, forwarded to a port the remote picks; its address on the remote. */
	async function startRelay(): Promise<string> {
		const server = await startRegistryRelay();
		relay = { server, forwarded: false };
		const result = await runSsh(tracked, input.env, sshRemoteForwardArgs(session, server.port, "forward", input.env), timeouts.step);
		signal.throwIfAborted();
		const port = Number(result.stdout.trim());
		if (result.code !== 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
			throw new Error(`${alias} cannot reach the npm registry, and forwarding a port to Desktop's relay failed: ${result.stderr.trim().split("\n").at(-1) ?? `exit ${result.code}`}`);
		}
		relay.forwarded = true;
		return `http://127.0.0.1:${port}/`;
	}

	async function closeRelay({ server, forwarded }: { server: ReviewRegistryRelay; forwarded: boolean }): Promise<void> {
		if (forwarded) await runSsh(input.spawn, input.env, sshRemoteForwardArgs(session, server.port, "cancel", input.env), timeouts.release).catch(() => undefined);
		await server.close();
	}
}

const diffrReady = (lines: string[]) => lines.some((line) => /^\{"event":"remote\.diffr","diffr":true\}$/.test(line.trim()));

/** The checksums the remote checks against, and the pinned Node's version. */
function pinned(artifacts: ReviewRemoteInstallInput["artifacts"]) {
	const integrity = artifacts.package.integrity ?? "";
	const base64 = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(integrity)?.[1];
	if (!base64) throw new Error(`${artifacts.package.name} has no sha512 integrity.`);
	const nodeVersion = /^node-v(\d+\.\d+\.\d+)-linux-(?:x64|arm64)\.tar\.xz$/.exec(artifacts.node.name)?.[1];
	const nodeSha256 = artifacts.node.sha256;
	if (!nodeVersion || !nodeSha256) throw new Error(`${artifacts.node.name} is not a pinned Linux Node.`);
	return { integrity, sha512: Buffer.from(base64, "base64").toString("hex"), nodeVersion, nodeSha256 };
}

/** What one script said: its `WHITEBOARD-INSTALL` lines, and a failure built from them. */
interface Answer {
	readonly lines: string[];
	has(word: string): boolean;
	get(word: string): string | undefined;
	all(word: string): string[];
	failure(): Error;
}

function answer(alias: string, what: string, result: RunResult, timeout: number): Answer {
	const lines = result.stdout.split("\n");
	const says = lines.flatMap((line) => {
		if (!line.startsWith(`${REVIEW_REMOTE_INSTALL_SAY} `)) return [];
		const rest = line.slice(REVIEW_REMOTE_INSTALL_SAY.length + 1);
		const space = rest.indexOf(" ");
		return [space < 0 ? [rest, ""] : [rest.slice(0, space), rest.slice(space + 1)]];
	});
	const all = (word: string) => says.filter(([said]) => said === word).map(([, value]) => value);
	return {
		lines,
		has: (word) => all(word).length > 0,
		get: (word) => all(word).at(-1),
		all,
		failure() {
			const reason = all("FAIL").at(-1);
			if (reason) return new Error(`Installing on ${alias} failed while ${what}: ${reason}.`);
			if (result.timedOut) return new Error(`Installing on ${alias} failed: ${what} took longer than ${timeout / 1000} seconds.`);
			if (result.error) return new Error(`Installing on ${alias} failed while ${what}: ${result.error.message}`);
			const stderr = result.stderr.trim().split("\n").at(-1)?.slice(0, 300);
			return new Error(`Installing on ${alias} failed while ${what}: exit ${result.code}${stderr ? `: ${stderr}` : ""}.`);
		},
	};
}

/** The probe's rule for a path read off the remote: absolute, bounded, no control characters. */
const remotePath = (value: unknown): value is string =>
	typeof value === "string" && value.startsWith("/") && value.length <= 4096 && !/[\x00-\x1f\x7f-\x9f]/.test(value);

function readMarker(text: string | undefined): { node: string; cli: string } | undefined {
	try {
		const marker = JSON.parse(text ?? "") as { node?: unknown; cli?: unknown };
		if (remotePath(marker.node) && remotePath(marker.cli)) {
			return { node: marker.node, cli: marker.cli };
		}
	} catch {
		// An unreadable marker is an incomplete version; it is installed again.
	}
	return undefined;
}

function parseVersion(text: string | undefined): string | undefined {
	try {
		const value = JSON.parse(text ?? "") as { version?: unknown };
		return typeof value.version === "string" ? value.version : undefined;
	} catch {
		return undefined;
	}
}

/** Semver order: numbers, then a release above its prereleases, then prerelease identifiers. */
export function compareVersions(a: string, b: string): number {
	const [coreA, preA] = split(a);
	const [coreB, preB] = split(b);
	for (let i = 0; i < 3; i++) if (coreA[i] !== coreB[i]) return coreA[i] - coreB[i];
	if (!preA.length || !preB.length) return preB.length - preA.length;
	for (let i = 0; i < Math.max(preA.length, preB.length); i++) {
		const x = preA[i];
		const y = preB[i];
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		if (x === y) continue;
		const nx = /^\d+$/.test(x);
		const ny = /^\d+$/.test(y);
		if (nx && ny) return Number(x) - Number(y);
		if (nx !== ny) return nx ? -1 : 1;
		return x < y ? -1 : 1;
	}
	return 0;
}

function split(version: string): [number[], string[]] {
	const dash = version.indexOf("-");
	const core = (dash < 0 ? version : version.slice(0, dash)).split(".").map(Number);
	return [core, dash < 0 ? [] : version.slice(dash + 1).split(".")];
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", stop);
			resolve();
		}, ms);
		const stop = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		signal.addEventListener("abort", stop, { once: true });
	});
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const stop = () => reject(signal.reason);
		signal.addEventListener("abort", stop, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
	});
}
