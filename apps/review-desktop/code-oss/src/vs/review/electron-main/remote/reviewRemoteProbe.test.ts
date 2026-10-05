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
import { judgeRemote, parseRemoteProbe, probeRemote, type ReviewRemoteProbe } from "./reviewRemoteProbe.js";
import { REVIEW_REMOTE_PROBE_BEGIN, REVIEW_REMOTE_PROBE_END, REVIEW_REMOTE_PROBE_PATH_CLI } from "./reviewRemoteProbeScript.js";
import { reviewSshSession } from "./reviewSshCommand.js";

const INTEGRITY = `sha512-${"A".repeat(86)}==`;

const supported: ReviewRemoteProbe = {
	os: "Linux",
	arch: "x86_64",
	glibc: "2.35",
	home: "/home/dev",
	root: "/home/dev/.dev/whiteboard-remote",
	homeWritable: true,
	freeBytes: 20e9,
	node: { path: "/home/dev/.nvm/versions/node/v24.18.0/bin/node", version: "24.18.0" },
	npm: "/home/dev/.nvm/versions/node/v24.18.0/bin/npm",
	installed: [{ version: "0.1.6", integrity: INTEGRITY }],
	managedNode: null,
	pathCli: { path: "/usr/local/bin/whiteboard", version: "0.1.6" },
	downloader: "curl",
	registryReachable: true,
	tools: ["tar", "xz", "sha256sum", "sha512sum"],
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
		{ root: "relative/whiteboard-remote" },
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
		{ installed: Array(300).fill({ version: "0.1.6", integrity: INTEGRITY }) },
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

test("pathCli keeps its version only when it is one, and is null when its line is missing or wrong", () => {
	const pathCli = (value: unknown) => {
		const parsed = parseRemoteProbe(answer({ ...supported, pathCli: value }));
		assert.ok("probe" in parsed);
		return parsed.probe.pathCli;
	};
	assert.equal(pathCli({ path: "/usr/bin/whiteboard", version: "0.2.0" })?.version, "0.2.0");
	assert.equal(pathCli({ path: "/usr/bin/whiteboard", version: "Whiteboard needs Node.js 24 or newer" })?.version, null);
	assert.equal(pathCli({ path: "/usr/bin/whiteboard", version: null })?.version, null);
	assert.equal(pathCli({ path: "whiteboard", version: "0.2.0" }), null);
	assert.equal(pathCli(null), null);
});

test("installed keeps only versions with an npm sha512 integrity", () => {
	const entry = (version: unknown, integrity: unknown = INTEGRITY) => ({ version, integrity });
	const parsed = parseRemoteProbe(
		answer({
			...supported,
			installed: [
				entry("0.1.6"),
				entry("0.1.7-preview.20261003.2"),
				entry("0.1.8.part"),
				entry("0.1.9-preview.1.part"),
				entry("x; rm"),
				entry(5),
				entry("latest"),
				entry("0.2.0", "sha512-abc"),
				entry("0.2.1", `sha1-${"A".repeat(26)}=`),
				entry("0.2.2", null),
				"0.2.3",
				null,
			],
		}),
	);
	assert.ok("probe" in parsed);
	assert.deepEqual(parsed.probe.installed, [entry("0.1.6"), entry("0.1.7-preview.20261003.2")]);
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
	await executable(join(bin, "node"), "echo v20.11.1");
	await executable(join(bin, "curl"), "exit 7");
	await executable(join(bin, "whiteboard"), 'if [ "$1" = --version ]; then echo 0.2.0; fi');
	await executable(join(home, ".nvm/versions/node/v24.9.0/bin/node"), "echo v24.9.0");
	await executable(join(home, ".nvm/versions/node/v24.10.0/bin/node"), "echo v24.10.0");
	await executable(join(home, ".nvm/versions/node/v24.10.0/bin/npm"), "echo 11.0.0");
	await executable(join(home, ".volta/tools/image/node/24.2.0/bin/node"), "echo v24.2.0");
	await executable(join(home, ".asdf/installs/nodejs/24.99.0/bin/node"), "echo v20.0.0");
	await executable(join(home, ".dev/whiteboard-remote/node/v24.18.0/bin/node"), "echo v24.18.0");
	const versions = join(home, ".dev/whiteboard-remote/versions");
	for (const version of ["0.1.6", "0.1.7.part", "0.1.8", "0.1.9", "0.2.0"]) await mkdir(join(versions, version), { recursive: true });
	const node = join(home, ".dev/whiteboard-remote/node/v24.18.0/bin/node");
	const cli = (version: string) => join(versions, version, "cli.js");
	const marker = (version: string, integrity: string) => writeFile(join(versions, version, REVIEW_REMOTE_INSTALL_MARKER), `${JSON.stringify({ version, integrity, node, cli: cli(version) })}\n`);
	await marker("0.1.6", INTEGRITY);
	await writeFile(cli("0.1.6"), "");
	await marker("0.1.9", "");
	await writeFile(cli("0.1.9"), "");
	await marker("0.2.0", INTEGRITY);
	return { home, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } };
}

const localShell =
	(env: NodeJS.ProcessEnv, command = "/bin/sh", args = ["-s"]): SpawnSsh =>
	(_args, options) =>
		spawn(command, args, { ...options, env });

const session = reviewSshSession("devbox", tmpdir());

async function tree(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { recursive: true });
	return Promise.all(entries.sort().map(async (entry) => `${entry} ${(await stat(join(dir, entry))).mtimeMs}`));
}

