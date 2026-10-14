/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import type { SpawnSsh } from "./reviewRemoteHost.js";
import { probeRemote } from "./reviewRemoteProbe.js";
import { uninstallRemote } from "./reviewRemoteUninstall.js";
import { installRemote, type ReviewRemoteInstallInput, type ReviewRemoteInstallProgress } from "./reviewRemoteInstaller.js";
import { REVIEW_REMOTE_INSTALL_MARKER, REVIEW_REMOTE_WRAPPER_MARK, remoteInstallScriptInput, shellQuote } from "./reviewRemoteInstallScript.js";
import type { ReviewRemoteProbe } from "./reviewRemoteProbe.js";
import { reviewSshSession } from "./reviewSshCommand.js";
import { INSTALL_SCRIPT } from "./test/installScript.js";

const VERSION = "9.9.9";
const PATH = `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`;

const localRemote =
	(home: string, extra: NodeJS.ProcessEnv = {}): SpawnSsh =>
	(args, options) => {
		const command = args.slice(args.indexOf("--") + 2).join(" ");
		const env = { HOME: home, PATH, ...extra };
		return spawn("/bin/sh", ["-c", `${command}; exit $?`], { ...options, env });
	};

function recording(inner: SpawnSsh) {
	const argv: string[][] = [];
	const spawn: SpawnSsh = (args, options) => {
		argv.push([...args]);
		return inner(args, options);
	};
	return { spawn, argv };
}

