/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { SpawnSsh } from "./reviewRemoteHost.js";
import { judgeRemote, parseRemoteProbe, probeRemote, type ReviewRemoteProbe } from "./reviewRemoteProbe.js";
import { REVIEW_REMOTE_PROBE_BEGIN, REVIEW_REMOTE_PROBE_END } from "./reviewRemoteProbeScript.js";
import { reviewSshSession } from "./reviewSshCommand.js";

const supported: ReviewRemoteProbe = {
	os: "Linux",
	arch: "x86_64",
	glibc: "2.35",
	home: "/home/dev",
	homeWritable: true,
	freeBytes: 20e9,
	node: { path: "/home/dev/.nvm/versions/node/v24.18.0/bin/node", version: "24.18.0" },
	npm: "/home/dev/.nvm/versions/node/v24.18.0/bin/npm",
	installed: ["0.1.6"],
	managedNode: null,
	downloader: "curl",
	registryReachable: true,
	tools: ["tar", "xz", "sha256sum", "sha512sum"],
};

const answer = (value: unknown, before = "", after = "") =>
	`${before}${REVIEW_REMOTE_PROBE_BEGIN}\n${JSON.stringify(value)}\n${REVIEW_REMOTE_PROBE_END}\n${after}`;

test("judgeRemote names the target of a supported host", () => {
	assert.deepEqual(judgeRemote(supported), { supported: true, target: "linux-x64" });
	assert.deepEqual(judgeRemote({ ...supported, arch: "aarch64", glibc: "2.34" }), { supported: true, target: "linux-arm64" });
});

test("judgeRemote refuses with the value found and the value needed", () => {
	const reason = (change: Partial<ReviewRemoteProbe>) => {
		const judged = judgeRemote({ ...supported, ...change });
		assert.equal(judged.supported, false);
		return judged.supported ? "" : judged.reason;
	};
	assert.equal(reason({ os: "Darwin" }), "This host runs Darwin; Whiteboard needs Linux.");
	assert.equal(reason({ arch: "armv7l" }), "This host's CPU is armv7l; Whiteboard needs x86_64 or aarch64.");
	assert.equal(reason({ glibc: "2.31" }), "This host runs glibc 2.31; Whiteboard needs 2.34 or newer.");
	assert.equal(reason({ glibc: "1.99" }), "This host runs glibc 1.99; Whiteboard needs 2.34 or newer.");
	assert.match(reason({ glibc: null }), /no glibc .*musl.*needs glibc 2\.34 or newer\.$/);
	assert.equal(reason({ homeWritable: false }), "The home directory /home/dev cannot be written; Whiteboard needs to write under it.");
	assert.equal(reason({ freeBytes: 999_999_999 }), "The home directory has 0.9 GB free; Whiteboard needs 1 GB.");
	assert.equal(judgeRemote({ ...supported, glibc: "3.0" }).supported, true);
	assert.equal(judgeRemote({ ...supported, freeBytes: 1e9 }).supported, true);
});

test("the answer is read past a login banner, also one that shares the sentinel's line", () => {
	assert.deepEqual(parseRemoteProbe(answer(supported, "Welcome\nno newline")), { probe: supported });
});

test("a malformed answer is an error, never an exception", () => {
	const malformed = (value: unknown) => {
		const parsed = parseRemoteProbe(typeof value === "string" ? value : answer(value));
		assert.ok("error" in parsed, JSON.stringify(value));
		return parsed.error;
	};
	assert.match(malformed("banner only\n"), /no answer/);
	assert.match(malformed(`${REVIEW_REMOTE_PROBE_BEGIN}\n{"os":\n${REVIEW_REMOTE_PROBE_END}`), /not JSON/);
	assert.match(malformed(`${REVIEW_REMOTE_PROBE_BEGIN}\n"x${"y".repeat(70_000)}"\n${REVIEW_REMOTE_PROBE_END}`), /too long/);
	for (const change of [
		{ os: "Linux; rm -rf" },
		{ arch: "" },
		{ glibc: "2.35; echo" },
		{ home: "home/dev" },
		{ home: "/home/\u0007dev" },
		{ home: `/${"a".repeat(5000)}` },
		{ homeWritable: "yes" },
		{ freeBytes: "20000000000" },
		{ freeBytes: -1 },
		{ freeBytes: 1.5 },
		{ node: { path: "/usr/bin/node", version: "20.11.0" } },
		{ node: { path: "node", version: "24.1.0" } },
		{ node: "/usr/bin/node" },
		{ npm: "npm" },
		{ installed: "0.1.6" },
		{ installed: Array(300).fill("0.1.6") },
		{ managedNode: 7 },
		{ downloader: "fetch" },
		{ registryReachable: 1 },
		{ tools: "tar" },
		{ npm: undefined },
	]) {
		assert.match(malformed({ ...supported, ...change }), /malformed/);
	}
	assert.match(malformed([supported]), /malformed/);
});

test("tools keeps only the tools asked about", () => {
	const parsed = parseRemoteProbe(answer({ ...supported, tools: ["openssl", "rm -rf", 5, "tar"] }));
	assert.ok("probe" in parsed);
	assert.deepEqual(parsed.probe.tools, ["tar", "openssl"]);
});

