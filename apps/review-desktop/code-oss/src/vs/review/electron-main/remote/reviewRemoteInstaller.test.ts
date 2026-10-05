/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import type { SpawnSsh } from "./reviewRemoteHost.js";
import { probeRemote } from "./reviewRemoteProbe.js";
import { uninstallRemote } from "./reviewRemoteUninstall.js";
import { compareVersions, installRemote, type ReviewRemoteInstallInput, type ReviewRemoteInstallProgress } from "./reviewRemoteInstaller.js";
import {
	lockScript,
	refreshScript,
	nodePlaceScript,
	partScript,
	REVIEW_REMOTE_INSTALL_MARKER,
	REVIEW_REMOTE_WRAPPER_MARK,
	shellQuote,
} from "./reviewRemoteInstallScript.js";
import type { ReviewRemoteProbe } from "./reviewRemoteProbe.js";
import { reviewSshSession } from "./reviewSshCommand.js";

const VERSION = "9.9.9";

const localRemote =
	(home: string, uploadDelaySeconds = 0, extra: NodeJS.ProcessEnv = {}): SpawnSsh =>
	(args, options) => {
		let command = args.slice(args.indexOf("--") + 2).join(" ");
		if (uploadDelaySeconds && command.includes("cat >")) command = `sleep ${uploadDelaySeconds}; ${command}`;
		const env = { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, ...extra };
		return spawn("/bin/sh", ["-c", `${command}; exit $?`], { ...options, env });
	};

async function tarball(dir: string, cli: string): Promise<{ file: string; integrity: string }> {
	const source = join(dir, `source-${createHash("sha256").update(cli).digest("hex").slice(0, 8)}`);
	await mkdir(join(source, "package", "dist"), { recursive: true });
	await writeFile(
		join(source, "package", "package.json"),
		JSON.stringify({ name: "@dev.fast/whiteboard", version: VERSION, bin: { whiteboard: "./dist/cli.js" } }),
	);
	await writeFile(join(source, "package", "dist", "cli.js"), cli);
	const file = join(source, "package.tgz");
	execFileSync("tar", ["-czf", file, "-C", source, "package"]);
	const bytes = await readFile(file);
	return { file, integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` };
}

const CLI = `const [a, b] = process.argv.slice(2);
if (a === "version") console.log(JSON.stringify({ event: "version", version: "${VERSION}" }));
else if (a === "remote" && b === "diffr") console.log(JSON.stringify({ event: "remote.diffr", diffr: false }));
else console.log("ran " + process.argv.slice(2).join(" "));
`;

async function fixture(t: test.TestContext, cli = CLI) {
	const root = await mkdtemp(join(tmpdir(), "wb-install-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const home = join(root, "a home");
	const cache = join(root, "cache");
	await mkdir(home);
	await mkdir(cache);
	const pack = await tarball(root, cli);
	const hex = Buffer.from(pack.integrity.slice(7), "base64").toString("hex");
	await writeFile(join(cache, `sha512-${hex}`), await readFile(pack.file));
	const probe: ReviewRemoteProbe = {
		os: "Linux",
		arch: "aarch64",
		glibc: "2.35",
		home,
		root: join(home, ".dev", "whiteboard-remote"),
		homeWritable: true,
		freeBytes: 20e9,
		node: { path: process.execPath, version: "24.18.0" },
		npm: join(dirname(process.execPath), "npm"),
		installed: [],
		managedNode: null,
		pathCli: null,
		downloader: "curl",
		registryReachable: true,
		tools: ["tar", "xz", "sha256sum", "sha512sum"],
	};
	const progress: ReviewRemoteInstallProgress[] = [];
	const input = (change: Partial<ReviewRemoteInstallInput> = {}): ReviewRemoteInstallInput => ({
		session: reviewSshSession("devbox", tmpdir()),
		probe,
		target: "linux-arm64",
		version: VERSION,
		onProgress: (step) => progress.push(step),
		signal: new AbortController().signal,
		artifacts: {
			package: { name: "dev.fast-whiteboard-9.9.9.tgz", url: "file:///unused", integrity: pack.integrity },
			node: { name: "node-v24.18.0-linux-arm64.tar.xz", url: "https://nodejs.invalid/node.tar.xz", sha256: "0".repeat(64) },
		},
		published: false,
		cacheDirectory: cache,
		spawn: localRemote(home),
		env: {},
		owner: "laptop-test",
		timeouts: { lockPoll: 50 },
		...change,
	});
	const remoteRoot = join(home, ".dev", "whiteboard-remote");
	const launcher = join(remoteRoot, "versions", VERSION, "whiteboard");
	return { root, home, cache, pack, probe, progress, input, remoteRoot, launcher, versions: () => readdir(join(remoteRoot, "versions")).catch((): string[] => []) };
}

const run = (file: string, ...args: string[]) => execFileSync(file, args, { encoding: "utf8" }).trim();

test("a DEV_REVIEW_HOME the remote cannot normalise is refused by the probe and the uninstall, before anything is written", async (t) => {
	const f = await fixture(t);
	for (const home of ["relative/home", `${f.root}/a/../b`, `${f.root}//b`, `${f.root}/./b`, `${f.root}/a\nb`, `${f.root}/a\tb`]) {
		const spawn = localRemote(f.home, 0, { DEV_REVIEW_HOME: home });
		const probed = await probeRemote({ session: reviewSshSession("devbox", tmpdir()), spawn, env: {} });
		assert.match("error" in probed ? probed.error : "", /DEV_REVIEW_HOME there is not an absolute, normalised path/, home);
		await assert.rejects(uninstallRemote({ session: reviewSshSession("devbox", tmpdir()), spawn, env: {} }), /DEV_REVIEW_HOME there is not an absolute, normalised path/);
	}
	assert.deepEqual(await readdir(f.home), []);
});