async function tarball(dir: string, cli: string, launcher = true): Promise<{ file: string; sha256: string }> {
	const source = join(dir, `source-${createHash("sha256").update(`${cli}${launcher}`).digest("hex").slice(0, 8)}`);
	const tree = join(source, "whiteboard-remote");
	await mkdir(join(tree, "bin"), { recursive: true });
	await mkdir(join(tree, "dist"), { recursive: true });
	await writeFile(join(tree, "bin", "node"), `#!/bin/sh\nexec ${shellQuote(process.execPath)} "$@"\n`, { mode: 0o755 });
	await writeFile(join(tree, "dist", "cli.js"), cli);
	if (launcher) await writeFile(join(tree, "whiteboard"), `#!/bin/sh\nd=$(dirname "$0")\nexec "$d/bin/node" "$d/dist/cli.js" "$@"\n`, { mode: 0o755 });
	const file = join(source, "whiteboard-remote.tar.xz");
	execFileSync("tar", ["-cJf", file, "-C", source, "whiteboard-remote"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
	return { file, sha256: createHash("sha256").update(await readFile(file)).digest("hex") };
}

const cliFor = (version: string) => `const [a, b] = process.argv.slice(2);
if (a === "version") console.log(JSON.stringify({ event: "version", version: "${version}" }));
else console.log("ran " + process.argv.slice(2).join(" "));
`;
const CLI = cliFor(VERSION);

async function fixture(t: test.TestContext, cli = CLI) {
	const root = await mkdtemp(join(tmpdir(), "wb-install-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const home = join(root, "a home");
	await mkdir(home);
	const pack = await tarball(root, cli);
	const served = join(root, "served.tar.xz");
	await writeFile(served, await readFile(pack.file));
	const env = await fakeCurl(root, served);
	const probe: ReviewRemoteProbe = {
		os: "Linux",
		arch: "aarch64",
		glibc: "2.35",
		home,
		root: join(home, ".dev", "whiteboard-remote"),
		homeWritable: true,
		freeBytes: 20e9,
		installed: [],
		pathCli: null,
		downloader: "curl",
		releasesReachable: true,
		tools: ["tar", "xz", "sha256sum", "openssl"],
	};
	const progress: ReviewRemoteInstallProgress[] = [];
	const artifact = { name: `whiteboard-remote-${VERSION}-linux-arm64.tar.xz`, url: RELEASE_URL, sha256: pack.sha256 };
	const input = (change: Partial<ReviewRemoteInstallInput> = {}): ReviewRemoteInstallInput => ({
		session: reviewSshSession("devbox", tmpdir(), "test"),
		probe,
		target: "linux-arm64",
		version: VERSION,
		onProgress: (step) => progress.push(step),
		signal: new AbortController().signal,
		artifact,
		script: INSTALL_SCRIPT,
		spawn: localRemote(home, env),
		env: {},
		owner: "laptop-test",
		timeouts: { lockPoll: 50 },
		...change,
	});
	const remoteRoot = join(home, ".dev", "whiteboard-remote");
	const launcher = join(remoteRoot, "versions", VERSION, "whiteboard");
	/** Serves `bytes` from the fake curl and returns their sha256. */
	const serve = async (bytes: Buffer | string) => {
		await writeFile(served, bytes);
		return createHash("sha256").update(bytes).digest("hex");
	};
	return { root, home, env, pack, artifact, probe, progress, input, serve, remoteRoot, launcher, versions: () => readdir(join(remoteRoot, "versions")).catch((): string[] => []) };
}

const run = (file: string, ...args: string[]) => execFileSync(file, args, { encoding: "utf8" }).trim();

/** Every fake in `bin` (default: the fixture's) is on the returned PATH, ahead of the fixture's. */
async function onPath(root: string, name: string, script: string, bin = join(root, "fake-bin")): Promise<NodeJS.ProcessEnv> {
	await mkdir(bin, { recursive: true });
	await writeFile(join(bin, name), `#!/bin/sh\n${script}`, { mode: 0o755 });
	return { PATH: `${bin}:${join(root, "fake-bin")}:${PATH}` };
}

const slowTar = (root: string, body: string) => onPath(root, "tar", `case "$1" in -xJf) ${body} ;; esac\nexec /usr/bin/tar "$@"\n`, join(root, "slow-bin"));

/** A curl that answers every URL with `source`. */
const fakeCurl = (root: string, source: string) =>
	onPath(root, "curl", `while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; url=$1; shift; done\nprintf '%s\\n' "$url" >> ${shellQuote(join(root, "fetched"))}\nexec cp ${shellQuote(source)} "$out"\n`);

const RELEASE_URL = `https://install.dev.fast/releases/${VERSION}/remote/whiteboard-remote-${VERSION}-linux-arm64.tar.xz`;

test("a DEV_REVIEW_HOME the remote cannot normalise is refused by the probe and the uninstall, before anything is written", async (t) => {
	const f = await fixture(t);
	for (const home of ["relative/home", `${f.root}/a/../b`, `${f.root}//b`, `${f.root}/./b`, `${f.root}/a\nb`, `${f.root}/a\tb`]) {
		const spawn = localRemote(f.home, { ...f.env, DEV_REVIEW_HOME: home });
		const probed = await probeRemote({ session: reviewSshSession("devbox", tmpdir(), "test"), spawn, env: {}, script: INSTALL_SCRIPT });
		assert.match("error" in probed ? probed.error : "", /DEV_REVIEW_HOME there is not an absolute, normalised path/, home);
		await assert.rejects(uninstallRemote({ session: reviewSshSession("devbox", tmpdir(), "test"), spawn, env: {}, script: INSTALL_SCRIPT }), /DEV_REVIEW_HOME there is not an absolute, normalised path/);
	}
	assert.deepEqual(await readdir(f.home), []);
});

test("DEV_REVIEW_HOME moves the probe's versions, the install, its launcher and the uninstall together", async (t) => {
	const uninstalled = `else if (a === "remote" && b === "uninstall") console.log(JSON.stringify({ event: "remote.uninstall", ok: true, removed: [], keptReviews: true }));\n`;
	const f = await fixture(t, CLI.replace("else console.log", `${uninstalled}else console.log`));
	const moved = join(f.root, "moved home");
	const spawn = localRemote(f.home, { ...f.env, DEV_REVIEW_HOME: ` ${moved}/ ` });
	const probed = async () => {
		const result = await probeRemote({ session: reviewSshSession("devbox", tmpdir(), "test"), spawn, env: {}, script: INSTALL_SCRIPT });
		assert.ok("probe" in result, "error" in result ? result.error : "");
		return result.probe;
	};
	const root = join(moved, "whiteboard-remote");

	const before = await probed();
	assert.equal(before.root, root);
	const result = await installRemote(f.input({ probe: { ...f.probe, root: before.root }, spawn }));

	assert.ok(result.cliPath.startsWith(`${root}/versions/${VERSION}/`), result.cliPath);
	assert.equal(run(`${root}/versions/${VERSION}/whiteboard`, "version", "--json"), `{"event":"version","version":"${VERSION}"}`);
	assert.deepEqual((await probed()).installed, [{ version: VERSION, sha256: f.pack.sha256 }]);
	await uninstallRemote({ session: reviewSshSession("devbox", tmpdir(), "test"), spawn, env: {}, script: INSTALL_SCRIPT });
	assert.deepEqual(await readdir(f.home), [".local"]);
});

test("the host downloads and installs the tarball, its launcher and ~/.local/bin/whiteboard; no -R is ever spawned; a second call finds it complete", async (t) => {
	const f = await fixture(t);
	for (const version of ["1.0.0", "2.0.0"]) await earlierVersion(f.remoteRoot, version);
	const ssh = recording(localRemote(f.home, f.env));

	const result = await installRemote(f.input({ spawn: ssh.spawn }));

	const dir = join(f.remoteRoot, "versions", VERSION);
	assert.deepEqual(result, { cliPath: join(dir, "dist/cli.js"), nodePath: join(dir, "bin/node") });
	assert.equal(await readFile(join(f.root, "fetched"), "utf8"), `${RELEASE_URL}\n`);
	assert.ok(ssh.argv.every((args) => !args.includes("-R")), JSON.stringify(ssh.argv));
	assert.deepEqual(f.progress, [{ step: "package" }, { step: "done" }]);
	assert.equal(run(f.launcher, "version", "--json"), `{"event":"version","version":"${VERSION}"}`);
	const wrapper = join(f.home, ".local/bin/whiteboard");
	assert.ok((await readFile(wrapper, "utf8")).includes(REVIEW_REMOTE_WRAPPER_MARK));
	assert.equal(run(wrapper, "a b"), "ran a b");
	assert.deepEqual((await readdir(dir)).sort(), [REVIEW_REMOTE_INSTALL_MARKER, "bin", "dist", "whiteboard"]);
	assert.deepEqual((await readdir(f.remoteRoot)).sort(), ["versions"]);
	assert.deepEqual((await f.versions()).sort(), ["2.0.0", VERSION]);

	f.progress.length = 0;
	assert.deepEqual(await installRemote(f.input()), result);
	assert.deepEqual(f.progress, [{ step: "done" }]);
});

test("a download that fails on the host fails the install with curl's exit status and leaves no work directory", async (t) => {
	const f = await fixture(t);
	const spawn = localRemote(f.home, await onPath(f.root, "curl", "exit 22\n"));

	await assert.rejects(installRemote(f.input({ spawn })), new RegExp(`failed: cannot download ${RELEASE_URL.replaceAll(".", "\\.")}: curl exited with 22\\.$`));

	assert.deepEqual(await f.versions(), []);
	assert.deepEqual((await readdir(f.remoteRoot)).sort(), ["versions"]);
});

test("a wget download that outlasts its time bound fails the install", async (t) => {
	const f = await fixture(t);
	await onPath(f.root, "wget", `[ "$1" = --help ] && exit 0\nexec sleep 30\n`);
	const path = await onPath(f.root, "timeout", `shift\n"$@" &\nsleep 1\nkill $! 2>/dev/null\nexit 124\n`);
	const started = Date.now();

	await assert.rejects(installRemote(f.input({ spawn: localRemote(f.home, path), probe: { ...f.probe, downloader: "wget" } })), /cannot download .*: wget exited with 124/);

	assert.ok(Date.now() - started < 25_000, `${Date.now() - started} ms`);
	assert.deepEqual(await f.versions(), []);
});

test("a downloaded tarball that does not match fails the install and its work directory is removed", async (t) => {
	const f = await fixture(t);
	await f.serve("not the tarball");

	await assert.rejects(installRemote(f.input()), /does not match its pinned checksum; it was removed/);

	assert.deepEqual(f.progress, [{ step: "package" }]);
	assert.deepEqual(await f.versions(), []);
	assert.deepEqual((await readdir(f.remoteRoot)).sort(), ["versions"]);
});

test("a host where no checksum tool answers fails the install and says so", async (t) => {
	const f = await fixture(t);
	await onPath(f.root, "sha256sum", "exit 1\n");
	await onPath(f.root, "openssl", "exit 1\n");

	await assert.rejects(installRemote(f.input()), /does not match its pinned checksum \(no checksum tool answered\); it was removed/);
	assert.deepEqual(await f.versions(), []);
});

test("a tarball whose whiteboard reports another version fails the install", async (t) => {
	const f = await fixture(t, cliFor("1.2.3"));

	await assert.rejects(installRemote(f.input()), /Installing on devbox failed: the tarball reports version 1\.2\.3, not 9\.9\.9/);
	assert.ok(!(await f.versions()).includes(VERSION));
});

test("a tarball without its launcher fails the install", async (t) => {
	const f = await fixture(t);
	const bare = await tarball(f.root, CLI, false);
	const sha256 = await f.serve(await readFile(bare.file));

	await assert.rejects(installRemote(f.input({ artifact: { ...f.artifact, sha256 } })), /the tarball holds no whiteboard/);
	assert.deepEqual(await f.versions(), []);
});

test("two installs at once: one waits, the tarball is downloaded once, both get the same path", async (t) => {
	const f = await fixture(t);

	const [a, b] = await Promise.all([installRemote(f.input()), installRemote(f.input())]);

	assert.deepEqual(a, b);
	assert.equal(f.progress.filter((p) => p.step === "waiting-for-lock").length, 1);
	assert.equal(f.progress.filter((p) => p.step === "package").length, 1);
	assert.deepEqual(await f.versions(), [VERSION]);
});

test("another tarball under the same version is installed again", async (t) => {
	const f = await fixture(t);
	await installRemote(f.input());
	const other = await tarball(f.root, `${CLI}// another build\n`);
	const sha256 = await f.serve(await readFile(other.file));
	f.progress.length = 0;

	const result = await installRemote(f.input({ artifact: { ...f.artifact, sha256 } }));

	assert.ok(f.progress.some((p) => p.step === "package"));
	assert.match(await readFile(result.cliPath, "utf8"), /another build/);
	assert.equal(JSON.parse(await readFile(join(dirname(f.launcher), REVIEW_REMOTE_INSTALL_MARKER), "utf8")).sha256, other.sha256);
	assert.deepEqual(await f.versions(), [VERSION]);
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
	await mkdir(join(dir, "dist"), { recursive: true });
	await writeFile(join(dir, "dist/cli.js"), "");
	await writeFile(join(dir, REVIEW_REMOTE_INSTALL_MARKER), JSON.stringify({ version, sha256: "0".repeat(64), node: process.execPath, cli: join(dir, "dist/cli.js") }));
	return dir;
}

test("after an install, versions other than the newest two are removed, and a version left without its marker", async (t) => {
	const f = await fixture(t);
	for (const version of ["1.0.0", "2.0.0", "2.0.0-preview.1", "10.0.0-preview.3"]) await earlierVersion(f.remoteRoot, version);
	await mkdir(join(f.remoteRoot, "versions", "notes"));
	await mkdir(join(f.remoteRoot, "versions", "3.0.0", "dist"), { recursive: true });

	await installRemote(f.input());

	assert.deepEqual((await f.versions()).sort(), ["10.0.0-preview.3", VERSION, "notes"].sort());
	assert.deepEqual((await readdir(f.remoteRoot)).sort(), ["versions"]);
});

test("a version without a sha256 marker is removed, and Desktop's wrapper moves to the new version", async (t) => {
	const f = await fixture(t);
	const old = join(f.remoteRoot, "versions", "10.0.0");
	const cli = join(old, "dist/cli.js");
	await mkdir(dirname(cli), { recursive: true });
	await writeFile(cli, cliFor("10.0.0"));
	await writeFile(join(old, "whiteboard"), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cli)} "$@"\n`, { mode: 0o755 });
	await writeFile(join(old, REVIEW_REMOTE_INSTALL_MARKER), JSON.stringify({ version: "10.0.0", integrity: `sha512-${"A".repeat(86)}==`, node: process.execPath, cli, installedAt: 0 }));
	const wrapper = join(f.home, ".local/bin/whiteboard");
	await mkdir(dirname(wrapper), { recursive: true });
	await writeFile(wrapper, `#!/bin/sh\n${REVIEW_REMOTE_WRAPPER_MARK}\nexec ${shellQuote(join(old, "whiteboard"))} "$@"\n`, { mode: 0o755 });

	await installRemote(f.input());

	assert.deepEqual(await f.versions(), [VERSION]);
	assert.equal(run(wrapper, "version", "--json"), `{"event":"version","version":"${VERSION}"}`);
});

test("with three versions installed and one running, cleanup leaves the running one and the newest", async (t) => {
	const f = await fixture(t);
	const running = await earlierVersion(f.remoteRoot, "1.0.0");
	await earlierVersion(f.remoteRoot, "2.0.0");
	const server = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", join(running, "dist/cli.js"), "server", "start"], { stdio: "ignore" });
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

test("an abort while the tarball unpacks ends it, leaves no version and no lock, and the next install succeeds", async (t) => {
	const f = await fixture(t);
	const seconds = `47.${Math.floor(Math.random() * 1000)}1`;
	const path = await slowTar(f.root, `touch "$HOME/unpack-started"; exec sleep ${seconds}`);
	const abort = new AbortController();
	const started = join(f.home, "unpack-started");
	const watch = setInterval(() => void readFile(started).then(() => abort.abort(), () => {}), 50);
	t.after(() => clearInterval(watch));

	await assert.rejects(installRemote(f.input({ spawn: localRemote(f.home, path), signal: abort.signal })), { name: "AbortError" });

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
	assert.deepEqual(f.progress, [{ step: "done" }]);
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

test("shellQuote survives quotes and refuses control characters", async () => {
	for (const value of ["plain", "it's", "a 'b' \"c\" $d `e` \\f", "'", ""]) {
		assert.equal(run("/bin/sh", "-c", `printf '%s' ${shellQuote(value)}`), value);
	}
	assert.throws(() => shellQuote("a\nb"), /control character/);
	assert.throws(() => shellQuote("a\u0007b"), /control character/);
});

test("prereleases order by number, so cleanup keeps the newest one", async (t) => {
	const f = await fixture(t);
	for (const version of ["9.9.10-preview.2", "9.9.10-preview.10", "9.9.9-preview.3"]) await earlierVersion(f.remoteRoot, version);

	await installRemote(f.input());

	assert.deepEqual((await f.versions()).sort(), ["9.9.10-preview.10", VERSION].sort());
});

/** Runs the script's install by hand, as a second laptop would, giving up at once on a held lock. */
const busyInstall = (home: string) =>
	remoteInstallScriptInput(INSTALL_SCRIPT, ["install", "--version", VERSION, "--sha256", "0".repeat(64), "--url", RELEASE_URL, "--token", "00112233aabbccdd", "--owner", "stealer", "--lock-wait", "0"]);

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
		child.stdin.end(busyInstall(f.home));
	});

	assert.match(out, /WHITEBOARD-INSTALL BUSY winner/);
	assert.equal(await readFile(join(lock, "token"), "utf8"), "fedcba9876543210\n");
});

test("a long unpack keeps the lock fresh, so a second install waits", async (t) => {
	const f = await fixture(t);
	const timeouts = { lockPoll: 100, lockStale: 3000 };
	const first = installRemote(f.input({ timeouts, spawn: localRemote(f.home, await slowTar(f.root, "sleep 5")) }));
	await new Promise((resolve) => setTimeout(resolve, 500));
	const second = installRemote(f.input({ timeouts }));

	const [a, b] = await Promise.all([first, second]);

	assert.deepEqual(a, b);
	assert.deepEqual(
		f.progress.filter((p) => p.step !== "done"),
		[{ step: "package" }, { step: "waiting-for-lock" }],
	);
});

test("a marker whose sha256 only contains the pin is not complete", async (t) => {
	const f = await fixture(t);
	await installRemote(f.input());
	const marker = join(dirname(f.launcher), REVIEW_REMOTE_INSTALL_MARKER);
	const text = await readFile(marker, "utf8");
	await writeFile(marker, text.replace(f.pack.sha256, `${f.pack.sha256}x`));
	f.progress.length = 0;

	await installRemote(f.input());

	assert.ok(f.progress.some((p) => p.step === "package"));
	assert.equal(JSON.parse(await readFile(marker, "utf8")).sha256, f.pack.sha256);
});

test("a root with a quote is refused before anything runs", async (t) => {
	const f = await fixture(t);

	await assert.rejects(installRemote(f.input({ probe: { ...f.probe, root: '/opt/wh"ite/whiteboard-remote' } })), /Whiteboard cannot install on devbox: .* holds a quote or backslash/);
	assert.deepEqual(await readdir(f.home), []);
});

test("a read of the lock's start time during refreshes never finds it empty", async (t) => {
	const f = await fixture(t);
	const installing = installRemote(f.input({ spawn: localRemote(f.home, await slowTar(f.root, "sleep 4")) }));
	let done = false;
	void installing.then(() => (done = true));
	const started = join(f.remoteRoot, "install.lock", "started");

	let reads = 0;
	const bad: string[] = [];
	while (!done) {
		const text = await readFile(started, "utf8").catch((error: NodeJS.ErrnoException) => error.code ?? "error");
		if (text === "ENOENT") continue;
		reads++;
		if (!/^\d+\n$/.test(text)) bad.push(JSON.stringify(text));
	}

	await installing;
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

	assert.match(await sh(f.home, busyInstall(f.home)), /BUSY busy-laptop/);
	assert.equal(await readFile(join(lock, "token"), "utf8"), "0123456789abcdef\n");
});
