/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { arch, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import type { SpawnSsh } from "./reviewRemoteHost.js";
import { judgeRemote, parseRemoteProbe, probeRemote, REVIEW_REMOTE_PROBE_TIMEOUT } from "./reviewRemoteProbe.js";
import { REVIEW_REMOTE_PROBE_SCRIPT } from "./reviewRemoteProbeScript.js";
import { REVIEW_SSH_CONFIG_ENV, reviewSshSession } from "./reviewSshCommand.js";

const run = promisify(execFile);
const harness = resolve(import.meta.dirname, "../../../../../../scripts/e2e/remote/remote.mjs");

function skipReason(): string | undefined {
	if (process.env.WB_TEST_CONTAINERS !== "1") return "set WB_TEST_CONTAINERS=1 to run the probe against containers";
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
	} catch {
		return "Docker is not available";
	}
	return undefined;
}

const skip = skipReason();

const runPrefix = `s3t1${randomBytes(3).toString("hex")}`;
const hosts = {
	fish: ["--shell", "fish", "--banner"],
	amd64: ["--platform", "linux/amd64"],
	old: ["--image", "debian:11", "--sealed"],
	musl: ["--image", "alpine:3.20"],
	node20: ["--node", "20"],
} as const;
type Host = keyof typeof hosts;
const runOf = (host: Host) => `${runPrefix}-${host}`;
const containerOf = (host: Host) => `wb-test-${runOf(host)}-${host}`;
const aliasOf = (host: Host) => `wb-test-${host}`;
const started = new Set<Host>();
let controlDirectory = "";

const remote = (host: Host, args: string[]) =>
	run(process.execPath, [harness, ...args], { env: { ...process.env, WB_TEST_RUN: runOf(host) }, maxBuffer: 16 << 20 });

const sshEnv = (host: Host) => ({ ...process.env, VSCODE_DEV: "1", [REVIEW_SSH_CONFIG_ENV]: `/tmp/wbt.${runOf(host)}/ssh_config` });

const realSsh: SpawnSsh = (args, options) => spawn("ssh", args, options);

async function probe(host: Host) {
	const began = Date.now();
	const result = await probeRemote({ session: reviewSshSession(aliasOf(host), controlDirectory), spawn: realSsh, env: sshEnv(host) });
	const elapsed = Date.now() - began;
	assert.ok("probe" in result, "error" in result ? result.error : "");
	assert.ok(elapsed < REVIEW_REMOTE_PROBE_TIMEOUT);
	return { probe: result.probe, elapsed };
}

async function written(host: Host) {
	const { stdout } = await remote(host, ["ssh", host, "--", "find", "~", "-newer", "/etc/hostname"]);
	return stdout
		.split("\n")
		.filter((line) => line.startsWith("/"))
		.sort();
}

before(
	async () => {
		if (skip) return;
		controlDirectory = await mkdtemp(join(tmpdir(), "wb-probe-ssh-"));
		const ups = await Promise.allSettled(
			(Object.keys(hosts) as Host[]).map(async (host) => {
				started.add(host);
				await remote(host, ["up", host, "--node", "none", ...hosts[host]]);
			}),
		);
		for (const up of ups) if (up.status === "rejected") throw up.reason;
	},
	{ timeout: 20 * 60_000 },
);

after(
	async () => {
		for (const host of started) await remote(host, ["down", "--all"]).catch((error) => console.error(error.stderr ?? error));
		if (controlDirectory) await rm(controlDirectory, { recursive: true, force: true });
	},
	{ timeout: 5 * 60_000 },
);

test("ubuntu:22.04 under dash, with a fish login shell and a banner, is supported and left as it was", { skip }, async () => {
	const before = await written("fish");
	const { probe: found } = await probe("fish");

	assert.deepEqual(judgeRemote(found), { supported: true, target: arch() === "arm64" ? "linux-arm64" : "linux-x64" });
	assert.equal(found.home, "/home/dev");
	assert.equal(found.node, null);
	assert.deepEqual(found.installed, []);
	assert.deepEqual(await written("fish"), before);
});

test("the script also runs under bash", { skip }, async () => {
	const { stdout } = await new Promise<{ stdout: string }>((resolvePromise, reject) => {
		const child = execFile(
			"ssh",
			["-F", `/tmp/wbt.${runOf("fish")}/ssh_config`, "-T", "--", aliasOf("fish"), "bash", "-s"],
			{ timeout: REVIEW_REMOTE_PROBE_TIMEOUT },
			(error, out) => (error ? reject(error) : resolvePromise({ stdout: out })),
		);
		child.stdin?.end(REVIEW_REMOTE_PROBE_SCRIPT);
	});
	const parsed = parseRemoteProbe(stdout);

	assert.ok("probe" in parsed, "error" in parsed ? parsed.error : "");
	assert.equal(judgeRemote(parsed.probe).supported, true);
});

test("a home that cannot be written is refused", { skip }, async (t) => {
	const container = containerOf("fish");
	await run("docker", ["exec", container, "chmod", "555", "/home/dev"]);
	t.after(() => run("docker", ["exec", container, "chmod", "755", "/home/dev"]));

	const { probe: found } = await probe("fish");

	assert.deepEqual(judgeRemote(found), {
		supported: false,
		reason: "The home directory /home/dev cannot be written; Whiteboard needs to write under it.",
	});
});

test("ubuntu:22.04 on linux/amd64 is linux-x64", { skip }, async () => {
	assert.deepEqual(judgeRemote((await probe("amd64")).probe), { supported: true, target: "linux-x64" });
});

test("debian:11 is refused for glibc 2.31, and a sealed host does not reach the registry", { skip }, async () => {
	const { probe: found } = await probe("old");

	assert.equal(found.glibc, "2.31");
	assert.deepEqual(judgeRemote(found), { supported: false, reason: "This host runs glibc 2.31; Whiteboard needs 2.34 or newer." });
	assert.equal(found.downloader, "curl");
	assert.equal(found.registryReachable, false);
});

test("alpine is refused for musl", { skip }, async () => {
	const { probe: found } = await probe("musl");

	assert.equal(found.glibc, null);
	const judged = judgeRemote(found);
	assert.equal(judged.supported, false);
	assert.match(judged.supported ? "" : judged.reason, /no glibc .*musl/);
});

test("Node 20 on PATH and Node 24 under nvm: the Node 24 is reported", { skip }, async () => {
	const nvm = "/home/dev/.nvm/versions/node/v24.18.0/bin";
	await run("docker", [
		"exec",
		"-u",
		"dev",
		containerOf("node20"),
		"sh",
		"-c",
		`mkdir -p ${nvm} && printf '#!/bin/sh\\necho v24.18.0\\n' > ${nvm}/node && chmod +x ${nvm}/node && ln -s node ${nvm}/npm`,
	]);

	const { probe: found } = await probe("node20");

	assert.deepEqual(found.node, { path: `${nvm}/node`, version: "24.18.0" });
	assert.equal(found.npm, `${nvm}/npm`);
	assert.equal(found.registryReachable, true);
});
