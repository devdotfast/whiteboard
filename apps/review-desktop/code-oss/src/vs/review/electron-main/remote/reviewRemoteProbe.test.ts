/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { SpawnSsh } from "./reviewRemoteHost.js";
import { REVIEW_REMOTE_INSTALL_MARKER, REVIEW_REMOTE_WRAPPER_MARK } from "./reviewRemoteInstallScript.js";
import { judgeRemote, parseRemoteProbe, probeRemote, REVIEW_REMOTE_PROBE_BEGIN, REVIEW_REMOTE_PROBE_END, REVIEW_REMOTE_PROBE_PATH_CLI, type ReviewRemoteProbe } from "./reviewRemoteProbe.js";
import { INSTALL_SCRIPT } from "./test/installScript.js";
import { reviewSshSession } from "./reviewSshCommand.js";

const SHA256 = "a".repeat(64);

const supported: ReviewRemoteProbe = {
	os: "Linux",
	arch: "x86_64",
	glibc: "2.35",
	home: "/home/dev",
	root: "/home/dev/.dev/whiteboard-remote",
	homeWritable: true,
	freeBytes: 20e9,
	installed: [{ version: "0.1.6", sha256: SHA256 }],
	pathCli: { path: "/usr/local/bin/whiteboard", version: "0.1.6" },
	downloader: "curl",
	releasesReachable: true,
	tools: ["tar", "xz", "sha256sum"],
};

const answer = (value: unknown, before = "", after = "") => {
	const { pathCli, ...rest } = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : { pathCli: undefined };
	const body = value && typeof value === "object" && !Array.isArray(value) ? rest : value;
	return `${before}${REVIEW_REMOTE_PROBE_BEGIN}\n${JSON.stringify(body)}\n${REVIEW_REMOTE_PROBE_END}\n${pathCli ? `${REVIEW_REMOTE_PROBE_PATH_CLI} ${JSON.stringify(pathCli)}\n` : ""}${after}`;
};

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

async function executable(path: string, body: string) {
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, `#!/bin/sh\n${body}\n`);
	await chmod(path, 0o755);
}

async function fakeRemote(t: test.TestContext) {
	const home = await mkdtemp(join(tmpdir(), "wb-probe-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const bin = join(home, "bin");
	await executable(join(bin, "curl"), "exit 7");
	await executable(join(bin, "whiteboard"), 'if [ "$1" = --version ]; then echo 0.2.0; fi');
	const versions = join(home, ".dev/whiteboard-remote/versions");
	for (const version of ["0.1.6", "0.1.7.part", "0.1.8", "0.1.9", "0.2.0"]) await mkdir(join(versions, version), { recursive: true });
	const node = (version: string) => join(versions, version, "bin/node");
	const cli = (version: string) => join(versions, version, "dist/cli.js");
	const unpack = async (version: string) => {
		await executable(node(version), "echo v24.18.0");
		await mkdir(join(cli(version), ".."), { recursive: true });
		await writeFile(cli(version), "");
	};
	const marker = (version: string, sha256: string) => writeFile(join(versions, version, REVIEW_REMOTE_INSTALL_MARKER), `${JSON.stringify({ version, sha256, node: node(version), cli: cli(version) })}\n`);
	await unpack("0.1.6");
	await marker("0.1.6", SHA256);
	await unpack("0.1.9");
	await marker("0.1.9", "");
	await marker("0.2.0", SHA256);
	return { home, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } };
}

const localShell =
	(env: NodeJS.ProcessEnv, command = "/bin/sh", args = ["-s"]): SpawnSsh =>
	(_args, options) =>
		spawn(command, args, { ...options, env });

const session = reviewSshSession("devbox", tmpdir(), "test");

async function tree(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { recursive: true });
	return Promise.all(entries.sort().map(async (entry) => `${entry} ${(await stat(join(dir, entry))).mtimeMs}`));
}

test("the script finds the complete installed versions and the host's tools, and writes nothing", async (t) => {
	const { home, env } = await fakeRemote(t);
	const before = await tree(home);

	const result = await probeRemote({ session, spawn: localShell(env), env: {}, script: INSTALL_SCRIPT });

	assert.ok("probe" in result, "error" in result ? result.error : "");
	const { probe } = result;
	assert.deepEqual(probe.installed, [{ version: "0.1.6", sha256: SHA256 }]);
	assert.deepEqual(probe.pathCli, { path: join(home, "bin/whiteboard"), version: "0.2.0" });
	assert.equal(probe.home, home);
	assert.equal(probe.root, join(home, ".dev/whiteboard-remote"));
	assert.equal(probe.homeWritable, true);
	assert.ok(probe.freeBytes > 0);
	assert.equal(probe.downloader, "curl");
	assert.equal(probe.releasesReachable, false);
	assert.ok(probe.tools.includes("tar"), probe.tools.join());
	assert.deepEqual(await tree(home), before);
});

