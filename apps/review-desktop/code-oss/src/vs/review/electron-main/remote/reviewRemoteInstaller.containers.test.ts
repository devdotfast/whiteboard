/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { remoteArtifact, type ReviewRemoteArtifact } from "./reviewRemoteArtifacts.js";
import type { SpawnSsh } from "./reviewRemoteHost.js";
import { installRemote, type ReviewRemoteInstallInput, type ReviewRemoteInstallProgress } from "./reviewRemoteInstaller.js";
import { judgeRemote, probeRemote, type ReviewRemoteProbe, type ReviewRemoteTarget } from "./reviewRemoteProbe.js";
import { REVIEW_SSH_CONFIG_ENV, reviewSshSession, sshCheckArgs, sshCloseArgs, sshMasterArgs, type ReviewSshSession } from "./reviewSshCommand.js";
import { INSTALL_SCRIPT } from "./test/installScript.js";

const run = promisify(execFile);
const checkout = resolve(import.meta.dirname, "../../../../../../../..");
const harness = join(checkout, "apps/review-desktop/scripts/e2e/remote/remote.mjs");
const VERSION: string = JSON.parse(await readFile(join(checkout, "packages/review/package.json"), "utf8")).version;
const NEXT = VERSION.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_, major, minor, patch) => `${major}.${minor}.${Number(patch) + 1}`);

function skipReason(): string | undefined {
	if (process.env.WB_TEST_CONTAINERS !== "1") return "set WB_TEST_CONTAINERS=1 to install into containers";
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
	} catch {
		return "Docker is not available";
	}
	return undefined;
}

const skip = skipReason();
const runId = `s3t3${randomBytes(3).toString("hex")}`;
const hosts = { fresh: ["--node", "none"] } as const;
type Host = keyof typeof hosts;
const env = { ...process.env, WB_TEST_RUN: runId };
const sshEnv = { ...process.env, VSCODE_DEV: "1", [REVIEW_SSH_CONFIG_ENV]: `/tmp/wbt.${runId}/ssh_config` };
const realSsh: SpawnSsh = (args, options) => spawn("ssh", args, options);

let started = false;
let controlDirectory = "";
let releases: { url: string; stage(target: ReviewRemoteTarget, version?: string): Promise<void>; close(): Promise<void> } | undefined;
const masters: ReviewSshSession[] = [];
const found = new Map<Host, { session: ReviewSshSession; probe: ReviewRemoteProbe; target: ReviewRemoteTarget }>();
const artifacts = new Map<ReviewRemoteTarget, ReviewRemoteArtifact>();

const remote = (...args: string[]) => run(process.execPath, [harness, ...args], { env, maxBuffer: 16 << 20 });
const inContainer = async (host: Host, command: string) => (await run("docker", ["exec", "-u", "dev", `wb-test-${runId}-${host}`, "sh", "-c", command])).stdout.trim();
const reset = (host: Host) => inContainer(host, "rm -rf ~/.dev/whiteboard-remote ~/.local/bin/whiteboard");

async function connect(host: Host): Promise<ReviewSshSession> {
	const session = reviewSshSession(`wb-test-${host}`, controlDirectory, "test");
	spawn("ssh", sshMasterArgs(session, sshEnv), { env: sshEnv, detached: true, stdio: "ignore" }).unref();
	masters.push(session);
	for (let i = 0; i < 100; i++) {
		if (await run("ssh", sshCheckArgs(session, sshEnv), { env: sshEnv }).then(() => true, () => false)) return session;
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`the master for ${host} did not start`);
}