test("the script finds the highest Node 24, the complete installed versions and the managed Node, and writes nothing", async (t) => {
	const { home, env } = await fakeRemote(t);
	const before = await tree(home);

	const result = await probeRemote({ session, spawn: localShell(env), env: {} });

	assert.ok("probe" in result, "error" in result ? result.error : "");
	const { probe } = result;
	assert.deepEqual(probe.node, { path: join(home, ".nvm/versions/node/v24.10.0/bin/node"), version: "24.10.0" });
	assert.equal(probe.npm, join(home, ".nvm/versions/node/v24.10.0/bin/npm"));
	assert.equal(probe.managedNode, join(home, ".dev/whiteboard-remote/node/v24.18.0/bin/node"));
	assert.deepEqual(probe.installed, [{ version: "0.1.6", integrity: INTEGRITY }]);
	assert.deepEqual(probe.pathCli, { path: join(home, "bin/whiteboard"), version: "0.2.0" });
	assert.equal(probe.home, home);
	assert.equal(probe.root, join(home, ".dev/whiteboard-remote"));
	assert.equal(probe.homeWritable, true);
	assert.ok(probe.freeBytes > 0);
	assert.equal(probe.downloader, "curl");
	assert.equal(probe.registryReachable, false);
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
		const result = await probeRemote({ session, spawn: localShell(env), env: {} });
		assert.ok("probe" in result, "error" in result ? result.error : "");
		return result.probe.pathCli;
	};

	assert.equal(await probe(), null);

	const managed = join(home, ".dev/whiteboard-remote/versions/0.1.6/whiteboard");
	await executable(managed, "echo 0.1.6");
	await symlink(managed, join(bin, "whiteboard"));
	assert.equal(await probe(), null);
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

test("a probe that runs out of time after its answer has no PATH CLI, and is not an error", async () => {
	const printed = answer({ ...supported, pathCli: undefined });
	const result = await probeRemote({ session, spawn: localShell({}, "/bin/sh", ["-c", `cat >/dev/null; printf '%s' '${printed}'; exec sleep 30`]), env: {}, timeout: 500 });

	assert.deepEqual(result, { probe: { ...supported, pathCli: null } });
});

const timeoutDir = spawnSync("/bin/sh", ["-c", "command -v timeout"], { encoding: "utf8" }).stdout.trim().replace(/\/timeout$/, "");

test("a login shell that ignores SIGTERM is killed in time, and finds no CLI", { skip: !timeoutDir && "no timeout on PATH" }, async (t) => {
	const home = await mkdtemp(join(tmpdir(), "wb-probe-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const shell = join(home, "slow-shell");
	await executable(shell, "trap '' TERM\nsleep 2; sleep 2; sleep 2; echo /opt/bin/whiteboard");
	const started = Date.now();

	const result = await probeRemote({ session, spawn: localShell({ HOME: home, SHELL: shell, PATH: `${timeoutDir}:/usr/bin:/bin` }), env: {} });

	assert.ok("probe" in result, "error" in result ? result.error : "");
	assert.equal(result.probe.pathCli, null);
	assert.ok(Date.now() - started < 6000, `${Date.now() - started} ms`);
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
