/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { lastLine, runSsh, type SpawnSsh } from "./reviewRemoteHost.js";
import { remoteInstallScriptInput } from "./reviewRemoteInstallScript.js";
import { sshExecArgs, type ReviewSshSession } from "./reviewSshCommand.js";

export const REVIEW_REMOTE_PROBE_BEGIN = "WHITEBOARD-PROBE-BEGIN";
export const REVIEW_REMOTE_PROBE_END = "WHITEBOARD-PROBE-END";
export const REVIEW_REMOTE_PROBE_PATH_CLI = "WHITEBOARD-PROBE-PATH-CLI";

export interface ReviewRemoteProbe {
	os: string;
	arch: string;
	glibc: string | null;
	home: string;
	root: string;
	homeWritable: boolean;
	freeBytes: number;
	installed: ReviewRemoteInstalled[];
	pathCli: { path: string; version: string | null } | null;
	downloader: "curl" | "wget" | null;
	releasesReachable: boolean;
	tools: ReviewRemoteTool[];
}

export const REVIEW_REMOTE_PROBE_TOOLS = ["tar", "xz", "sha256sum", "openssl"] as const;
export type ReviewRemoteTool = (typeof REVIEW_REMOTE_PROBE_TOOLS)[number];

export type ReviewRemoteTarget = "linux-x64" | "linux-arm64";

export interface ReviewRemoteInstalled {
	version: string;
	sha256: string;
}

export type ReviewRemoteSupport = { supported: true; target: ReviewRemoteTarget } | { supported: false; reason: string };

export const REVIEW_REMOTE_PROBE_TIMEOUT = 10_000;

const TARGETS: Record<string, ReviewRemoteTarget> = { x86_64: "linux-x64", aarch64: "linux-arm64" };
const GLIBC_FLOOR = [2, 34] as const;
const GB = 1_000_000_000;

export function judgeRemote(probe: ReviewRemoteProbe): ReviewRemoteSupport {
	if (probe.os !== "Linux") return refuse(`This host runs ${probe.os}; Whiteboard needs Linux.`);
	const target = TARGETS[probe.arch];
	if (!target) return refuse(`This host's CPU is ${probe.arch}; Whiteboard needs x86_64 or aarch64.`);
	if (probe.glibc === null) {
		return refuse(`This host has no glibc (Alpine and other musl systems do not); Whiteboard needs glibc ${GLIBC_FLOOR.join(".")} or newer.`);
	}
	const [major = 0, minor = 0] = probe.glibc.split(".").map(Number);
	if (major < GLIBC_FLOOR[0] || (major === GLIBC_FLOOR[0] && minor < GLIBC_FLOOR[1])) {
		return refuse(`This host runs glibc ${probe.glibc}; Whiteboard needs ${GLIBC_FLOOR.join(".")} or newer.`);
	}
	if (!probe.homeWritable) return refuse(`The home directory ${probe.home} cannot be written; Whiteboard needs to write under it.`);
	if (probe.freeBytes < GB) {
		return refuse(`The home directory has ${(Math.floor(probe.freeBytes / (GB / 10)) / 10).toFixed(1)} GB free; Whiteboard needs 1 GB.`);
	}
	return { supported: true, target };
}

const refuse = (reason: string): ReviewRemoteSupport => ({ supported: false, reason });

export type ReviewRemoteProbeResult = { probe: ReviewRemoteProbe } | { error: string };

export async function probeRemote(input: {
	session: ReviewSshSession;
	spawn: SpawnSsh;
	env: NodeJS.ProcessEnv;
	/** packages/review/remote/install.sh. */
	script: string;
	releases?: string;
	timeout?: number;
}): Promise<ReviewRemoteProbeResult> {
	const timeout = input.timeout ?? REVIEW_REMOTE_PROBE_TIMEOUT;
	const alias = input.session.alias;
	const result = await runSsh(input.spawn, input.env, sshExecArgs(input.session, input.env), timeout, remoteInstallScriptInput(input.script, ["probe", ...(input.releases ? ["--releases", input.releases] : [])]));
	if (result.error) return { error: `The probe of ${alias} could not start: ${result.error.message}` };
	const parsed = parseRemoteProbe(result.stdout);
	if ("probe" in parsed) return parsed;
	if (result.timedOut) return { error: `The probe of ${alias} did not answer within ${timeout / 1000} seconds.` };
	const stderr = lastLine(result.stderr);
	return { error: `The probe of ${alias} failed: ${parsed.error}${result.code ? ` It exited with ${result.code}${stderr ? `: ${stderr}` : ""}.` : ""}` };
}

export function parseRemoteProbe(stdout: string): ReviewRemoteProbeResult {
	const begin = stdout.indexOf(REVIEW_REMOTE_PROBE_BEGIN);
	const end = begin < 0 ? -1 : stdout.indexOf(REVIEW_REMOTE_PROBE_END, begin + REVIEW_REMOTE_PROBE_BEGIN.length);
	if (end < 0) return { error: "it printed no answer between its sentinels." };
	let value: Record<string, unknown>;
	try {
		value = JSON.parse(stdout.slice(begin + REVIEW_REMOTE_PROBE_BEGIN.length, end));
	} catch {
		return { error: "its answer is not JSON." };
	}
	if (!isProbe(value)) return { error: "its answer is malformed." };
	if (value.root === "") return { error: "its answer is malformed: DEV_REVIEW_HOME there is not an absolute, normalised path." };
	return { probe: { ...value, pathCli: readPathCli(stdout.slice(end)) } };
}

function isProbe(value: Record<string, unknown> | null): value is Omit<ReviewRemoteProbe, "pathCli"> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof value.os === "string" &&
		typeof value.arch === "string" &&
		typeof value.home === "string" &&
		typeof value.root === "string" &&
		typeof value.freeBytes === "number" &&
		Array.isArray(value.installed) &&
		Array.isArray(value.tools)
	);
}

function readPathCli(after: string): ReviewRemoteProbe["pathCli"] {
	const line = after.split("\n").find((candidate) => candidate.startsWith(`${REVIEW_REMOTE_PROBE_PATH_CLI} `));
	try {
		const cli = JSON.parse(line?.slice(REVIEW_REMOTE_PROBE_PATH_CLI.length + 1) ?? "null");
		return typeof cli?.path === "string" ? { path: cli.path, version: typeof cli.version === "string" ? cli.version : null } : null;
	} catch {
		return null;
	}
}

export function missingInstallTools(probe: ReviewRemoteProbe, alias: string): string | undefined {
	const missing = (["tar", "xz"] as const).filter((tool) => !probe.tools.includes(tool));
	if (missing.length) return `${alias} needs ${missing.join(" and ")} to install Whiteboard.`;
	if (!probe.downloader) return `${alias} needs curl or wget to install Whiteboard.`;
	if (!probe.tools.includes("sha256sum") && !probe.tools.includes("openssl")) return `Whiteboard needs sha256sum or openssl on ${alias} to check the tarball.`;
	return undefined;
}