test("DEV_REVIEW_HOME moves the probe's versions, the install, its launcher and the uninstall together", async (t) => {
	const uninstalled = `else if (a === "remote" && b === "uninstall") console.log(JSON.stringify({ event: "remote.uninstall", ok: true, removed: [], keptReviews: true }));\n`;
	const f = await fixture(t, CLI.replace("else console.log", `${uninstalled}else console.log`));
	const moved = join(f.root, "moved home");
	const spawn = localRemote(f.home, 0, { DEV_REVIEW_HOME: ` ${moved}/ ` });
	const probed = async () => {
		const result = await probeRemote({ session: reviewSshSession("devbox", tmpdir()), spawn, env: {} });
		assert.ok("probe" in result, "error" in result ? result.error : "");
		return result.probe;
	};
	const root = join(moved, "whiteboard-remote");

	const before = await probed();
	assert.equal(before.root, root);
	const result = await installRemote(f.input({ probe: { ...f.probe, root: before.root }, spawn }));

	assert.ok(result.cliPath.startsWith(`${root}/versions/${VERSION}/`), result.cliPath);
	assert.equal(run(`${root}/versions/${VERSION}/whiteboard`, "version", "--json"), `{"event":"version","version":"${VERSION}"}`);
	assert.deepEqual((await probed()).installed, [{ version: VERSION, integrity: f.pack.integrity }]);
	await uninstallRemote({ session: reviewSshSession("devbox", tmpdir()), spawn, env: {} });
	assert.deepEqual(await readdir(f.home), [".local"]);
});

test("installs the package, its launcher and ~/.local/bin/whiteboard; a second call finds it complete", async (t) => {
	const f = await fixture(t);

	const result = await installRemote(f.input());

	const dir = join(f.remoteRoot, "versions", VERSION);
	assert.equal(result.cliPath, join(dir, "node_modules/@dev.fast/whiteboard/dist/cli.js"));
	assert.equal(result.nodePath, process.execPath);
	assert.deepEqual(f.progress, [{ step: "package", via: "upload" }, { step: "verifying" }, { step: "done", cliPath: result.cliPath }]);
	assert.equal(run(f.launcher, "version", "--json"), `{"event":"version","version":"${VERSION}"}`);
	const wrapper = join(f.home, ".local/bin/whiteboard");
	assert.ok((await readFile(wrapper, "utf8")).includes(REVIEW_REMOTE_WRAPPER_MARK));
	assert.equal(run(wrapper, "a b"), "ran a b");
	const marker = JSON.parse(await readFile(join(dir, REVIEW_REMOTE_INSTALL_MARKER), "utf8"));
	assert.deepEqual({ ...marker, installedAt: 0 }, { version: VERSION, integrity: f.pack.integrity, node: process.execPath, cli: result.cliPath, installedAt: 0 });
	assert.deepEqual((await readdir(f.remoteRoot)).sort(), ["versions"]);
	assert.deepEqual(await f.versions(), [VERSION]);

	f.progress.length = 0;
	assert.deepEqual(await installRemote(f.input()), result);
	assert.deepEqual(f.progress, [{ step: "done", cliPath: result.cliPath }]);
});

