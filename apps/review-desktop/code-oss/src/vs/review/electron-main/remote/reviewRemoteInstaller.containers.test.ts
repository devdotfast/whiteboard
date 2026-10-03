/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// The installer against SSH servers in containers, through the live-check harness, with
// this checkout packed as the package. Opt in with WB_TEST_CONTAINERS=1.

import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { remoteArtifacts, type ReviewRemoteArtifact } from "./reviewRemoteArtifacts.js";
import type { SpawnSsh } from "./reviewRemoteHost.js";
import { installRemote, type ReviewRemoteInstallInput, type ReviewRemoteInstallProgress } from "./reviewRemoteInstaller.js";
import { judgeRemote, probeRemote, type ReviewRemoteProbe, type ReviewRemoteTarget } from "./reviewRemoteProbe.js";
import { REVIEW_SSH_CONFIG_ENV, reviewSshSession, sshCheckArgs, sshCloseArgs, sshMasterArgs, type ReviewSshSession } from "./reviewSshCommand.js";

const run = promisify(execFile);
const checkout = resolve(import.meta.dirname, "../../../../../../../..");
const harness = join(checkout, "apps/review-desktop/scripts/e2e/remote/remote.mjs");
const VERSION: string = JSON.parse(await readFile(join(checkout, "packages/review/package.json"), "utf8")).version;

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
const hosts = { node: [], bare: ["--node", "none"], sealed: ["--sealed", "--node", "none"] } as const;
type Host = keyof typeof hosts;
const env = { ...process.env, WB_TEST_RUN: runId };
const sshEnv = { ...process.env, VSCODE_DEV: "1", [REVIEW_SSH_CONFIG_ENV]: `/tmp/wbt.${runId}/ssh_config` };
const realSsh: SpawnSsh = (args, options) => spawn("ssh", args, options);

let started = false;
let root = "";
let controlDirectory = "";
const masters: ReviewSshSession[] = [];
const found = new Map<Host, { session: ReviewSshSession; probe: ReviewRemoteProbe; target: ReviewRemoteTarget }>();
const artifacts = new Map<ReviewRemoteTarget, { package: ReviewRemoteArtifact; node: ReviewRemoteArtifact }>();

const remote = (...args: string[]) => run(process.execPath, [harness, ...args], { env, maxBuffer: 16 << 20 });
const inContainer = async (host: Host, command: string) => (await run("docker", ["exec", "-u", "dev", `wb-test-${runId}-${host}`, "sh", "-c", command])).stdout.trim();
const reset = (host: Host) => inContainer(host, "rm -rf ~/.dev/whiteboard-remote ~/.local/bin/whiteboard");

/** A master per host: the relay's port forward needs one. */
async function connect(host: Host): Promise<ReviewSshSession> {
	const session = reviewSshSession(`wb-test-${host}`, controlDirectory);
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
		root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "wb-install-"));
		controlDirectory = await mkdtemp("/tmp/wbi-");
		started = true;
		for (const [host, flags] of Object.entries(hosts)) await remote("up", host, ...flags);
		for (const host of Object.keys(hosts) as Host[]) {
			const session = await connect(host);
			const probed = await probeRemote({ session, spawn: realSsh, env: sshEnv });
			assert.ok("probe" in probed, "error" in probed ? probed.error : "");
			const judged = judgeRemote(probed.probe);
			assert.ok(judged.supported);
			found.set(host, { session, probe: probed.probe, target: judged.target });
			if (!artifacts.has(judged.target)) {
				artifacts.set(judged.target, await remoteArtifacts(judged.target, { pin: undefined, checkout, cacheDirectory: join(root, "cache") }));
			}
		}
	},
	{ timeout: 30 * 60_000 },
);

after(
	async () => {
		for (const session of masters) await run("ssh", sshCloseArgs(session, sshEnv), { env: sshEnv }).catch(() => undefined);
		if (started) await remote("down", "--all").catch((error) => console.error(error.stderr ?? error));
		for (const dir of [root, controlDirectory]) if (dir) await rm(dir, { recursive: true, force: true });
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
		artifacts: artifacts.get(target)!,
		published: false,
		cacheDirectory: join(root, "cache"),
		spawn: realSsh,
		env: sshEnv,
		...change,
	};
	return { value, progress };
}

const version = async (host: Host) => JSON.parse(await inContainer(host, "~/.local/bin/whiteboard version --json")).version;
/** Everything under the install root, two levels deep. */
const leftovers = async (host: Host) => (await inContainer(host, "cd ~/.dev/whiteboard-remote && find . -mindepth 1 -maxdepth 2 | sort")).split("\n");

test("a host with Node 24 gets the package; whiteboard version prints it", { skip, timeout: 10 * 60_000 }, async () => {
	const { value, progress } = input("node");
	const result = await installRemote(value);

	assert.equal(result.nodePath, "/usr/local/bin/node");
	assert.equal(await version("node"), VERSION);
	assert.deepEqual(
		progress.map((p) => p.step),
		["package", "verifying", "done"],
	);
	assert.equal(await inContainer("node", "ls ~/.dev/whiteboard-remote/versions"), VERSION);

	// Complete now: read without the lock, in one script.
	const again = input("node");
	assert.deepEqual(await installRemote(again.value), result);
	assert.deepEqual(again.progress.map((p) => p.step), ["done"]);
	assert.equal(await inContainer("node", "ls -d ~/.dev/whiteboard-remote/install.lock 2>/dev/null | wc -l"), "0");
});