before(
	async () => {
		if (skip) return;
		controlDirectory = await mkdtemp("/tmp/wbi-");
		started = true;
		for (const [host, flags] of Object.entries(hosts)) await remote("up", host, ...flags);
		for (const host of Object.keys(hosts) as Host[]) {
			const session = await connect(host);
			const probed = await probeRemote({ session, spawn: realSsh, env: sshEnv, script: INSTALL_SCRIPT });
			assert.ok("probe" in probed, "error" in probed ? probed.error : "");
			const judged = judgeRemote(probed.probe);
			assert.ok(judged.supported);
			found.set(host, { session, probe: probed.probe, target: judged.target });
		}
		// A computed specifier: the harness is JavaScript outside this project.
		const { serveReleases } = await import(pathToFileURL(join(checkout, "apps/review-desktop/scripts/e2e/remote/releases.mjs")).href);
		releases = await serveReleases();
		for (const { target } of found.values()) {
			if (artifacts.has(target)) continue;
			await releases!.stage(target);
			artifacts.set(target, await remoteArtifact(target, VERSION, { pin: undefined, releases: releases!.url }));
		}
	},
	{ timeout: 30 * 60_000 },
);

after(
	async () => {
		await releases?.close();
		for (const session of masters) await run("ssh", sshCloseArgs(session, sshEnv), { env: sshEnv }).catch(() => undefined);
		if (started) await remote("down", "--all").catch((error) => console.error(error.stderr ?? error));
		if (controlDirectory) await rm(controlDirectory, { recursive: true, force: true });
	},
	{ timeout: 5 * 60_000 },
);

function input(host: Host, change: Partial<ReviewRemoteInstallInput> = {}) {
	const { session, probe, target } = found.get(host)!;
	const progress: ReviewRemoteInstallProgress[] = [];
	const value: ReviewRemoteInstallInput = {
		session,
		probe,
		target,
		version: VERSION,
		onProgress: (step) => progress.push(step),
		signal: new AbortController().signal,
		artifact: artifacts.get(target)!,
		script: INSTALL_SCRIPT,
		spawn: realSsh,
		env: sshEnv,
		...change,
	};
	return { value, progress };
}

const version = async (host: Host) => JSON.parse(await inContainer(host, "~/.local/bin/whiteboard version --json")).version;
const leftovers = async (host: Host) => (await inContainer(host, "cd ~/.dev/whiteboard-remote && find . -mindepth 1 -maxdepth 2 | sort")).split("\n");
const installed = `/home/dev/.dev/whiteboard-remote/versions/${VERSION}`;

test("a host with no Node downloads the tarball, with diffr inside it; whiteboard version prints it", { skip, timeout: 10 * 60_000 }, async () => {
	const { value, progress } = input("fresh");
	const result = await installRemote(value);

	assert.deepEqual(result, { nodePath: `${installed}/bin/node`, cliPath: `${installed}/dist/cli.js` });
	assert.equal(await version("fresh"), VERSION);
	assert.deepEqual(progress, [{ step: "package" }, { step: "done" }]);
	assert.equal(await inContainer("fresh", "ls ~/.dev/whiteboard-remote/versions"), VERSION);
	assert.match(await inContainer("fresh", `${installed}/node_modules/@dev.fast/diffr-linux-*/diffr --version`), /^diffr /);

	const again = input("fresh");
	assert.deepEqual(await installRemote(again.value), result);
	assert.deepEqual(again.progress.map((p) => p.step), ["done"]);
	assert.equal(await inContainer("fresh", "ls -d ~/.dev/whiteboard-remote/install.lock 2>/dev/null | wc -l"), "0");
});

test("a tarball the host cannot download fails the install with the URL and leaves nothing", { skip, timeout: 10 * 60_000 }, async () => {
	await reset("fresh");
	const { value } = input("fresh");
	const missing = { ...value.artifact, url: `${releases!.url}missing.tar.xz` };

	await assert.rejects(installRemote({ ...value, artifact: missing }), /cannot download http:\/\/.*missing\.tar\.xz: curl exited with 22/);

	assert.deepEqual(await leftovers("fresh"), ["./versions"]);
});