test("two installs at once: one waits, the package is sent once, both get the same path", async (t) => {
	const f = await fixture(t);

	const [a, b] = await Promise.all([installRemote(f.input()), installRemote(f.input())]);

	assert.deepEqual(a, b);
	assert.equal(f.progress.filter((p) => p.step === "waiting-for-lock").length, 1);
	assert.equal(f.progress.filter((p) => p.step === "package").length, 1);
	assert.deepEqual(await f.versions(), [VERSION]);
});

test("another pack under the same version is installed again", async (t) => {
	const f = await fixture(t);
	await installRemote(f.input());
	const other = await tarball(f.root, `${CLI}// another build\n`);
	const hex = Buffer.from(other.integrity.slice(7), "base64").toString("hex");
	await writeFile(join(f.cache, `sha512-${hex}`), await readFile(other.file));
	f.progress.length = 0;

	const result = await installRemote(f.input({ artifacts: { ...f.input().artifacts, package: { ...f.input().artifacts.package, integrity: other.integrity } } }));

	assert.ok(f.progress.some((p) => p.step === "package"));
	assert.match(await readFile(result.cliPath, "utf8"), /another build/);
	assert.equal(JSON.parse(await readFile(join(dirname(f.launcher), REVIEW_REMOTE_INSTALL_MARKER), "utf8")).integrity, other.integrity);
	assert.deepEqual(await f.versions(), [VERSION]);
});