test("Desktop's wrapper and a link into the install root are not a CLI on PATH: their markers decide", async (t) => {
	const { home, env } = await fakeRemote(t);
	const bin = join(home, "bin");
	const local = join(home, ".local/bin");
	await rm(join(bin, "whiteboard"));
	await executable(join(local, "whiteboard"), `${REVIEW_REMOTE_WRAPPER_MARK}\necho 0.1.6`);
	const probe = async () => {
		const result = await probeRemote({ session, spawn: localShell(env), env: {}, script: INSTALL_SCRIPT });
		assert.ok("probe" in result, "error" in result ? result.error : "");
		return result.probe.pathCli;
	};

	assert.equal(await probe(), null);

	const managed = join(home, ".dev/whiteboard-remote/versions/0.1.6/whiteboard");
	await executable(managed, "echo 0.1.6");
	await symlink(managed, join(bin, "whiteboard"));
	assert.equal(await probe(), null);
});

test("a tree unpacked by hand under the install root is a CLI on PATH; one under versions/ is not", async (t) => {
	const { home, env } = await fakeRemote(t);
	const root = join(home, ".dev/whiteboard-remote");
	await rm(join(home, "bin/whiteboard"));
	const probe = async (dir: string) => {
		await executable(join(dir, "whiteboard"), 'if [ "$1" = --version ]; then echo 1.2.3; fi');
		const result = await probeRemote({ session, spawn: localShell({ ...env, PATH: `${dir}:${env.PATH}` }), env: {}, script: INSTALL_SCRIPT });
		assert.ok("probe" in result, "error" in result ? result.error : "");
		return result.probe.pathCli;
	};

	const extracted = join(root, "whiteboard-remote");
	assert.deepEqual(await probe(extracted), { path: join(extracted, "whiteboard"), version: "1.2.3" });
	await rm(extracted, { recursive: true });
	assert.equal(await probe(join(root, "versions/1.2.3")), null);
});

test("a home with quotes and backslashes reaches the parser intact", async (t) => {
	const parent = await mkdtemp(join(tmpdir(), "wb-probe-"));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const home = join(parent, 'a "quoted" \\ home');
	await mkdir(home);

	const result = await probeRemote({ session, spawn: localShell({ HOME: home, PATH: "/usr/bin:/bin" }), env: {}, script: INSTALL_SCRIPT });

	assert.ok("probe" in result, "error" in result ? result.error : "");
	assert.equal(result.probe.home, home);
});

test("a home that does not exist is refused as unwritable, not as a malformed answer", async (t) => {
	const parent = await mkdtemp(join(tmpdir(), "wb-probe-"));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const home = join(parent, "missing");

	const result = await probeRemote({ session, spawn: localShell({ HOME: home, PATH: "/usr/bin:/bin" }), env: {}, script: INSTALL_SCRIPT });

	assert.ok("probe" in result, "error" in result ? result.error : "");
	assert.equal(result.probe.freeBytes, 0);
	assert.deepEqual(judgeRemote({ ...result.probe, os: "Linux", arch: "x86_64", glibc: "2.35" }), {
		supported: false,
		reason: `The home directory ${home} cannot be written; Whiteboard needs to write under it.`,
	});
});

test("a probe that does not answer in time is ended and reported", async () => {
	const started = Date.now();
	const result = await probeRemote({ session, spawn: localShell({}, "/bin/sleep", ["30"]), env: {}, script: INSTALL_SCRIPT, timeout: 300 });

	assert.deepEqual(result, { error: "The probe of devbox did not answer within 0.3 seconds." });
	assert.ok(Date.now() - started < 5000);
});

test("a probe that runs out of time after its answer has no PATH CLI, and is not an error", async () => {
	const printed = answer({ ...supported, pathCli: undefined });
	const result = await probeRemote({ session, spawn: localShell({}, "/bin/sh", ["-c", `cat >/dev/null; printf '%s' '${printed}'; exec sleep 30`]), env: {}, script: INSTALL_SCRIPT, timeout: 500 });

	assert.deepEqual(result, { probe: { ...supported, pathCli: null } });
});

const timeoutDir = spawnSync("/bin/sh", ["-c", "command -v timeout"], { encoding: "utf8" }).stdout.trim().replace(/\/timeout$/, "");

test("a login shell that ignores SIGTERM is killed in time, and finds no CLI", { skip: !timeoutDir && "no timeout on PATH" }, async (t) => {
	const home = await mkdtemp(join(tmpdir(), "wb-probe-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const shell = join(home, "slow-shell");
	await executable(shell, "trap '' TERM\nsleep 2; sleep 2; sleep 2; echo /opt/bin/whiteboard");
	await executable(join(home, "bin/curl"), "exit 7");
	const started = Date.now();

	const result = await probeRemote({ session, spawn: localShell({ HOME: home, SHELL: shell, PATH: `${join(home, "bin")}:${timeoutDir}:/usr/bin:/bin` }), env: {}, script: INSTALL_SCRIPT });

	assert.ok("probe" in result, "error" in result ? result.error : "");
	assert.equal(result.probe.pathCli, null);
	assert.ok(Date.now() - started < 6000, `${Date.now() - started} ms`);
});