test("an abort while the tarball unpacks leaves no version; the next install succeeds", { skip, timeout: 10 * 60_000 }, async () => {
	await reset("fresh");
	const abort = new AbortController();
	const unpacking = () => inContainer("fresh", "pgrep -f '[t]ar -xJf' || true");
	let sawTar = false;
	const { value } = input("fresh", {
		signal: abort.signal,
		onProgress: async (step) => {
			if (step.step !== "package") return;
			for (let i = 0; i < 300 && !abort.signal.aborted; i++) {
				if (await unpacking()) {
					sawTar = true;
					abort.abort();
				}
				await new Promise((r) => setTimeout(r, 50));
			}
		},
	});

	await assert.rejects(installRemote(value), { name: "AbortError" });
	assert.ok(sawTar);

	let tar = "";
	for (let i = 0; i < 50; i++) {
		tar = await unpacking();
		if (!tar) break;
		await new Promise((r) => setTimeout(r, 200));
	}
	assert.equal(tar, "");
	const left = await leftovers("fresh");
	assert.ok(!left.includes(`./versions/${VERSION}`) && !left.includes("./install.lock"), left.join(" "));

	await installRemote(input("fresh").value);
	assert.equal(await version("fresh"), VERSION);
});

test("two installs at once: one waits, the tarball is downloaded once, both return the same path", { skip, timeout: 10 * 60_000 }, async () => {
	await reset("fresh");
	const a = input("fresh");
	const b = input("fresh", { onProgress: (step) => a.progress.push(step), timeouts: { lockPoll: 500 } });

	const [first, second] = await Promise.all([installRemote(a.value), installRemote(b.value)]);

	assert.deepEqual(first, second);
	assert.equal(a.progress.filter((p) => p.step === "waiting-for-lock").length, 1);
	assert.equal(a.progress.filter((p) => p.step === "package").length, 1);
});

test("a downloaded tarball with the wrong checksum fails the install and leaves nothing", { skip, timeout: 10 * 60_000 }, async () => {
	await reset("fresh");
	const { value } = input("fresh");
	const wrong = { ...value.artifact, url: "https://registry.npmjs.org/commander/-/commander-14.0.3.tgz" };

	await assert.rejects(installRemote({ ...value, artifact: wrong }), /does not match its pinned checksum/);

	assert.deepEqual(await leftovers("fresh"), ["./versions"]);
	assert.equal(await inContainer("fresh", "ls ~/.local/bin 2>/dev/null | wc -l"), "0");
});

test("an existing ~/.local/bin/whiteboard that Desktop did not write is left alone", { skip, timeout: 10 * 60_000 }, async () => {
	await reset("fresh");
	await inContainer("fresh", "mkdir -p ~/.local/bin && printf '#!/bin/sh\\necho mine\\n' > ~/.local/bin/whiteboard && chmod 755 ~/.local/bin/whiteboard");

	await installRemote(input("fresh").value);

	assert.equal(await inContainer("fresh", "~/.local/bin/whiteboard"), "mine");
	assert.equal(JSON.parse(await inContainer("fresh", `${installed}/whiteboard version --json`)).version, VERSION);
});

test("with three versions installed and one running, an install leaves the running one and the newest", { skip, timeout: 10 * 60_000 }, async (t) => {
	await reset("fresh");
	await installRemote(input("fresh").value);
	await inContainer(
		"fresh",
		`cd ~/.dev/whiteboard-remote/versions && for v in ${VERSION}-old.1 ${VERSION}-old.2; do cp -a ${VERSION} $v && sed -i "s#/versions/${VERSION}/#/versions/$v/#g" $v/.whiteboard-install.json; done
		old="$HOME/.dev/whiteboard-remote/versions/${VERSION}-old.1"
		setsid nohup "$old/bin/node" -e 'setInterval(() => {}, 1000)' "$old/dist/cli.js" >/dev/null 2>&1 < /dev/null &`,
	);
	// The bracket keeps pkill from matching its own shell.
	t.after(() => inContainer("fresh", `pkill -f '[${VERSION[0]}]${VERSION.slice(1)}-old.1/' || true`));
	await inContainer("fresh", `rm -rf ${installed}`);

	await installRemote(input("fresh").value);

	assert.equal(await inContainer("fresh", "ls ~/.dev/whiteboard-remote/versions | tr '\\n' ' '"), `${VERSION} ${VERSION}-old.1`);
});

