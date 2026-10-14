/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

import type { ReviewRemoteArtifact } from "./reviewRemoteArtifacts.js";
import { lastLine, runSsh, type RunResult, type SpawnSsh, type SshChildProcess } from "./reviewRemoteHost.js";
import { REVIEW_REMOTE_INSTALL_SAY, REVIEW_REMOTE_LOCK_STALE_SECONDS, REVIEW_REMOTE_VERSION, remoteInstallScriptInput } from "./reviewRemoteInstallScript.js";
import type { ReviewRemoteProbe, ReviewRemoteTarget } from "./reviewRemoteProbe.js";
import { sshExecArgs, type ReviewSshSession } from "./reviewSshCommand.js";

export interface ReviewRemoteInstallProgress {
	step: "waiting-for-lock" | "package" | "done";
}

const REVIEW_REMOTE_INSTALL_TIMEOUTS = {
	fetch: 25 * 60_000,
	lockWait: REVIEW_REMOTE_LOCK_STALE_SECONDS * 1000,
	lockStale: REVIEW_REMOTE_LOCK_STALE_SECONDS * 1000,
	lockPoll: 2_000,
	release: 15_000,
};

export interface ReviewRemoteInstallInput {
	readonly session: ReviewSshSession;
	readonly probe: ReviewRemoteProbe;
	readonly target: ReviewRemoteTarget;
	readonly version: string;
	onProgress(progress: ReviewRemoteInstallProgress): void;
	readonly signal: AbortSignal;
	readonly artifact: ReviewRemoteArtifact;
	/** packages/review/remote/install.sh. */
	readonly script: string;
	readonly spawn: SpawnSsh;
	readonly env: NodeJS.ProcessEnv;
	readonly owner?: string;
	readonly timeouts?: Partial<typeof REVIEW_REMOTE_INSTALL_TIMEOUTS>;
}

export interface ReviewRemoteInstallResult {
	readonly cliPath: string;
	readonly nodePath: string;
}

export async function installRemote(input: ReviewRemoteInstallInput): Promise<ReviewRemoteInstallResult> {
	const { session, probe, signal, artifact } = input;
	const timeouts = { ...REVIEW_REMOTE_INSTALL_TIMEOUTS, ...input.timeouts };
	const alias = session.alias;
	signal.throwIfAborted();
	// The marker is JSON read back with sed: no quote or backslash in any path it holds.
	for (const path of [probe.home, probe.root]) {
		if (/['"\\]/.test(path)) throw new Error(`Whiteboard cannot install on ${alias}: ${JSON.stringify(path)} holds a quote or backslash.`);
	}
	if (!REVIEW_REMOTE_VERSION.test(input.version)) throw new Error(`${JSON.stringify(input.version)} is not a version.`);
	const { sha256 } = artifact;
	if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${artifact.name} has no sha256.`);
	if (!artifact.name.endsWith(`-${input.target}.tar.xz`)) throw new Error(`${artifact.name} is not the tarball for ${input.target}.`);

	const token = randomBytes(8).toString("hex");
	const owner = (input.owner ?? hostname()).replace(/[^\w.-]/g, "-").slice(0, 64) || "unknown";
	const seconds = (ms: number) => String(ms / 1000);
	const args = [
		"install",
		...["--version", input.version, "--sha256", sha256, "--url", artifact.url, "--owner", owner, "--token", token],
		...(probe.downloader ? ["--downloader", probe.downloader] : []),
		...["--lock-wait", seconds(timeouts.lockWait), "--lock-poll", seconds(timeouts.lockPoll), "--lock-stale", String(Math.ceil(timeouts.lockStale / 1000))],
	];

	const children = new Set<SshChildProcess>();
	const tracked: SpawnSsh = (spawnArgs, options) => {
		const child = input.spawn(spawnArgs, options);
		children.add(child);
		child.once("close", () => children.delete(child));
		return child;
	};
	const onAbort = () => {
		for (const child of children) {
			child.kill("SIGKILL");
			child.stdout?.destroy();
			child.stderr?.destroy();
		}
	};
	signal.addEventListener("abort", onAbort, { once: true });

	let pending = "";
	const told = new Set<string>();
	const onStdout = (chunk: string) => {
		const lines = (pending + chunk).split("\n");
		pending = lines.pop() ?? "";
		for (const line of lines) {
			const step = line.startsWith(`${REVIEW_REMOTE_INSTALL_SAY} STEP `) ? line.slice(REVIEW_REMOTE_INSTALL_SAY.length + 6).trim() : undefined;
			if ((step === "waiting-for-lock" || step === "package") && !told.has(step)) {
				told.add(step);
				input.onProgress({ step });
			}
		}
	};

	const timeout = timeouts.lockWait + timeouts.fetch + 60_000;
	let result: RunResult;
	try {
		result = await runSsh(tracked, input.env, sshExecArgs(session, input.env), timeout, remoteInstallScriptInput(input.script, args), onStdout);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
	const says = answer(alias, result, timeout);
	if (signal.aborted || result.timedOut) {
		await runSsh(input.spawn, input.env, sshExecArgs(session, input.env), timeouts.release, remoteInstallScriptInput(input.script, ["release", "--token", token]));
		signal.throwIfAborted();
	}
	const done = readMarker(says.get("DONE"));
	if (done) {
		input.onProgress({ step: "done" });
		return done;
	}
	const mismatch = says.get("MISMATCH");
	if (mismatch !== undefined) {
		throw new Error(`The tarball on ${alias} does not match its pinned checksum${mismatch ? "" : " (no checksum tool answered)"}; it was removed.`);
	}
	const holder = says.get("BUSY");
	if (holder !== undefined) {
		throw new Error(`Another install on ${alias} (${holder || "unknown"}) held the lock for ${timeouts.lockWait / 60_000} minutes.`);
	}
	throw says.failure();
}

interface Answer {
	get(word: string): string | undefined;
	failure(): Error;
}

function answer(alias: string, result: RunResult, timeout: number): Answer {
	const says = result.stdout.split("\n").flatMap((line) => {
		if (!line.startsWith(`${REVIEW_REMOTE_INSTALL_SAY} `)) return [];
		const rest = line.slice(REVIEW_REMOTE_INSTALL_SAY.length + 1);
		const space = rest.indexOf(" ");
		return [space < 0 ? [rest, ""] : [rest.slice(0, space), rest.slice(space + 1)]];
	});
	const get = (word: string) => says.filter(([said]) => said === word).at(-1)?.[1];
	return {
		get,
		failure() {
			const reason = get("FAIL");
			if (reason) return new Error(`Installing on ${alias} failed: ${reason}.`);
			if (result.timedOut) return new Error(`Installing on ${alias} failed: it took longer than ${timeout / 1000} seconds.`);
			if (result.error) return new Error(`Installing on ${alias} failed: ${result.error.message}`);
			const stderr = lastLine(result.stderr);
			return new Error(`Installing on ${alias} failed: exit ${result.code}${stderr ? `: ${stderr}` : ""}.`);
		},
	};
}

function readMarker(text: string | undefined): ReviewRemoteInstallResult | undefined {
	try {
		const marker = JSON.parse(text ?? "") as { node?: unknown; cli?: unknown };
		if (typeof marker.node === "string" && typeof marker.cli === "string") return { nodePath: marker.node, cliPath: marker.cli };
	} catch {
	}
	return undefined;
}