test("installed keeps only version names", () => {
	const parsed = parseRemoteProbe(
		answer({ ...supported, installed: ["0.1.6", "0.1.7-preview.20261003.2", "0.1.8.part", "0.1.9-preview.1.part", "x; rm", 5, "latest"] }),
	);
	assert.ok("probe" in parsed);
	assert.deepEqual(parsed.probe.installed, ["0.1.6", "0.1.7-preview.20261003.2"]);
});

async function executable(path: string, body: string) {
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, `#!/bin/sh\n${body}\n`);
	await chmod(path, 0o755);
}

/** A home with Node 20 on PATH, three Node 24s under version managers, and a curl that cannot connect. */
async function fakeRemote(t: test.TestContext) {
	const home = await mkdtemp(join(tmpdir(), "wb-probe-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const bin = join(home, "bin");
	await executable(join(bin, "node"), "echo v20.11.1");
	await executable(join(bin, "curl"), "exit 7");
	await executable(join(home, ".nvm/versions/node/v24.9.0/bin/node"), "echo v24.9.0");
	await executable(join(home, ".nvm/versions/node/v24.10.0/bin/node"), "echo v24.10.0");
	await executable(join(home, ".nvm/versions/node/v24.10.0/bin/npm"), "echo 11.0.0");
	await executable(join(home, ".volta/tools/image/node/24.2.0/bin/node"), "echo v24.2.0");
	// A directory named 24 whose binary is not Node 24 is not taken.
	await executable(join(home, ".asdf/installs/nodejs/24.99.0/bin/node"), "echo v20.0.0");
	await executable(join(home, ".dev/whiteboard-remote/node/v24.18.0/bin/node"), "echo v24.18.0");
	for (const version of ["0.1.6", "0.1.7.part"]) await mkdir(join(home, ".dev/whiteboard-remote/versions", version), { recursive: true });
	return { home, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } };
}

/** An `ssh` that runs the script with the local /bin/sh. */
const localShell =
	(env: NodeJS.ProcessEnv, command = "/bin/sh", args = ["-s"]): SpawnSsh =>
	(_args, options) =>
		spawn(command, args, { ...options, env });

const session = reviewSshSession("devbox", tmpdir());

async function tree(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { recursive: true });
	return Promise.all(entries.sort().map(async (entry) => `${entry} ${(await stat(join(dir, entry))).mtimeMs}`));
}

test("the script finds the highest Node 24, the installed versions and the managed Node, and writes nothing", async (t) => {
	const { home, env } = await fakeRemote(t);
	const before = await tree(home);

	const result = await probeRemote({ session, spawn: localShell(env), env: {} });

	assert.ok("probe" in result, "error" in result ? result.error : "");
	const { probe } = result;
	assert.deepEqual(probe.node, { path: join(home, ".nvm/versions/node/v24.10.0/bin/node"), version: "24.10.0" });
	assert.equal(probe.npm, join(home, ".nvm/versions/node/v24.10.0/bin/npm"));
	assert.equal(probe.managedNode, join(home, ".dev/whiteboard-remote/node/v24.18.0/bin/node"));
	assert.deepEqual(probe.installed, ["0.1.6"]);
	assert.equal(probe.home, home);
	assert.equal(probe.homeWritable, true);
	assert.ok(probe.freeBytes > 0);
	assert.equal(probe.downloader, "curl");
	assert.equal(probe.registryReachable, false);
	assert.ok(probe.tools.includes("tar"), probe.tools.join());
	assert.deepEqual(await tree(home), before);
});

test("a home with quotes and backslashes reaches the parser intact", async (t) => {
	const parent = await mkdtemp(join(tmpdir(), "wb-probe-"));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const home = join(parent, 'a "quoted" \\ home');
	await mkdir(home);

	const result = await probeRemote({ session, spawn: localShell({ HOME: home, PATH: "/usr/bin:/bin" }), env: {} });

	assert.ok("probe" in result, "error" in result ? result.error : "");
	assert.equal(result.probe.home, home);
});

test("a home that does not exist is refused as unwritable, not as a malformed answer", async (t) => {
	const parent = await mkdtemp(join(tmpdir(), "wb-probe-"));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const home = join(parent, "missing");

	const result = await probeRemote({ session, spawn: localShell({ HOME: home, PATH: "/usr/bin:/bin" }), env: {} });

	assert.ok("probe" in result, "error" in result ? result.error : "");
	assert.equal(result.probe.freeBytes, 0);
	assert.deepEqual(judgeRemote({ ...result.probe, os: "Linux", arch: "x86_64", glibc: "2.35" }), {
		supported: false,
		reason: `The home directory ${home} cannot be written; Whiteboard needs to write under it.`,
	});
});

test("a probe that does not answer in time is ended and reported", async () => {
	const started = Date.now();
	const result = await probeRemote({ session, spawn: localShell({}, "/bin/sleep", ["30"]), env: {}, timeout: 300 });

	assert.deepEqual(result, { error: "The probe of devbox did not answer within 0.3 seconds." });
	assert.ok(Date.now() - started < 5000);
});

test("an ssh failure is reported with what OpenSSH said", async () => {
	const result = await probeRemote({
		session,
		spawn: localShell({}, "/bin/sh", ["-c", "cat >/dev/null; echo 'ssh: connect to host devbox port 22: Connection refused' >&2; exit 255"]),
		env: {},
	});

	assert.deepEqual(result, {
		error: "The probe of devbox failed: it printed no answer between its sentinels. It exited with 255: ssh: connect to host devbox port 22: Connection refused.",
	});
});