/** NEXT's tarball for the host, built and served once. */
async function nextArtifact(host: Host): Promise<ReviewRemoteArtifact> {
	const { target } = found.get(host)!;
	await releases!.stage(target, NEXT);
	return remoteArtifact(target, NEXT, { pin: undefined, releases: releases!.url });
}

const launcherTarget = (host: Host) => inContainer(host, "sed -n 's/^exec .\\(.*\\)\\/whiteboard. .*/\\1/p' ~/.local/bin/whiteboard");

test("an update installs the new version beside the old one, and the launcher moves to it", { skip, timeout: 30 * 60_000 }, async () => {
	await reset("fresh");
	await installRemote(input("fresh").value);
	const next = await nextArtifact("fresh");

	const { value, progress } = input("fresh", { version: NEXT, artifact: next });
	const result = await installRemote(value);

	const updated = `/home/dev/.dev/whiteboard-remote/versions/${NEXT}`;
	assert.deepEqual(result, { nodePath: `${updated}/bin/node`, cliPath: `${updated}/dist/cli.js` });
	assert.deepEqual(progress.map((p) => p.step), ["package", "done"]);
	assert.equal(await version("fresh"), NEXT);
	assert.equal(await launcherTarget("fresh"), updated);
	assert.equal(await inContainer("fresh", "ls ~/.dev/whiteboard-remote/versions | tr '\\n' ' '"), `${VERSION} ${NEXT}`);

	const probed = await probeRemote({ session: found.get("fresh")!.session, spawn: realSsh, env: sshEnv, script: INSTALL_SCRIPT });
	assert.ok("probe" in probed);
	assert.deepEqual(probed.probe.installed.map((entry) => entry.version).sort(), [VERSION, NEXT].sort());
});

test("a hand install through the published install.sh is one Desktop recognises and updates", { skip, timeout: 30 * 60_000 }, async () => {
	await reset("fresh");
	const base = releases!.url.replace(/\/$/, "");

	await inContainer("fresh", `curl -fsSL ${base}/${VERSION}/remote/install.sh | WHITEBOARD_RELEASES=${base} sh -s -- --version ${VERSION}`);

	assert.equal(await version("fresh"), VERSION);
	const probed = await probeRemote({ session: found.get("fresh")!.session, spawn: realSsh, env: sshEnv, script: INSTALL_SCRIPT });
	assert.ok("probe" in probed);
	assert.deepEqual(probed.probe.installed.map((entry) => entry.version), [VERSION]);
	assert.equal(probed.probe.pathCli, null);

	await installRemote(input("fresh", { version: NEXT, artifact: await nextArtifact("fresh") }).value);
	assert.equal(await version("fresh"), NEXT);
});

test("the old hand-install layout is adopted: its link moves to the install and its tree goes", { skip, timeout: 10 * 60_000 }, async () => {
	await reset("fresh");
	const { target } = found.get("fresh")!;
	const tarball = `${releases!.url}whiteboard-remote-${VERSION}-${target}.tar.xz`;
	await inContainer(
		"fresh",
		`mkdir -p ~/.dev/whiteboard-remote ~/.local/bin && curl -fsSL ${tarball} | tar -xJ -C ~/.dev/whiteboard-remote && ln -sf ~/.dev/whiteboard-remote/whiteboard-remote/whiteboard ~/.local/bin/whiteboard`,
	);

	await installRemote(input("fresh").value);

	assert.equal(await launcherTarget("fresh"), installed);
	assert.equal(await inContainer("fresh", "test -e ~/.dev/whiteboard-remote/whiteboard-remote && echo kept || echo gone"), "gone");
	assert.equal(await version("fresh"), VERSION);
});