test("a host with no Node gets Node and the package", { skip, timeout: 10 * 60_000 }, async () => {
	const { value, progress } = input("bare");
	const result = await installRemote(value);

	assert.match(result.nodePath, /\/\.dev\/whiteboard-remote\/node\/v24\.\d+\.\d+\/bin\/node$/);
	assert.deepEqual(progress[0], { step: "node", via: "remote-download" });
	assert.equal(await version("bare"), VERSION);
});

test("a sealed host gets Node by upload and the dependencies through the relay", { skip, timeout: 10 * 60_000 }, async () => {
	const { value, progress } = input("sealed");
	await installRemote(value);

	assert.deepEqual(progress.slice(0, 2), [
		{ step: "node", via: "upload" },
		{ step: "package", via: "upload" },
	]);
	assert.equal(await version("sealed"), VERSION);
	// The forward is gone with the install.
	assert.equal(await inContainer("sealed", "ss -Htln | grep -c 127.0.0.1: || true"), "0");
});

test("an abort while npm runs leaves no version; the next install succeeds", { skip, timeout: 10 * 60_000 }, async () => {
	await reset("node");
	const abort = new AbortController();
	const npmRunning = () => inContainer("node", "pgrep -f '[n]pm install' || true");
	let sawNpm = false;
	const { value } = input("node", {
		signal: abort.signal,
		onProgress: async (step) => {
			if (step.step !== "package") return;
			// Abort once npm is at work on the remote.
			for (let i = 0; i < 300 && !abort.signal.aborted; i++) {
				if (await npmRunning()) {
					sawNpm = true;
					abort.abort();
				}
				await new Promise((r) => setTimeout(r, 100));
			}
		},
	});

	await assert.rejects(installRemote(value), { name: "AbortError" });
	assert.ok(sawNpm);

	let npm = "";
	for (let i = 0; i < 50; i++) {
		npm = await npmRunning();
		if (!npm) break;
		await new Promise((r) => setTimeout(r, 200));
	}
	assert.equal(npm, "");
	const left = await leftovers("node");
	assert.ok(!left.includes(`./versions/${VERSION}`) && !left.includes("./install.lock"), left.join(" "));

	await installRemote(input("node").value);
	assert.equal(await version("node"), VERSION);
});

test("two installs at once: one waits, the package is sent once, both return the same path", { skip, timeout: 10 * 60_000 }, async () => {
	await reset("node");
	const a = input("node");
	const b = input("node", { onProgress: (step) => a.progress.push(step), timeouts: { lockPoll: 500 } });

	const [first, second] = await Promise.all([installRemote(a.value), installRemote(b.value)]);

	assert.deepEqual(first, second);
	assert.equal(a.progress.filter((p) => p.step === "waiting-for-lock").length, 1);
	assert.equal(a.progress.filter((p) => p.step === "package").length, 1);
});

test("a package with the wrong integrity fails the install and leaves nothing", { skip, timeout: 10 * 60_000 }, async () => {
	await reset("node");
	const { value } = input("node");
	const wrong = { ...value.artifacts.package, url: "https://registry.npmjs.org/commander/-/commander-14.0.3.tgz" };

	await assert.rejects(installRemote({ ...value, published: true, artifacts: { ...value.artifacts, package: wrong } }), /does not match its pinned integrity/);

	assert.deepEqual(await leftovers("node"), ["./versions"]);
	assert.equal(await inContainer("node", "ls ~/.local/bin 2>/dev/null | wc -l"), "0");
});

test("an existing ~/.local/bin/whiteboard that Desktop did not write is left alone", { skip, timeout: 10 * 60_000 }, async () => {
	await reset("node");
	await inContainer("node", "mkdir -p ~/.local/bin && printf '#!/bin/sh\\necho mine\\n' > ~/.local/bin/whiteboard && chmod 755 ~/.local/bin/whiteboard");

	await installRemote(input("node").value);

	assert.equal(await inContainer("node", "~/.local/bin/whiteboard"), "mine");
	assert.equal(JSON.parse(await inContainer("node", `~/.dev/whiteboard-remote/versions/${VERSION}/whiteboard version --json`)).version, VERSION);
});

test("with three versions installed and one running, an install leaves the running one and the newest", { skip, timeout: 10 * 60_000 }, async (t) => {
	await reset("node");
	await installRemote(input("node").value);
	// Two earlier versions beside it: copies with their own name, one running a process from its directory.
	await inContainer(
		"node",
		`cd ~/.dev/whiteboard-remote/versions && for v in ${VERSION}-old.1 ${VERSION}-old.2; do cp -a ${VERSION} $v && sed -i "s#/versions/${VERSION}/#/versions/$v/#g" $v/.whiteboard-install.json; done
		setsid nohup node -e 'setInterval(() => {}, 1000)' "$HOME/.dev/whiteboard-remote/versions/${VERSION}-old.1/node_modules/@dev.fast/whiteboard/dist/cli.js" >/dev/null 2>&1 < /dev/null &`,
	);
	// The bracket keeps pkill from matching its own shell.
	t.after(() => inContainer("node", `pkill -f '[${VERSION[0]}]${VERSION.slice(1)}-old.1/' || true`));
	await inContainer("node", `rm -rf ~/.dev/whiteboard-remote/versions/${VERSION}`);

	await installRemote(input("node").value);

	assert.equal(await inContainer("node", "ls ~/.dev/whiteboard-remote/versions | tr '\\n' ' '"), `${VERSION} ${VERSION}-old.1`);
});
