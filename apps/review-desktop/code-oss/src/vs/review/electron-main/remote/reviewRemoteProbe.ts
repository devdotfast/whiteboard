/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runSsh, type SpawnSsh } from "./reviewRemoteHost.js";
import { REVIEW_REMOTE_VERSION } from "./reviewRemoteInstallScript.js";
import { REVIEW_REMOTE_PROBE_BEGIN, REVIEW_REMOTE_PROBE_END, REVIEW_REMOTE_PROBE_PATH_CLI, REVIEW_REMOTE_PROBE_SCRIPT } from "./reviewRemoteProbeScript.js";
import { sshExecArgs, type ReviewSshSession } from "./reviewSshCommand.js";

export interface ReviewRemoteProbe {
	os: string;
	arch: string;
	glibc: string | null;
	home: string;
	root: string;
	homeWritable: boolean;
	freeBytes: number;
	node: { path: string; version: string } | null;
	npm: string | null;
	installed: ReviewRemoteInstalled[];
	managedNode: string | null;
	pathCli: { path: string; version: string | null } | null;
	downloader: "curl" | "wget" | null;
	registryReachable: boolean;
	tools: ReviewRemoteTool[];
}

export const REVIEW_REMOTE_PROBE_TOOLS = ["tar", "xz", "sha256sum", "sha512sum", "openssl"] as const;
export type ReviewRemoteTool = (typeof REVIEW_REMOTE_PROBE_TOOLS)[number];

export type ReviewRemoteTarget = "linux-x64" | "linux-arm64";

export interface ReviewRemoteInstalled {
	version: string;
	integrity: string;
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
	timeout?: number;
}): Promise<ReviewRemoteProbeResult> {
	const timeout = input.timeout ?? REVIEW_REMOTE_PROBE_TIMEOUT;
	const alias = input.session.alias;
	const result = await runSsh(input.spawn, input.env, sshExecArgs(input.session, input.env), timeout, REVIEW_REMOTE_PROBE_SCRIPT);
	if (result.error) return { error: `The probe of ${alias} could not start: ${result.error.message}` };
	const parsed = parseRemoteProbe(result.stdout);
	if ("probe" in parsed) return parsed;
	if (result.timedOut) return { error: `The probe of ${alias} did not answer within ${timeout / 1000} seconds.` };
	const stderr = result.stderr.trim().split("\n").at(-1)?.slice(0, 300);
	return { error: `The probe of ${alias} failed: ${parsed.error}${result.code ? ` It exited with ${result.code}${stderr ? `: ${stderr}` : ""}.` : ""}` };
}

const LINE_LIMIT = 64 * 1024;
const STRING_LIMIT = 4096;
const INSTALLED_LIMIT = 256;
const WORD = /^[\w.-]{1,64}$/;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;

export function parseRemoteProbe(stdout: string): ReviewRemoteProbeResult {
	const begin = stdout.indexOf(REVIEW_REMOTE_PROBE_BEGIN);
	const end = begin < 0 ? -1 : stdout.indexOf(REVIEW_REMOTE_PROBE_END, begin + REVIEW_REMOTE_PROBE_BEGIN.length);
	if (end < 0) return { error: "it printed no answer between its sentinels." };
	const line = stdout.slice(begin + REVIEW_REMOTE_PROBE_BEGIN.length, end).trim();
	if (line.length > LINE_LIMIT) return { error: "its answer is too long." };
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return { error: "its answer is not JSON." };
	}
	try {
		return { probe: { ...readProbe(value), pathCli: readPathCli(stdout.slice(end)) } };
	} catch (error) {
		return { error: `its answer is malformed: ${(error as Error).message}` };
	}
}

function readPathCli(after: string): ReviewRemoteProbe["pathCli"] {
	const line = after.split("\n").find((candidate) => candidate.startsWith(`${REVIEW_REMOTE_PROBE_PATH_CLI} `));
	try {
		const cli = object(JSON.parse(line?.slice(REVIEW_REMOTE_PROBE_PATH_CLI.length + 1) ?? "null"), "pathCli");
		const { version } = cli;
		return { path: path(cli.path, "pathCli.path"), version: typeof version === "string" && version.length <= 128 && REVIEW_REMOTE_VERSION.test(version) ? version : null };
	} catch {
		return null;
	}
}

function readProbe(value: unknown): Omit<ReviewRemoteProbe, "pathCli"> {
	const record = object(value, "the answer");
	const node = record.node === null ? null : object(record.node, "node");
	const installed = record.installed;
	if (!Array.isArray(installed) || installed.length > INSTALLED_LIMIT) throw new Error("installed is not a short list.");
	const glibc = nullable(record.glibc, "glibc", (v) => string(v, "glibc", /^\d{1,4}\.\d{1,4}(\.\d{1,6})?$/));
	const downloader = nullable(record.downloader, "downloader", (v) => {
		if (v !== "curl" && v !== "wget") throw new Error("downloader is neither curl nor wget.");
		return v;
	});
	const tools = record.tools;
	if (!Array.isArray(tools) || tools.length > INSTALLED_LIMIT) throw new Error("tools is not a short list.");
	if (record.root === "") throw new Error("DEV_REVIEW_HOME there is not an absolute, normalised path.");
	const freeBytes = record.freeBytes;
	if (typeof freeBytes !== "number" || !Number.isSafeInteger(freeBytes) || freeBytes < 0) throw new Error("freeBytes is not a byte count.");
	return {
		os: string(record.os, "os", WORD),
		arch: string(record.arch, "arch", WORD),
		glibc,
		home: path(record.home, "home"),
		root: path(record.root, "root"),
		homeWritable: boolean(record.homeWritable, "homeWritable"),
		freeBytes,
		node: node && { path: path(node.path, "node.path"), version: string(node.version, "node.version", /^24\.\d{1,4}\.\d{1,4}$/) },
		npm: nullable(record.npm, "npm", (v) => path(v, "npm")),
		installed: installed.flatMap((entry): ReviewRemoteInstalled[] => {
			if (!entry || typeof entry !== "object") return [];
			const { version, integrity } = entry as Record<string, unknown>;
			return typeof version === "string" && version.length <= 128 && REVIEW_REMOTE_VERSION.test(version) && !version.endsWith(".part") && typeof integrity === "string" && INTEGRITY.test(integrity)
				? [{ version, integrity }]
				: [];
		}),
		managedNode: nullable(record.managedNode, "managedNode", (v) => path(v, "managedNode")),
		downloader,
		registryReachable: boolean(record.registryReachable, "registryReachable"),
		tools: REVIEW_REMOTE_PROBE_TOOLS.filter((tool) => tools.includes(tool)),
	};
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} is not an object.`);
	return value as Record<string, unknown>;
}

function string(value: unknown, name: string, pattern: RegExp): string {
	if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${name} is not a valid value.`);
	return value;
}

function path(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.startsWith("/") || value.length > STRING_LIMIT || CONTROL.test(value)) {
		throw new Error(`${name} is not an absolute path.`);
	}
	return value;
}

function boolean(value: unknown, name: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${name} is not true or false.`);
	return value;
}

function nullable<T>(value: unknown, name: string, read: (value: unknown) => T): T | null {
	if (value === undefined) throw new Error(`${name} is missing.`);
	return value === null ? null : read(value);
}