test("a package the remote downloaded that does not match fails the install and leaves nothing", async (t) => {
	const f = await fixture(t);
	const server = createServer((_req, res) => res.end("not the package"));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/whiteboard-9.9.9.tgz`;

	await assert.rejects(
		installRemote(f.input({ published: true, artifacts: { ...f.input().artifacts, package: { ...f.input().artifacts.package, url } } })),
		/does not match its pinned integrity; it was removed/,
	);

	assert.deepEqual(f.progress, [{ step: "package", via: "remote-download" }]);
	assert.deepEqual(await f.versions(), []);
	assert.deepEqual((await readdir(f.remoteRoot)).sort(), ["versions"]);
});

test("an existing ~/.local/bin/whiteboard that Desktop did not write is left alone", async (t) => {
	const f = await fixture(t);
	const wrapper = join(f.home, ".local/bin/whiteboard");
	await mkdir(dirname(wrapper), { recursive: true });
	await writeFile(wrapper, "#!/bin/sh\necho mine\n", { mode: 0o755 });

	await installRemote(f.input());

	assert.equal(await readFile(wrapper, "utf8"), "#!/bin/sh\necho mine\n");
	assert.equal(run(f.launcher, "version", "--json"), `{"event":"version","version":"${VERSION}"}`);
});

async function earlierVersion(remoteRoot: string, version: string): Promise<string> {
	const dir = join(remoteRoot, "versions", version);
	await mkdir(join(dir, "node_modules"), { recursive: true });
	await writeFile(join(dir, REVIEW_REMOTE_INSTALL_MARKER), JSON.stringify({ version, integrity: "sha512-old", node: process.execPath, cli: join(dir, "cli.js") }));
	return dir;
}

test("after an install, versions other than the newest two are removed, and a version left without its marker", async (t) => {
	const f = await fixture(t);
	for (const version of ["1.0.0", "2.0.0", "2.0.0-preview.1", "10.0.0-preview.3"]) await earlierVersion(f.remoteRoot, version);
	await mkdir(join(f.remoteRoot, "versions", "notes"));
	await mkdir(join(f.remoteRoot, "versions", "3.0.0", "node_modules"), { recursive: true });
	await mkdir(join(f.remoteRoot, "node", "v24.18.0"), { recursive: true });

	await installRemote(f.input());

	assert.deepEqual((await f.versions()).sort(), ["10.0.0-preview.3", VERSION, "notes"].sort());
	assert.deepEqual(await readdir(join(f.remoteRoot, "node")), ["v24.18.0"]);
});

test("with three versions installed and one running, cleanup leaves the running one and the newest", async (t) => {
	const f = await fixture(t);
	const running = await earlierVersion(f.remoteRoot, "1.0.0");
	await earlierVersion(f.remoteRoot, "2.0.0");
	const server = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", join(running, "node_modules/@dev.fast/whiteboard/dist/cli.js"), "server", "start"], { stdio: "ignore" });
	t.after(() => server.kill("SIGKILL"));

	await installRemote(f.input());

	assert.deepEqual((await f.versions()).sort(), ["1.0.0", VERSION]);
	assert.equal(server.exitCode, null);

	server.kill("SIGKILL");
	await new Promise((resolve) => server.once("exit", resolve));
	await earlierVersion(f.remoteRoot, "2.0.0");
	await rm(join(f.remoteRoot, "versions", VERSION), { recursive: true });
	await installRemote(f.input());
	assert.deepEqual((await f.versions()).sort(), ["2.0.0", VERSION]);
});

test("an install of an older version keeps itself and the newest", async (t) => {
	const f = await fixture(t);
	for (const version of ["10.0.0", "11.0.0", "12.0.0"]) await earlierVersion(f.remoteRoot, version);

	await installRemote(f.input());

	assert.deepEqual((await f.versions()).sort(), ["12.0.0", VERSION]);
});

test("an abort while npm runs ends it, leaves no version and no lock, and the next install succeeds", async (t) => {
	const f = await fixture(t);
	const npm = join(f.root, "slow-npm");
	const seconds = `47.${Math.floor(Math.random() * 1000)}1`;
	await writeFile(npm, `#!/bin/sh\ntouch "$HOME/npm-started"\nexec sleep ${seconds}\n`);
	await chmod(npm, 0o755);
	const abort = new AbortController();
	const started = join(f.home, "npm-started");
	const watch = setInterval(() => void readFile(started).then(() => abort.abort(), () => {}), 50);
	t.after(() => clearInterval(watch));

	await assert.rejects(installRemote(f.input({ probe: { ...f.probe, npm }, signal: abort.signal })), { name: "AbortError" });

	let alive = "";
	for (let i = 0; i < 50; i++) {
		alive = spawnText("pgrep", ["-f", `sleep ${seconds}`]);
		if (!alive) break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.equal(alive, "");
	assert.ok(!(await f.versions()).includes(VERSION));
	assert.ok(!(await readdir(f.remoteRoot)).includes("install.lock"));

	await installRemote(f.input());
	assert.equal(run(f.launcher, "version", "--json"), `{"event":"version","version":"${VERSION}"}`);
	assert.deepEqual(await f.versions(), [VERSION]);
});

function spawnText(command: string, args: string[]): string {
	try {
		return execFileSync(command, args, { encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

test("a stale lock is taken over; a fresh one is waited for, within the bound", async (t) => {
	const f = await fixture(t);
	const lock = join(f.remoteRoot, "install.lock");
	await mkdir(lock, { recursive: true });
	await writeFile(join(lock, "token"), "0123456789abcdef\n");
	await writeFile(join(lock, "owner"), "gone-laptop\n");
	await writeFile(join(lock, "started"), `${Math.floor(Date.now() / 1000) - 16 * 60}\n`);

	const installed = await installRemote(f.input());
	assert.ok(!(await readdir(f.remoteRoot)).includes("install.lock"));

	await mkdir(lock);
	await writeFile(join(lock, "token"), "0123456789abcdef\n");
	await writeFile(join(lock, "started"), `${Math.floor(Date.now() / 1000)}\n`);
	f.progress.length = 0;
	assert.deepEqual(await installRemote(f.input({ timeouts: { lockPoll: 50, lockWait: 400 } })), installed);
	assert.deepEqual(f.progress, [{ step: "done", cliPath: installed.cliPath }]);
	await rm(lock, { recursive: true });

	await rm(join(f.remoteRoot, "versions"), { recursive: true });
	await mkdir(lock);
	await writeFile(join(lock, "token"), "0123456789abcdef\n");
	await writeFile(join(lock, "owner"), "busy-laptop\n");
	await writeFile(join(lock, "started"), `${Math.floor(Date.now() / 1000)}\n`);
	f.progress.length = 0;

	await assert.rejects(installRemote(f.input({ timeouts: { lockPoll: 50, lockWait: 400 } })), /Another install on devbox \(busy-laptop\) held the lock/);
	assert.deepEqual(f.progress, [{ step: "waiting-for-lock" }]);
	assert.equal(await readFile(join(lock, "token"), "utf8"), "0123456789abcdef\n");
});

function sh(home: string, script: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = localRemote(home)(["--", "devbox", "sh", "-s"], { env: {}, detached: true, stdio: ["pipe", "pipe", "pipe"] });
		let out = "";
		child.stdout!.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
		child.once("error", reject);
		child.once("close", () => resolve(out));
		child.stdin!.end(script);
	});
}

test("a Node tarball with the wrong checksum is removed before it is unpacked", async (t) => {
	const f = await fixture(t);
	const context = { home: f.home, root: f.remoteRoot, token: "00112233aabbccdd" };
	assert.match(await sh(f.home, lockScript(context, "me")), /LOCKED/);
	assert.match(await sh(f.home, partScript(context, { node: "24.18.0" })), /READY/);
	const part = join(f.remoteRoot, "node", "v24.18.0.00112233aabbccdd.part");
	await writeFile(join(part, "node.tar.xz"), "not node");

	const out = await sh(f.home, nodePlaceScript(context, { nodeVersion: "24.18.0", sha256: "a".repeat(64) }));

	assert.match(out, /WHITEBOARD-INSTALL MISMATCH [0-9a-f]{64}/);
	assert.deepEqual(await readdir(join(f.remoteRoot, "node")), []);
});

test("shellQuote survives quotes and refuses control characters", async () => {
	for (const value of ["plain", "it's", "a 'b' \"c\" $d `e` \\f", "'", ""]) {
		assert.equal(run("/bin/sh", "-c", `printf '%s' ${shellQuote(value)}`), value);
	}
	assert.throws(() => shellQuote("a\nb"), /control character/);
	assert.throws(() => shellQuote("a\u0007b"), /control character/);
});

test("versions order as semver", () => {
	const sorted = ["0.1.10", "0.1.7", "0.1.7-preview.20261003.10", "0.1.6", "0.1.7-preview.20261003.2", "0.2.0-preview.1"].sort(compareVersions);
	assert.deepEqual(sorted, ["0.1.6", "0.1.7-preview.20261003.2", "0.1.7-preview.20261003.10", "0.1.7", "0.1.10", "0.2.0-preview.1"]);
});

test("a lock taken over between the stealer's two reads is left to its new holder", async (t) => {
	const f = await fixture(t);
	const lock = join(f.remoteRoot, "install.lock");
	await mkdir(lock, { recursive: true });
	await writeFile(join(lock, "token"), "0123456789abcdef\n");
	await writeFile(join(lock, "started"), "0\n");
	const bin = join(f.root, "racing-bin");
	await mkdir(bin);
	await writeFile(
		join(bin, "cat"),
		`#!/bin/sh
/bin/cat "$@"
case "$1" in */install.lock/*)
	[ -e "$RACED" ] && exit 0
	: > "$RACED"
	rm -rf "$LOCK" && mkdir "$LOCK" && echo fedcba9876543210 > "$LOCK/token" && echo winner > "$LOCK/owner" && date +%s > "$LOCK/started" ;;
esac
`,
		{ mode: 0o755 },
	);

	const out = await new Promise<string>((resolve, reject) => {
		const child = spawn("/bin/sh", ["-s"], {
			env: { HOME: f.home, LOCK: lock, RACED: join(f.root, "raced"), PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin` },
			stdio: ["pipe", "pipe", "inherit"],
		});
		let text = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => (text += chunk));
		child.once("error", reject);
		child.once("close", () => resolve(text));
		child.stdin.end(lockScript({ home: f.home, root: f.remoteRoot, token: "00112233aabbccdd" }, "stealer"));
	});

	assert.match(out, /WHITEBOARD-INSTALL BUSY winner/);
	assert.equal(await readFile(join(lock, "token"), "utf8"), "fedcba9876543210\n");
});

test("a long npm step and a long upload keep the lock fresh, so a second install waits", async (t) => {
	for (const slow of ["npm", "upload"] as const) {
		const f = await fixture(t);
		const npm = join(f.root, "slow-npm");
		await writeFile(npm, `#!/bin/sh\nsleep 5\nexec ${shellQuote(join(dirname(process.execPath), "npm"))} "$@"\n`, { mode: 0o755 });
		const timeouts = { lockPoll: 100, lockStale: 3000 };
		const first = installRemote(
			f.input({
				timeouts,
				...(slow === "npm" ? { probe: { ...f.probe, npm } } : { spawn: localRemote(f.home, 5) }),
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 500));
		const second = installRemote(f.input({ timeouts }));

		const [a, b] = await Promise.all([first, second]);

		assert.deepEqual(a, b, slow);
		assert.deepEqual(
			f.progress.filter((p) => p.step !== "verifying" && p.step !== "done"),
			[{ step: "package", via: "upload" }, { step: "waiting-for-lock" }],
			slow,
		);
	}
});

test("an abort during an upload is an AbortError", async (t) => {
	const f = await fixture(t);
	const abort = new AbortController();

	await assert.rejects(
		installRemote(
			f.input({
				spawn: localRemote(f.home, 5),
				signal: abort.signal,
				onProgress: (step) => void (step.step === "package" && setTimeout(() => abort.abort(), 300)),
			}),
		),
		{ name: "AbortError" },
	);
	assert.ok(!(await f.versions()).includes(VERSION));
});

test("a marker whose integrity only contains the pin is not complete", async (t) => {
	const f = await fixture(t);
	await installRemote(f.input());
	const marker = join(dirname(f.launcher), REVIEW_REMOTE_INSTALL_MARKER);
	const text = await readFile(marker, "utf8");
	await writeFile(marker, text.replace(f.pack.integrity, `${f.pack.integrity}x`));
	f.progress.length = 0;

	await installRemote(f.input());

	assert.ok(f.progress.some((p) => p.step === "package"));
	assert.equal(JSON.parse(await readFile(marker, "utf8")).integrity, f.pack.integrity);
});

test("a Node path with a quote is refused before anything runs", async (t) => {
	const f = await fixture(t);

	await assert.rejects(
		installRemote(f.input({ probe: { ...f.probe, node: { path: '/opt/no"de/bin/node', version: "24.18.0" } } })),
		/Whiteboard cannot install on devbox: .* holds a quote or backslash/,
	);
	assert.deepEqual(await readdir(f.home), []);
});

test("a read of the lock's start time during refreshes never finds it empty", async (t) => {
	const f = await fixture(t);
	const context = { home: f.home, root: f.remoteRoot, token: "00112233aabbccdd" };
	assert.match(await sh(f.home, lockScript(context, "me")), /LOCKED/);
	const started = join(f.remoteRoot, "install.lock", "started");
	const refreshes = sh(f.home, refreshScript(context).replace("own\n", "i=0\nwhile [ $i -lt 400 ]; do own; i=$((i + 1)); done\n"));
	let done = false;
	void refreshes.then(() => (done = true));

	let reads = 0;
	const bad: string[] = [];
	while (!done) {
		const text = await readFile(started, "utf8").catch((error: NodeJS.ErrnoException) => error.code ?? "error");
		reads++;
		if (!/^\d+\n$/.test(text)) bad.push(JSON.stringify(text));
	}

	assert.match(await refreshes, /REFRESHED/);
	assert.ok(reads > 50, `${reads} reads`);
	assert.deepEqual(bad, []);
});

test("a lock whose start time cannot be read counts as fresh", async (t) => {
	const f = await fixture(t);
	const lock = join(f.remoteRoot, "install.lock");
	await mkdir(lock, { recursive: true });
	await writeFile(join(lock, "token"), "0123456789abcdef\n");
	await writeFile(join(lock, "owner"), "busy-laptop\n");
	await writeFile(join(lock, "started"), "");
	execFileSync("touch", ["-t", "202001010000", lock]);

	assert.match(await sh(f.home, lockScript({ home: f.home, root: f.remoteRoot, token: "00112233aabbccdd" }, "me")), /BUSY busy-laptop/);
	assert.equal(await readFile(join(lock, "token"), "utf8"), "0123456789abcdef\n");
});
